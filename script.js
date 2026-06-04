
// SPOTIFY CONFIG

const CLIENT_ID = "YOUR_SPOTIFY_CLIENT_ID";
const REDIRECT_URI = "YOUR_NETLIFY_LINKS";
const SCOPES = [
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-read-playback-state",
    "user-modify-playback-state"
].join(" ");


// DOM ELEMENTS

const carousel = document.getElementById("carousel");
const cover = document.getElementById("cover");
const titleEl = document.getElementById("title");
const artistEl = document.getElementById("artist");
const icon = document.getElementById("playIcon");
const path = document.getElementById("waveProgress");
const slider = document.getElementById("slider");
const queueList = document.getElementById("queueList");
const bgElement = document.getElementById("bg");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");
const searchBtn = document.getElementById("searchBtn");
const loginScreen = document.getElementById("loginScreen");
const playerScreen = document.getElementById("playerScreen");


// STATE

let accessToken = null;
let spotifyPlayer = null;
let deviceId = null;
let songs = [];
let cardElements = [];
let current = 0;
let dynamicColors = { dominant: null, secondary: null };
let searchTimeout = null;
let isPlaying = false;
let progressInterval = null;
let currentPosition = 0;
let currentDuration = 0;

let currentLyrics = [];
let currentLyricIndex = -1;
let lyricInterval = null;

const colorThief = new ColorThief();


// WAVE PROGRESS SETUP

const pathLength = path.getTotalLength();
path.style.strokeDasharray = pathLength;
path.style.strokeDashoffset = pathLength;


// AUTH — SPOTIFY PKCE


async function generateCodeVerifier(length = 128) {
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    let verifier = "";

    const array = new Uint8Array(length);
    crypto.getRandomValues(array);

    array.forEach(v => {
        verifier += chars[v % chars.length];
    });

    return verifier;
}

async function generateCodeChallenge(verifier) {

    const data = new TextEncoder().encode(verifier);

    const digest = await crypto.subtle.digest(
        "SHA-256",
        data
    );

    return btoa(
        String.fromCharCode(...new Uint8Array(digest))
    )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function loginWithSpotify() {

    const verifier = await generateCodeVerifier();

    const challenge =
        await generateCodeChallenge(verifier);

    localStorage.setItem(
        "spotify_code_verifier",
        verifier
    );

    const authUrl =
        "https://accounts.spotify.com/authorize"
        + `?client_id=${CLIENT_ID}`
        + `&response_type=code`
        + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
        + `&scope=${encodeURIComponent(SCOPES)}`
        + `&code_challenge_method=S256`
        + `&code_challenge=${challenge}`;

    window.location.href = authUrl;
}

function getCodeFromUrl() {

    const params =
        new URLSearchParams(window.location.search);

    return params.get("code");
}

async function exchangeCodeForToken(code) {

    const verifier =
        localStorage.getItem(
            "spotify_code_verifier"
        );

    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier
    });

    const response = await fetch(
        "https://accounts.spotify.com/api/token",
        {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/x-www-form-urlencoded"
            },
            body
        }
    );

    const data = await response.json();

    console.log("TOKEN RESPONSE:", data);
    console.log("ACCESS TOKEN:", data.access_token);
    console.log("TOKEN STATUS:", response.status);


    if (data.access_token) {

        accessToken = data.access_token;

        window.history.replaceState(
            {},
            document.title,
            window.location.pathname
        );

        showPlayer();

    } else {

        console.error(
            "Token exchange failed:",
            data
        );

        showLogin();
    }
}

async function initAuth() {

    const code = getCodeFromUrl();

    if (!code) {
        showLogin();
        return;
    }

    await exchangeCodeForToken(code);
}

function showLogin() {
    loginScreen.style.display = "flex";
    playerScreen.style.display = "none";
}

function showPlayer() {
    loginScreen.style.display = "none";
    playerScreen.style.display = "block";
    initCarousel();
    renderQueue();
    initSpotifyPlayer();
}


// SPOTIFY WEB PLAYBACK SDK

window.onSpotifyWebPlaybackSDKReady = () => {
    // SDK is ready — player is initialized after login in initSpotifyPlayer()
};

