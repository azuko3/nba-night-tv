// --- STATE ---
let isTVOn = false;
let currentChannel = 1;
let volume = 100;

// Debug Flag
const urlParams = new URLSearchParams(window.location.search);
const isDebug = urlParams.get('debug') === '1';

// Channel Data
let playlistData = {
    1: ['_nxTNmM9lfY'],
    2: ['dQw4w9WgXcQ', 'L_jWHffIx5E']
};

// Player Architecture: 2 channels, each has 2 players (A/B) for double buffering
// players[channelId] = { 'A': YT.Player, 'B': YT.Player }
let players = {
    1: { A: null, B: null },
    2: { A: null, B: null }
};

let channelState = {
    1: { activeSlot: 'A', videoIndex: 0, nextPrepared: false }, // activeSlot: 'A' or 'B'
    2: { activeSlot: 'A', videoIndex: 0, nextPrepared: false }
};

let pollInterval = null;

// Channel Configuration (Centralized)
const CHANNELS = {
    1: {
        name: "NBA",
        type: "MAIN",
        trimEnd: 11, // Cut 11 seconds for info cards
        color: "#0050ff"
    },
    2: {
        name: "COMEDY",
        type: "SATELLITE",
        trimEnd: 0,
        color: "#ff00ff"
    }
};

// --- INITIALIZATION ---
async function loadPlaylists() {
    try {
        const res = await fetch('playlist.json?t=' + Date.now());
        if (res.ok) {
            const data = await res.json();
            if (data["1"] && data["1"].length) playlistData[1] = data["1"];
            if (data["2"] && data["2"].length) playlistData[2] = data["2"];
        }
    } catch (e) { console.warn("Fetch failed, using defaults"); }
}

// Global callback for YouTube API
window.onYouTubeIframeAPIReady = function () {
    loadPlaylists().then(() => {
        initChannel(1);
        initChannel(2);
        startPoller();
    });
}

function initChannel(id) {
    // Create A and B players
    createPlayerInstance(id, 'A', 0); // Load 1st video
    createPlayerInstance(id, 'B', 1); // Preload 2nd video
}

function createPlayerInstance(channelId, slot, vidIdx) {
    let container = document.getElementById('players-container');
    let divId = `player-${channelId}-${slot}`;

    let div = document.createElement('div');
    div.id = divId;
    // Only Channel 1 Slot A starts visible-ish (opacity handled by CSS active class)
    let isInitiallyActive = (channelId === 1 && slot === 'A');
    div.className = `video-player ${isInitiallyActive ? 'active' : ''}`;
    container.appendChild(div);

    // Safety check for index
    let vIds = playlistData[channelId];
    let safeIndex = vidIdx % vIds.length;
    let videoId = vIds[safeIndex];

    // Check for debug flags (Use global isDebug)
    const showControls = isDebug ? 1 : 0;

    players[channelId][slot] = new YT.Player(divId, {
        videoId: videoId,
        playerVars: {
            'autoplay': 1,
            'controls': showControls,
            'disablekb': 1,
            'fs': 0,
            'modestbranding': 1,
            'rel': 0,
            'iv_load_policy': 3, // Strict: Hide video annotations
            'mute': 1
        },
        events: {
            'onReady': (e) => {
                e.target.mute(); // Always start muted

                // If it's the very first video of default channel (CH1), play with sound if TV ON
                if (isTVOn && channelId === currentChannel && slot === channelState[channelId].activeSlot) {
                    e.target.unMute();
                    e.target.setVolume(volume);
                }

                e.target.playVideo();

                // FIX: Pause background players so they don't run out!
                // Only the active slot of the active channel should run immediately.
                // Background players (Slot B or inactive channels) should buffer then pause.
                if (!isInitiallyActive) {
                    setTimeout(() => {
                        e.target.pauseVideo();
                    }, 1500); // Allow 1.5s buffering then FREEZE
                }
            },
            'onStateChange': (e) => {
                // Poller handles transitions
            }
        }
    });
}

// --- POLLER FOR SEAMLESS TRANSITIONS ---
function startPoller() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
        if (!isTVOn) return;

        // Check Active Channel status
        let chState = channelState[currentChannel];
        let currentSlot = chState.activeSlot;
        let activePlayer = players[currentChannel][currentSlot];

        if (activePlayer && activePlayer.getCurrentTime && activePlayer.getDuration) {
            let now = activePlayer.getCurrentTime();
            let duration = activePlayer.getDuration();

            if (duration > 0) {
                // Calculate Trigger Points
                // Use Generic Config
                let config = CHANNELS[currentChannel];
                let trim = (config && config.trimEnd) || 0;

                // Minimum safety buffer of 0.2s if trim is 0
                if (trim === 0) trim = 0.2;

                let swapPoint = duration - trim;
                let preStartPoint = swapPoint - 2; // Start next video 2s before swap

                // DEBUG LOGGING
                if (isDebug && Math.floor(now) % 5 === 0) {
                    console.log(`[DEBUG] Time: ${now.toFixed(1)} / ${duration.toFixed(1)} | Swap: ${swapPoint.toFixed(1)} | Pre: ${preStartPoint.toFixed(1)}`);
                }

                // 1. Trigger "Next" Start
                if (now >= preStartPoint && !chState.nextPrepared) {
                    if (isDebug) console.log(`[DEBUG] >>> PRE-START TRIGGERED at ${now.toFixed(1)}`);
                    // Prepare Next Slot
                    let nextSlot = currentSlot === 'A' ? 'B' : 'A';
                    let nextPlayer = players[currentChannel][nextSlot];

                    // Start next video muted
                    if (nextPlayer) {
                        nextPlayer.mute();
                        nextPlayer.playVideo(); // RESUME from the pause
                        console.log("Pre-starting next video...");
                    }
                    chState.nextPrepared = true;
                }

                // 2. The Swap
                if (now >= swapPoint) {
                    performSwap(currentChannel);
                }
            }
        }
    }, 200);
}

