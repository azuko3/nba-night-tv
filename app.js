// --- STATE ---
let isTVOn = false;
let currentChannel = 1;
let volume = 100;

// Debug Flag
const urlParams = new URLSearchParams(window.location.search);
const isDebug = urlParams.get('debug') === '1';

// Channel Data
let playlistData = {};
// Initialize for 7 channels
for (let i = 1; i <= 7; i++) playlistData[i] = [];

// Player Architecture: 7 channels, each has 2 players (A/B)
let players = {};
let channelState = {};

// Initialize State Objects
for (let i = 1; i <= 7; i++) {
    players[i] = { A: null, B: null };
    channelState[i] = { activeSlot: 'A', videoIndex: 0, nextPrepared: false, upNextShown: false };
}

let pollInterval = null;

// Channel Configuration (Centralized)
const CHANNELS = {
    1: { name: "RECAPS", type: "MAIN", color: "#0050ff", trimEnd: 11 },
    2: { name: "ANALYTICS", type: "SATELLITE", color: "#9d00ff", trimEnd: 0 },
    3: { name: "RETRO", type: "SATELLITE", color: "#ffd700", trimEnd: 0 },
    4: { name: "MIC'D", type: "SATELLITE", color: "#00ff00", trimEnd: 0 },
    5: { name: "BUZZ", type: "SATELLITE", color: "#ff8c00", trimEnd: 0 },
    6: { name: "DENI", type: "SATELLITE", color: "#e0efff", trimEnd: 0 },
    7: { name: "STORY+", type: "SATELLITE", color: "#00ffff", trimEnd: 0 }
};

// Fallback Playlist (Offline Mode)
const FALLBACK_PLAYLIST = {
    1: [{ id: '_nxTNmM9lfY', title: 'Fallback NBA' }],
    2: ['dQw4w9WgXcQ'],
    3: ['dQw4w9WgXcQ'],
    4: ['dQw4w9WgXcQ'],
    5: ['dQw4w9WgXcQ'],
    6: ['dQw4w9WgXcQ'],
    7: ['dQw4w9WgXcQ']
};

// --- INITIALIZATION ---
async function loadPlaylists() {
    try {
        const res = await fetch('playlist.json?t=' + Date.now());
        if (res.ok) {
            const data = await res.json();

            // Loop 1-7 to load data
            for (let i = 1; i <= 7; i++) {
                let key = String(i);
                if (data[key] && data[key].length) {
                    playlistData[i] = data[key];
                    // Client-Side Shuffle for freshness
                    shuffleArray(playlistData[i]);
                }
            }

            // Verify Context Parsing (Debug only on Ch 1)
            if (isDebug && playlistData[1].length) {
                console.log("--- CONTEXT ENGINE VERIFICATION ---");
                playlistData[1].forEach(item => {
                    let t = (typeof item === 'string') ? item : item.title;
                    parseGameTitle(t);
                });
                console.log("-----------------------------------");
            }
        } else {
            throw new Error("Playlist fetch failed");
        }
    } catch (e) {
        console.warn("Fetch failed, using FALLBACK", e);
        playlistData = { ...FALLBACK_PLAYLIST };
        showSystemOSD("OFFLINE MODE");
    }
}

// Global callback for YouTube API
window.onYouTubeIframeAPIReady = function () {
    // Apply debug class if needed
    if (isDebug) document.body.classList.add('debug-mode');

    loadPlaylists().then(() => {
        // Init all 7 channels
        for (let i = 1; i <= 7; i++) {
            initChannel(i);
        }
        startPoller();
    });
}