function initSpotifyPlayer() {
    spotifyPlayer = new Spotify.Player({
        name: "Liquid Glass Player",
        getOAuthToken: cb => cb(accessToken),
        volume: 0.8
    });

    spotifyPlayer.addListener("ready", ({ device_id }) => {
        deviceId = device_id;
        console.log("Spotify player ready, device:", device_id);
    });

    spotifyPlayer.addListener("not_ready", ({ device_id }) => {
        console.log("Device offline:", device_id);
    });

    spotifyPlayer.addListener("player_state_changed", state => {
        if (!state) return;
        isPlaying = !state.paused;
        currentPosition = state.position;
        updateCurrentLyric();
        currentDuration = state.duration;

        icon.classList.toggle("fa-play", state.paused);
        icon.classList.toggle("fa-pause", !state.paused);

        updateWaveProgress();

        if (state.paused) {

            clearInterval(lyricInterval);

        } else if (
            currentLyrics.length > 0 &&
            !lyricInterval
        ) {

            syncLyrics(currentLyrics);
        }

        if (isPlaying) {
            startProgressPoll();
        } else {
            stopProgressPoll();
        }

        // Auto next when track ends
        if (state.paused && state.position === 0 && state.restrictions?.disallow_resuming_reasons) {
            next();
        }
    });

    spotifyPlayer.addListener("authentication_error", () => {
        alert("Spotify session expired. Please log in again.");
        showLogin();
    });

    spotifyPlayer.connect();
}


// PROGRESS POLLING (SDK doesn't fire timeupdate like audio tag)

function startProgressPoll() {
    stopProgressPoll();
    progressInterval = setInterval(async () => {
        if (!spotifyPlayer) return;
        const state = await spotifyPlayer.getCurrentState();
        if (!state) return;
        currentPosition = state.position;
        currentDuration = state.duration;
        updateWaveProgress();
        // Auto next
        if (!state.paused && state.position >= state.duration - 500 && state.duration > 0) {
            stopProgressPoll();
            setTimeout(next, 600);
        }
    }, 500);
}

function stopProgressPoll() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

function updateWaveProgress() {
    if (!currentDuration) return;
    const percent = currentPosition / currentDuration;
    const point = path.getPointAtLength(percent * pathLength);
    const svg = path.ownerSVGElement;
    const box = svg.viewBox.baseVal;
    const scaleX = svg.clientWidth / box.width;
    const scaleY = svg.clientHeight / box.height;

    slider.style.left = (point.x * scaleX) + "px";
    slider.style.top = (point.y * scaleY) + "px";
    path.style.strokeDashoffset = pathLength - (percent * pathLength);
}


// SPOTIFY SEARCH

async function searchSpotify() {

    const query = searchInput.value.trim();

    if (!query || !accessToken) {
        console.log("No query or token");
        console.log("TOKEN:", accessToken);
        return;
    }

    console.log("ACCESS TOKEN VALUE:", accessToken);
    console.log(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`
    );

    searchBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {

        const res = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        const data = await res.json();
        console.log("STATUS:", res.status);
        console.log("TRACK COUNT:", data?.tracks?.items?.length);
        console.log("FULL DATA:", data);

        console.log("SEARCH RESPONSE:", data);

        if (!res.ok) {
            console.error("SPOTIFY ERROR:", JSON.stringify(data, null, 2));
            return;
        }

        if (
            data.tracks &&
            data.tracks.items &&
            data.tracks.items.length > 0
        ) {

            renderSearchResults(
                data.tracks.items
            );

        } else {

            searchResults.innerHTML =
                '<div class="search-no-results">No songs found.</div>';
        }

    } catch (err) {

        console.error(
            "SEARCH ERROR:",
            err
        );

    }

    searchBtn.innerHTML =
        '<i class="fa-solid fa-arrow-right"></i>';
}


// RENDER SEARCH RESULTS

function renderSearchResults(tracks) {

    console.log("RENDERING TRACKS:", tracks);
    console.log("TRACKS LENGTH:", tracks?.length);

    searchResults.innerHTML = "";

    if (!tracks || tracks.length === 0) {

        console.log("NO TRACKS FOUND");

        searchResults.innerHTML = `
            <div class="search-no-results">
                No songs found.
            </div>
        `;

        searchResults.classList.add("active");
        return;
    }

    tracks.forEach(track => {

        const img =
            track.album?.images?.[1]?.url ||
            track.album?.images?.[0]?.url ||
            "";

        const item = document.createElement("div");

        item.className = "search-result-item";

        item.innerHTML = `
            <img
                src="${img}"
                alt="${track.name}"
                onerror="this.src='https://via.placeholder.com/44x44/333/fff?text=♪'"
            >

            <div class="search-result-info">
                <div class="search-result-title">
                    ${track.name}
                </div>

                <div class="search-result-artist">
                    ${track.artists.map(a => a.name).join(", ")}
                </div>
            </div>

            <button class="search-add-btn" title="Add to queue">
                <i class="fa-solid fa-plus"></i>
            </button>

            <button class="search-play-btn" title="Play now">
                <i class="fa-solid fa-play"></i>
            </button>
        `;

        item.querySelector(".search-add-btn").onclick = e => {
            e.stopPropagation();
            addToQueue(track);
            showAddedFeedback(item);
        };

        item.querySelector(".search-play-btn").onclick = e => {
            e.stopPropagation();
            addToQueue(track, true);
            closeSearch();
        };

        item.onclick = () => {
            addToQueue(track, true);
            closeSearch();
        };

        searchResults.appendChild(item);
    });

    searchResults.classList.add("active");

    console.log(
        "RENDER COMPLETE:",
        searchResults.children.length
    );
}


// ADD TRACK TO QUEUE

function addToQueue(track, playNow = false) {
    const img = track.album.images[1]?.url || track.album.images[0]?.url || "";
    const song = {
        uri: track.uri,
        title: track.name,
        artist: track.artists.map(a => a.name).join(", "),
        image: img,
        duration: track.duration_ms
    };

    songs.push(song);

    if (playNow || songs.length === 1) {
        current = songs.length - 1;
        updateCarousel();
        loadSong();
    }

    renderQueue();
}

function showAddedFeedback(item) {
    const btn = item.querySelector(".search-add-btn");
    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
    btn.style.background = "rgba(100,255,150,0.3)";
    setTimeout(() => {
        btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
        btn.style.background = "";
    }, 1200);
}

function closeSearch() {
    searchResults.classList.remove("active");
    searchInput.value = "";
}

document.addEventListener("click", e => {
    if (!e.target.closest(".search-bar-wrapper")) {
        searchResults.classList.remove("active");
    }
});

searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") searchSpotify();
});

searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (query.length >= 3) {
        searchTimeout = setTimeout(searchSpotify, 500);
    } else if (query.length === 0) {
        searchResults.classList.remove("active");
    }
});


async function fetchLyrics(track, artist) {
    try {

        const url =
            `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;

        const response =
            await fetch(url);

        if (!response.ok)
            return null;

        const data =
            await response.json();

        return data.syncedLyrics;

    } catch (err) {

        console.error(
            "Lyrics fetch error:",
            err
        );

        return null;
    }
}