function performSwap(channelId) {
    let chState = channelState[channelId];
    let oldSlot = chState.activeSlot;
    let newSlot = oldSlot === 'A' ? 'B' : 'A';

    let oldPlayer = players[channelId][oldSlot];
    let newPlayer = players[channelId][newSlot];

    // 1. Visual Swap
    let newDiv = document.getElementById(`player-${channelId}-${newSlot}`);
    let oldDiv = document.getElementById(`player-${channelId}-${oldSlot}`);

    newDiv.classList.add('active');

    // 2. Audio Swap
    if (channelId === currentChannel && isTVOn) {
        newPlayer.unMute();
        newPlayer.setVolume(volume);
    }
    oldPlayer.mute();
    oldDiv.classList.remove('active');

    // 3. Update State
    chState.activeSlot = newSlot;
    chState.videoIndex = (chState.videoIndex + 1) % playlistData[channelId].length;
    chState.nextPrepared = false;

    // 4. Recycle Old Player (Load Next+1)
    let nextNextIndex = (chState.videoIndex + 1) % playlistData[channelId].length;
    let nextNextId = playlistData[channelId][nextNextIndex];

    setTimeout(() => {
        oldPlayer.stopVideo();
        oldPlayer.loadVideoById(nextNextId);
        // Background players: Play to buffer, then PAUSE
        oldPlayer.playVideo();
        oldPlayer.mute();
        setTimeout(() => oldPlayer.pauseVideo(), 1500); // The key fix
    }, 1000);
}

// --- POWER LOGIC ---
function togglePower() {
    isTVOn = !isTVOn;
    let frame = document.getElementById('tv-frame');

    if (isTVOn) {
        frame.classList.add('tv-playing');
        frame.classList.add('tv-on');

        // Wake up active player
        let slot = channelState[currentChannel].activeSlot;
        let p = players[currentChannel][slot];
        if (p) { p.unMute(); p.setVolume(volume); p.playVideo(); }

        showOSD("POWER ON");
    } else {
        frame.classList.remove('tv-playing');
        frame.classList.remove('tv-on');
        // Mute all (but let them run or pause? User typically expects TV off = Silence)
        // We will MUTE them so they don't blast sound, but maybe keep running?
        // Usually Smart TVs pause content. Let's Pause to save bandwidth?
        // User said "Start straight away... run behind".
        // I'll just MUTE all.
        for (let c in players) {
            if (players[c].A) players[c].A.mute();
            if (players[c].B) players[c].B.mute();
        }
    }
}

// --- CONTROLS ---
function switchChannel(direction) {
    if (!isTVOn) return;

    let oldCh = currentChannel;

    // Generic Looping Logic
    // Assuming channels are 1 and 2. 
    // 1 -> 2 -> 1
    if (direction > 0) {
        // Next
        currentChannel = (currentChannel === 1) ? 2 : 1;
    } else {
        // Prev
        currentChannel = (currentChannel === 1) ? 2 : 1;
    }

    // Only execute switch if channel actually changed (always true for 2 channels, but safe generic)
    if (oldCh !== currentChannel) {

        // Mute Old Channel FIRST
        let oldSlot = channelState[oldCh].activeSlot;
        players[oldCh][oldSlot].mute();

        showStatic();
        setTimeout(() => {
            // Hide Old Channel Visuals
            document.getElementById(`player-${oldCh}-A`).classList.remove('active');
            document.getElementById(`player-${oldCh}-B`).classList.remove('active');

            // Show New Channel Active Visual
            let newSlot = channelState[currentChannel].activeSlot;
            document.getElementById(`player-${currentChannel}-${newSlot}`).classList.add('active');

            // Audio
            let p = players[currentChannel][newSlot];
            p.unMute(); p.setVolume(volume); p.playVideo();

            hideStatic();

            // Generic Name Lookup
            let name = (CHANNELS[currentChannel] && CHANNELS[currentChannel].name) || "UNK";
            showOSD(`CH 0${currentChannel} ${name}`);
        }, 300);
    }
}

function adjustVolume(delta) {
    if (!isTVOn) return;
    volume = Math.max(0, Math.min(100, volume + delta));
    let slot = channelState[currentChannel].activeSlot;
    let p = players[currentChannel][slot];
    if (p) p.setVolume(volume);
    showOSD(`VOL ${volume}%`);
}

function showOSD(text) {
    let osd = document.getElementById('osd-display');
    osd.innerText = text;
    osd.style.display = 'block';
    if (window.osdTimer) clearTimeout(window.osdTimer);
    window.osdTimer = setTimeout(() => osd.style.display = 'none', 2000);
}

function showStatic() { document.getElementById('static-overlay').style.opacity = 0.4; }
function hideStatic() { document.getElementById('static-overlay').style.opacity = 0; }

// --- INPUT HANDLING ---
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') togglePower();
    if (!isTVOn) return;
    if (e.code === 'ArrowUp') switchChannel(1);
    if (e.code === 'ArrowDown') switchChannel(-1);
    if (e.code === 'ArrowRight') adjustVolume(10);
    if (e.code === 'ArrowLeft') adjustVolume(-10);
});

// Touch
let touchStartY = 0;
document.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: false });
document.addEventListener('touchend', e => {
    if (!isTVOn) return;
    let diff = touchStartY - e.changedTouches[0].clientY;
    if (Math.abs(diff) > 50) { if (diff > 0) switchChannel(1); else switchChannel(-1); }
}, { passive: false });
