# NBA Night TV - Tasks

- [x] **Project Setup**
    - [x] Clone repository
    - [x] Create virtual environment
    - [x] Install dependencies

- [x] **Core Functionality**
    - [x] Server-side data fetching (`scripts/fetch_nba.py`)
    - [x] Frontend video player logic (`index.html`)
    - [x] YouTube IFrame API integration

- [x] **UI/UX Refinements**
    - [x] **Persistent TV Bezel**: Blue frame around video.
    - [x] **Power Control**: Single ON/OFF toggle.
    - [x] **Remote Control Redesign**: Neon/Cyberpunk style, centered.
    - [x] **Remote Interaction**: Auto-hide on play, hover to show.
    - [x] **Keyboard Controls**: Separate Volume (Left/Right) and Channel (Up/Down).
    - [x] **Mobile Experience**: Swipe up/down for channels.
    - [x] **Seamless Switching**: Preload players in background.
    - [x] **Hide Suggestions**: Static noise overlay on video end.
    - [x] **Fix Audio Overlap**: Ensure background channels are strictly muted.
    - [x] **Double Buffering**: Seamless video transition within channel (load next before current ends).
    - [x] **Sliding Remote UI**: 16:9 sidebar remote that reveals on hover.

- [x] **Deployment & Verification**
    - [x] **User Action**: Change GitHub Pages source to `main`.
    - [x] Local Verification of new transitions.
    - [x] Live Site Verification.
    - [x] **Automation Update**: Ensure GitHub Actions runs reliably.

## Current Roadmap (Prioritized)

### Phase 1: API Migration & Optimization 🔥 PRIORITY
- [ ] **Migrate to Uploads Playlist API** (Incremental, Safe)
    - [x] Update `fetch_nba.py` to use PlaylistItems API instead of Search API (100x cheaper)
    - [x] Implement UC→UU conversion for Uploads Playlist IDs
    - [x] Add Shorts filter (< 60s duration)
    - [x] Add Live stream filter
    - [x] **Keep existing output format** (`"1"` and `"2"` keys) - NO breaking changes
    - [x] Test locally with existing channels
    - [ ] Deploy and verify 24h stability
- [x] **Add `isodate` dependency**
    - [x] Update `requirements.txt`
    - [x] Update `.github/workflows/update_tv.yml`

### Phase 2: Multi-Source Content Expansion
- [x] **Create Source Configuration System**
    - [x] Design `sources_config.json` schema
    - [x] Map all 18 source channels (6 themed TV channels)
    - [x] Define time windows per source (24h, 7d, 14d, 30d, all-time)
    - [x] Define filters per source (must_contain, exclude_keywords)
- [ ] **Enhance Fetcher for Multi-Source**
    - [x] Loop over sources in config
    - [x] Apply keyword filtering (NBA-only for ESPN, etc.)
    - [x] Implement members-only detection and exclusion
    - [x] Generate per-channel JSON outputs
    - [x] **Support Per-Source Trimming**: Allow `trim_seconds` in config to override default channel trim.
    - [x] Add shuffle logic for specific channel types
- [ ] **Content Audit Tool** (Optional but Recommended)
    - [ ] Build `scripts/audit_content.py` for pre-publish review
    - [ ] HTML table view with filters/sorting
    - [ ] Manual approval workflow

### Phase 3: Frontend Multi-Channel Support
- [ ] **Expand Channel Infrastructure**
    - [ ] Update `app.js` to support 7 channels (0-6)
    - [ ] Update channel switcher logic (loop 0→6)
    - [ ] Load channel-specific playlists from new JSON structure
    - [ ] **Dynamic Video Trimming**: Read `trim` property from video object and override channel default.
    - [ ] Update `CHANNELS` config with themed names ("TACTICAL", "STORIES", etc.)
    - [ ] Update OSD to display channel themes
- [ ] **Player Management**
    - [ ] Extend `players` object for additional channels
    - [ ] Extend `channelState` initialization
    - [ ] Test channel transitions across all 7 channels

### Phase 4: UX & Code Polish
- [ ] **Visual Stability & Standards**
    - [ ] **CSS Fixes**: Add standard `mask` property, remove duplicate rules
    - [ ] **Z-Index Cleanup**: Define semantic variables for z-index layers
- [ ] **Remote UX Overhaul**
    - [ ] **Desktop Discovery**: Add visual cues for hidden remote location
    - [ ] **Design Update**: Refresh look, add arrow legends, "Space = Power"
    - [ ] **Mobile Layout**: Redesign remote (tap-to-hide works, but intrusive when open)

### Phase 5: Advanced Content Features
- [ ] **Playback Limits & Freshness**
    - [ ] Track video playback history (localStorage)
    - [ ] Enforce max plays per day/week/month
    - [ ] Skip videos exceeding limits
- [ ] **Deduplication (Stories Channel)**
    - [ ] Track player mentions per video
    - [ ] Limit repetitive player coverage (max 2 LeBron videos in sequence)
- [ ] **Topic Filtering**
    - [ ] Player-specific mode (e.g., Deni Avdija channel)
    - [ ] Team-specific mode
    - [ ] City-specific mode

## Backlog (Future Vision)

### Context-Aware Satellite Channels ⭐ Core Product Vision
- [ ] **Context Engine**: Build mechanism to sync satellite channels with main channel's current game
- [ ] **Main Channel Behavior**: Decide "Live Mode" vs "Context Lock"
- [ ] **Context Change Indicator**: Visual alert when main channel moves to next game
- [ ] **Satellite Content Types**: Define categories (Pre-game, Post-game, Interviews, Alt Angles)
- [ ] **Manual Content Selection**: Allow user to pick which game context to explore
- [ ] **Content Expansion** (Dependent on Context Engine)
    - [ ] Add "Top 10" Channel (Satellite)
    - [ ] Add "Classics" Channel (Satellite)
    - [ ] Add "Context-Aware News" Channel