// LOAD & PLAY SONG via Spotify API

async function loadSong() {

    if (current < 0 || current >= songs.length)
        return;

    const song = songs[current];

    titleEl.innerText = song.title;
    artistEl.innerText = song.artist;
    cover.src = song.image;
    currentDuration = song.duration;

    // Reset wave
    path.style.strokeDashoffset = pathLength;
    slider.style.left = "0px";

    // Start playback FIRST
    if (deviceId && accessToken) {

        try {

            await fetch(
                `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
                {
                    method: "PUT",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        uris: [song.uri]
                    })
                }
            );

        } catch (err) {

            console.error(
                "Playback error:",
                err
            );
        }
    }

    // Load lyrics AFTER playback starts
    clearInterval(lyricInterval);

    currentLyrics = [];
    currentLyricIndex = -1;

    const lyricElement =
        document.getElementById(
            "current-lyric"
        );

    if (lyricElement) {
        lyricElement.textContent = "";
    }

    fetchLyrics(
        song.title,
        song.artist
    )
        .then(lrc => {

            if (!lrc)
                return;

            currentLyrics =
                parseLRC(lrc);

            updateCurrentLyric();    

            console.log(
                "Lyrics loaded:",
                currentLyrics.length
            );

            syncLyrics(
                currentLyrics
            );

        })
        .catch(err => {

            console.error(
                "Lyrics error:",
                err
            );

        });

    // Update visuals
    const img = new Image();

    img.crossOrigin = "anonymous";
    img.src = song.image;

    img.onload = () => {

        setBackground(img);
        extractColors(img);

    };
}


// PLAYBACK CONTROLS

function togglePlay() {
    if (!spotifyPlayer) return;
    spotifyPlayer.togglePlay();
}

function next() {
    if (songs.length === 0) return;
    current = (current + 1) % songs.length;
    updateCarousel();
    loadSong();
    renderQueue();
}

function prev() {
    if (songs.length === 0) return;
    current = (current - 1 + songs.length) % songs.length;
    updateCarousel();
    loadSong();
    renderQueue();
}


// SEEK

async function seek(e) {
    if (!accessToken || !currentDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const position = Math.floor(percent * currentDuration);

    try {
        await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${position}&device_id=${deviceId}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        currentPosition = position;
        updateCurrentLyric();
        updateWaveProgress();
    } catch (err) {
        console.error("Seek error:", err);
    }
}

// CAROUSEL

function initCarousel() {
    for (let i = 0; i < 3; i++) {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = '<img crossOrigin="anonymous">';
        carousel.appendChild(card);
        cardElements.push(card);
    }
    updateCarousel();
}

function updateCarousel() {
    if (songs.length === 0) return;

    const leftIndex = (current - 1 + songs.length) % songs.length;
    const centerIndex = current;
    const rightIndex = (current + 1) % songs.length;

    cardElements[0].classList.remove("center", "right");
    cardElements[0].classList.add("left");
    cardElements[0].querySelector("img").src = songs[leftIndex].image;
    cardElements[0].onclick = () => selectSong(leftIndex);

    cardElements[1].classList.remove("left", "right");
    cardElements[1].classList.add("center");
    cardElements[1].querySelector("img").src = songs[centerIndex].image;
    cardElements[1].onclick = () => selectSong(centerIndex);

    cardElements[2].classList.remove("left", "center");
    cardElements[2].classList.add("right");
    cardElements[2].querySelector("img").src = songs[rightIndex].image;
    cardElements[2].onclick = () => selectSong(rightIndex);
}


// QUEUE

function renderQueue() {
    queueList.innerHTML = "";

    if (songs.length === 0) {
        queueList.innerHTML = '<div class="queue-empty">Search a song to get started</div>';
        return;
    }

    const nowLabel = document.createElement("div");
    nowLabel.className = "queue-section-label";
    nowLabel.textContent = "NOW PLAYING";
    queueList.appendChild(nowLabel);

    const d1 = document.createElement("div");
    d1.className = "queue-divider";
    queueList.appendChild(d1);

    if (current >= 0 && current < songs.length) {
        const s = songs[current];
        const item = document.createElement("div");
        item.className = "queue-item active";
        item.innerHTML = `
            <img src="${s.image}" alt="${s.title}" onerror="this.src='https://via.placeholder.com/58x58/333/fff?text=♪'">
            <div class="queue-item-info">
                <div class="queue-item-title">${s.title}</div>
                <div class="queue-item-artist">${s.artist}</div>
            </div>
        `;
        item.onclick = () => selectSong(current);
        queueList.appendChild(item);
    }

    const d2 = document.createElement("div");
    d2.className = "queue-divider";
    queueList.appendChild(d2);

    if (songs.length > 1) {
        const nextLabel = document.createElement("div");
        nextLabel.className = "queue-section-label next-up";
        nextLabel.textContent = "NEXT UP";
        queueList.appendChild(nextLabel);

        const d3 = document.createElement("div");
        d3.className = "queue-divider";
        queueList.appendChild(d3);

        let count = 0;
        for (let idx = 0; idx < songs.length && count < 10; idx++) {
            if (idx === current) continue;
            const s = songs[idx];
            const item = document.createElement("div");
            item.className = "queue-item";
            item.innerHTML = `
                <img src="${s.image}" alt="${s.title}" onerror="this.src='https://via.placeholder.com/58x58/333/fff?text=♪'">
                <div class="queue-item-info">
                    <div class="queue-item-title">${s.title}</div>
                    <div class="queue-item-artist">${s.artist}</div>
                </div>
                <button class="queue-remove-btn" title="Remove"><i class="fa-solid fa-xmark"></i></button>
            `;
            item.querySelector(".queue-remove-btn").onclick = e => { e.stopPropagation(); removeSong(idx); };
            item.onclick = () => selectSong(idx);
            queueList.appendChild(item);
            count++;
        }
    }
}

function removeSong(index) {
    songs.splice(index, 1);
    if (current >= songs.length) current = Math.max(0, songs.length - 1);
    updateCarousel();
    renderQueue();
}

function selectSong(index) {
    if (index < 0 || index >= songs.length) return;
    current = index;
    updateCarousel();
    loadSong();
    renderQueue();
}


// COLOR EXTRACTION & VISUALS

function extractColors(img) {

    try {

        const palette =
            colorThief.getPalette(img, 2);

        if (
            palette &&
            palette.length >= 2
        ) {

            dynamicColors.dominant =
                palette[0];

            dynamicColors.secondary =
                palette[1];

            const [r, g, b] =
                palette[0];

            
            document.documentElement.style.setProperty(
                "--lyric-glow",
                `${r}, ${g}, ${b}`
            );

            
            const brightR =
                Math.min(r + 80, 255);

            const brightG =
                Math.min(g + 80, 255);

            const brightB =
                Math.min(b + 80, 255);

            document.documentElement.style.setProperty(
                "--lyric-color",
                `rgb(${brightR}, ${brightG}, ${brightB})`
            );

            applyDynamicColors();
        }

    } catch (e) {

        console.warn(
            "Color Thief error:",
            e
        );

    }
}

function applyDynamicColors() {
    if (!dynamicColors.dominant || !dynamicColors.secondary) return;
    const [r1, g1, b1] = dynamicColors.dominant;
    const [r2, g2, b2] = dynamicColors.secondary;

    const bgOverlay = `radial-gradient(circle at 50% 40%, 
        rgba(${r1},${g1},${b1},0.18) 0%,
        rgba(${r2},${g2},${b2},0.12) 30%,
        rgba(${Math.floor(r1 * 0.4)},${Math.floor(g1 * 0.4)},${Math.floor(b1 * 0.4)},0.8) 60%,
        rgba(0,0,0,0.6) 100%)`;

    bgElement.style.transition = "background 2s ease";
    bgElement.style.backgroundImage = `${bgOverlay}, url(${bgElement.imageUrl || ""})`;
    bgElement.style.backgroundSize = "100% 100%, cover";
    bgElement.style.backgroundPosition = "center, center";
    bgElement.style.filter = "blur(18px)";

    if (cardElements[1]) {
        cardElements[1].style.transition = "box-shadow 1.5s ease";
        cardElements[1].style.boxShadow = `
            0 50px 100px rgba(0,0,0,0.55),
            0 0 80px rgba(${r1},${g1},${b1},0.3),
            0 0 120px rgba(${r2},${g2},${b2},0.15),
            inset 0 1px 3px rgba(255,255,255,0.5),
            inset 0 -2px 5px rgba(0,0,0,0.2)`;
        const ci = cardElements[1].querySelector("img");
        if (ci) ci.style.filter = `drop-shadow(0 0 50px rgba(${r1},${g1},${b1},0.35)) drop-shadow(0 0 80px rgba(${r2},${g2},${b2},0.15))`;
    }

    const aq = document.querySelector(".queue-item.active");
    if (aq) {
        aq.style.transition = "all 1.5s ease";
        aq.style.boxShadow = `
            0 12px 28px rgba(0,0,0,.2),
            0 0 25px rgba(${r1},${g1},${b1},.3),
            inset 0 1px 2px rgba(255,255,255,.4),
            inset 0 -1px 2px rgba(0,0,0,.1)`;
        const ai = aq.querySelector("img");
        if (ai) ai.style.filter = `drop-shadow(0 0 12px rgba(${r1},${g1},${b1},.4))`;
    }
}

function setBackground(img) {
    bgElement.style.transition = "background 2s ease, filter 2s ease";
    bgElement.imageUrl = img.src;
    bgElement.style.backgroundImage = `url(${img.src})`;
    bgElement.style.backgroundSize = "cover";
    bgElement.style.backgroundPosition = "center";
    bgElement.style.filter = "blur(18px)";
}



// LYRICS SYSTEM


function parseLRC(lrcText) {

    const lyrics = [];

    const lines = lrcText.split("\n");

    lines.forEach(line => {

        const match =
            line.match(/\[(\d+):(\d+\.\d+)\](.*)/);

        if (!match) return;

        const text = match[3].trim();

        if (!text) return;

        const minutes =
            parseInt(match[1]);

        const seconds =
            parseFloat(match[2]);

        lyrics.push({
            time:
                minutes * 60 + seconds,
            text
        });

    });

    return lyrics;
}

function updateCurrentLyric() {

    if (!currentLyrics.length)
        return;

    const currentTime =
        currentPosition / 1000;

    const currentLine =
        currentLyrics.findIndex((line, index) => {

            const nextLine =
                currentLyrics[index + 1];

            return (
                currentTime >= line.time &&
                (
                    !nextLine ||
                    currentTime < nextLine.time
                )
            );
        });

    if (
        currentLine !== -1 &&
        currentLine !== currentLyricIndex
    ) {

        currentLyricIndex =
            currentLine;

        showLyric(
            document.getElementById(
                "current-lyric"
            ),
            currentLyrics[currentLine].text
        );
    }
}

function syncLyrics(lyrics) {

    clearInterval(lyricInterval);

    currentLyrics = lyrics;

    lyricInterval =
        setInterval(() => {

            updateCurrentLyric();

        }, 20);
}

function showLyric(element, text) {

    element.classList.remove("show");

    setTimeout(() => {

        element.textContent = text;

        element.classList.remove("hide");
        element.classList.add("show");

    }, 200);
}

// BOOT

initAuth();