function initChannel(id) {
    if (!playlistData[id] || playlistData[id].length === 0) {
        console.warn(`Channel ${id} has no data, skipping init.`);
        return;
    }
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

    // Safety check for empty data
    if (!playlistData[channelId] || playlistData[channelId].length === 0) return;

    // Handle both String (Legacy) and Object (New) formats
    let item = playlistData[channelId][vidIdx % playlistData[channelId].length];
    let videoId = (typeof item === 'string') ? item : item.id;

    // Check for debug flags (Use global isDebug)
    const showControls = isDebug ? 1 : 0;

    players[channelId][slot] = new YT.Player(divId, {
        videoId: videoId,
        host: 'https://www.youtube-nocookie.com',
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
            },
            'onStateChange': (e) => {
                // Event-Based Buffering Logic
                // If video starts PLAYING (1) and it is NOT the active visual slot, PAUSE it.
                // This ensures background videos buffer just enough and then stop.
                if (e.data === YT.PlayerState.PLAYING) {
                    let currentActiveSlot = channelState[channelId].activeSlot;
                    let isThisSlotActive = (slot === currentActiveSlot && channelId === currentChannel);

                    // Specific check: If I am Channel 1 Slot A (Initial), I should play.
                    // Otherwise, only play if I am the active swapped-in slot.
                    // Also allow if nextPrepared is True (Pre-start phase)
                    let isInitialStart = (!isTVOn && isInitiallyActive);
                    let isPreStart = channelState[channelId].nextPrepared;

                    if (!isThisSlotActive && !isInitialStart && !isPreStart) {
                        // Background Player -> Pause
                        // Wait tiny bit to ensure buffer fill?
                        // No, YouTube PLAYING state implies buffer is sufficient.
                        if (isDebug) console.log(`[DEBUG] Pausing background player: Ch${channelId}-${slot}`);
                        e.target.pauseVideo();
                    } else {
                        if (isDebug) console.log(`[DEBUG] Player allowed to play: Ch${channelId}-${slot}`);
                    }
                }
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
                // Update progress bar
                let pct = Math.min(100, (now / duration) * 100);
                document.getElementById('progress-fill').style.width = pct + '%';

                // Calculate Trigger Points
                // Use Generic Config
                let config = CHANNELS[currentChannel];
                let trim = (config && config.trimEnd) || 0;

                // Dynamic Trim (Per-Video Override)
                let currentItem = playlistData[currentChannel][chState.videoIndex];
                if (currentItem && typeof currentItem === 'object' && typeof currentItem.trim === 'number') {
                    trim = currentItem.trim;
                    if (isDebug) console.log(`[DEBUG] Using dynamic trim: ${trim}s for ${currentItem.id}`);
                }

                // Minimum safety buffer of 0.2s if trim is 0
                if (trim === 0) trim = 0.2;

                let swapPoint = duration - trim;
                let preStartPoint = swapPoint - 2; // Start next video 2s before swap
                let notifyTime = swapPoint - 15;   // Notify user 15s before swap

                // DEBUG LOGGING
                if (isDebug && Math.floor(now) % 5 === 0) {
                    console.log(`[DEBUG] Time: ${now.toFixed(1)} / ${duration.toFixed(1)} | Swap: ${swapPoint.toFixed(1)} | Pre: ${preStartPoint.toFixed(1)}`);
                }

                // 0. Trigger "Up Next" Notification
                if (now >= notifyTime && now < swapPoint && !chState.upNextShown) {
                    if (isDebug) console.log(`[DEBUG] >>> UP NEXT NOTIFICATION at ${now.toFixed(1)}`);

                    let nextIdx = (chState.videoIndex + 1) % playlistData[currentChannel].length;
                    let nextItem = playlistData[currentChannel][nextIdx];
                    let nextTitle = (typeof nextItem === 'string') ? "Next Program" : nextItem.title;

                    showUpNext(nextTitle);
                    chState.upNextShown = true;
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

    // Ensure new player is actually playing (fixes autoplay regression)
    newPlayer.playVideo();

    oldPlayer.mute();
    oldDiv.classList.remove('active');

    // 3. Update State
    chState.activeSlot = newSlot;
    chState.videoIndex = (chState.videoIndex + 1) % playlistData[channelId].length;
    chState.nextPrepared = false;
    chState.upNextShown = false;
    hideUpNext();
    if (channelId === currentChannel) {
        document.getElementById('progress-fill').style.width = '0%';
    }

    // 4. Recycle Old Player (Load Next+1)
    let nextNextIndex = (chState.videoIndex + 1) % playlistData[channelId].length;
    let nextNextItem = playlistData[channelId][nextNextIndex];
    let nextNextId = (typeof nextNextItem === 'string') ? nextNextItem : nextNextItem.id;

    setTimeout(() => {
        oldPlayer.stopVideo();
        oldPlayer.loadVideoById(nextNextId); // YT API handles string ID
        // Background players: Play to buffer, then PAUSE
        oldPlayer.playVideo();
        oldPlayer.mute();
        setTimeout(() => oldPlayer.pauseVideo(), 1500);
    }, 1000);

    // Show Title OSD (Delayed by 5s)
    let currentItem = playlistData[channelId][chState.videoIndex];
    let title = (typeof currentItem === 'string') ? "" : currentItem.title;
    if (channelId === currentChannel && title) {
        setTimeout(() => {
            if (channelId === currentChannel && isTVOn) {
                showOSD(title);
            }
        }, 5000); // 5 Seconds Delay
    }
}

// --- CHANNEL BADGE ---
function updateChannelBadge(highlight) {
    let badge = document.getElementById('channel-badge');
    let numEl = document.getElementById('badge-number');
    let nameEl = document.getElementById('badge-name');
    let ch = CHANNELS[currentChannel];
    numEl.textContent = `CH ${currentChannel}`;
    nameEl.textContent = ch ? ch.name : '';
    if (ch) badge.style.setProperty('--badge-color', ch.color);
    if (highlight) {
        badge.classList.remove('highlight');
        void badge.offsetWidth; // reflow to restart animation
        badge.classList.add('highlight');
    }
}

// --- POWER LOGIC ---
function togglePower() {
    isTVOn = !isTVOn;
    let frame = document.getElementById('tv-frame');

    if (isTVOn) {
        // Boot flash animation
        let flash = document.getElementById('boot-flash');
        flash.classList.remove('flash');
        void flash.offsetWidth;
        flash.classList.add('flash');

        frame.classList.add('tv-playing');
        frame.classList.add('tv-on');

        // Wake up active player
        let slot = channelState[currentChannel].activeSlot;
        let p = players[currentChannel][slot];
        if (p) { p.unMute(); p.setVolume(volume); p.playVideo(); }

        updateChannelBadge(true);
        showSystemOSD("POWER ON");

        // Show Title after "POWER ON" fades
        setTimeout(() => {
            if (isTVOn) {
                let currentItem = playlistData[currentChannel][channelState[currentChannel].videoIndex];
                let title = (typeof currentItem === 'string') ? "" : currentItem.title;
                if (title) showOSD(title);
            }
        }, 2200);
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

    // Skip Empty Channels Logic
    let nextCh = currentChannel;
    let attempts = 0;

    do {
        if (direction > 0) {
            nextCh = (nextCh >= 7) ? 1 : nextCh + 1;
        } else {
            nextCh = (nextCh <= 1) ? 7 : nextCh - 1;
        }
        attempts++;
    } while ((!playlistData[nextCh] || playlistData[nextCh].length === 0) && attempts < 8);

    // If we found a valid channel (or looped back to start if all empty)
    currentChannel = nextCh;

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
            showSystemOSD(`CH ${currentChannel} · ${name}`);
            updateChannelBadge(true);

            // Show Title after channel name fades (2.5s later)
            setTimeout(() => {
                if (channelId === currentChannel && isTVOn) {
                    let currentItem = playlistData[currentChannel][channelState[currentChannel].videoIndex];
                    let title = (typeof currentItem === 'string') ? "" : currentItem.title;
                    if (title) showOSD(title);
                }
            }, 2500);

        }, 300);
    }
}

function adjustVolume(delta) {
    if (!isTVOn) return;
    volume = Math.max(0, Math.min(100, volume + delta));
    let slot = channelState[currentChannel].activeSlot;
    let p = players[currentChannel][slot];
    if (p) p.setVolume(volume);
    showSystemOSD(`VOL ${volume}%`);
}

function showSystemOSD(text) {
    let osd = document.getElementById('osd-system');
    osd.innerText = text;
    osd.style.display = 'block';
    if (window.sysOsdTimer) clearTimeout(window.sysOsdTimer);
    window.sysOsdTimer = setTimeout(() => osd.style.display = 'none', 2000);
}

function showOSD(text) {
    let osd = document.getElementById('osd-display');

    // Broadcast Style Logic
    let htmlContent = '';

    // Check for "Split" keyword (usually found in YouTube titles)
    const splitKey = " Full Game Highlights";
    let splitIdx = text.indexOf(splitKey);

    if (splitIdx > -1) {
        // It's a Game Title
        let mainTitle = text.substring(0, splitIdx);
        let subTitle = text.substring(splitIdx).trim(); // Keep "Full Game Highlights..."

        htmlContent = `
            <div class="osd-label">NOW PLAYING</div>
            <div class="osd-title">${mainTitle}</div>
            <div class="osd-subtitle">${subTitle}</div>
        `;
    } else {
        // Simple Message (e.g. POWER ON, CH 01)
        htmlContent = `<div class="osd-title" style="margin-bottom:0">${text}</div>`;
    }

    osd.innerHTML = htmlContent;
    osd.style.display = 'flex'; // Flex for centering

    if (window.osdTimer) clearTimeout(window.osdTimer);
    // Longer timeout for reading big titles
    window.osdTimer = setTimeout(() => osd.style.display = 'none', 4000);
}

function showUpNext(title) {
    let osd = document.getElementById('osd-up-next');

    // Clean title
    let cleanTitle = title.replace(" Full Game Highlights", "").replace("Full Game Highlights", "");

    osd.innerHTML = `
        <div class="up-next-label">COMING UP</div>
        <div class="up-next-title">${cleanTitle}</div>
    `;

    osd.style.display = 'flex';
}

function hideUpNext() {
    let osd = document.getElementById('osd-up-next');
    osd.style.display = 'none';
}

// --- CONTEXT ENGINE (Game ID Parsing) ---
function parseGameTitle(title) {
    if (!title) return null;

    // Regex Strategy:
    // 1. Identify Teams: "Team A vs Team B"
    // 2. Identify Date: "Month DD, YYYY" or ISO

    // Split title by " vs "
    // Example: "Boston Celtics vs Detroit Pistons Full Game Highlights..."
    let vsSplit = title.split(" vs ");
    if (vsSplit.length < 2) return null;

    let team1Raw = vsSplit[0].trim();
    let remainder = vsSplit[1];

    // Find Team 2 end? usually " Full Game" or " Highlights"
    let team2 = "UNK";
    let team2Raw = remainder;

    // Common delimiters in YouTube titles
    const delimiters = [" Full Game", " Highlights", " |", " - "];
    for (let d of delimiters) {
        if (team2Raw.includes(d)) {
            team2Raw = team2Raw.split(d)[0];
            break;
        }
    }

    // Map to Codes
    let t1Code = NBA_TEAMS[team1Raw] || "UNK";
    let t2Code = NBA_TEAMS[team2Raw] || "UNK";

    // Extract Date
    // Pattern: January 19, 2026
    const dateRegex = /([a-zA-Z]+ \d{1,2}, \d{4})/;
    let dateMatch = title.match(dateRegex);
    let dateStr = "00000000";

    if (dateMatch) {
        let d = new Date(dateMatch[1]);
        if (!isNaN(d.getTime())) {
            let y = d.getFullYear();
            let m = String(d.getMonth() + 1).padStart(2, '0');
            let day = String(d.getDate()).padStart(2, '0');
            dateStr = `${y}${m}${day}`;
        }
    }

    // Create ID
    let gameId = `${t1Code}-${t2Code}-${dateStr}`;

    if (isDebug) console.log(`[Context] Parsed: ${title} -> ${gameId}`);
    return { id: gameId, t1: t1Code, t2: t2Code, date: dateStr };
}

function showStatic() { document.getElementById('static-overlay').style.opacity = 0.4; }
function hideStatic() { document.getElementById('static-overlay').style.opacity = 0; }

// --- UTILS ---
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// --- INPUT HANDLING ---
// --- INPUT HANDLING ---
// Use window level and capturing phase to try and catch events before iframe steals them completely
// Note: If focus is INSIDE iframe, standard JS listeners often fail.
// User might need to click the "Bezel" to regain focus.
window.addEventListener('keydown', (e) => {
    if (isDebug) console.log("[DEBUG] Key:", e.code);

    if (e.code === 'Space' || e.code === 'Enter') togglePower();

    if (!isTVOn) return;

    if (e.code === 'ArrowUp') {
        e.preventDefault(); // Stop scrolling
        switchChannel(1);
    }
    if (e.code === 'ArrowDown') {
        e.preventDefault();
        switchChannel(-1);
    }
    if (e.code === 'ArrowRight') adjustVolume(10);
    if (e.code === 'ArrowLeft') adjustVolume(-10);
}, true); // Use Capture phase

// Touch
let touchStartY = 0;
document.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: false });
document.addEventListener('touchend', e => {
    if (!isTVOn) return;
    let diff = touchStartY - e.changedTouches[0].clientY;
    if (Math.abs(diff) > 50) { if (diff > 0) switchChannel(1); else switchChannel(-1); }
}, { passive: false });
