#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import re
import json
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone, date, timedelta
from typing import Any, Dict, List, Optional, Tuple

try:
    from googleapiclient.discovery import build
except Exception:
    build = None

# --- CONSTANTS ---
FETCH_N = 200
RULE_OF_3 = 3
CATASTROPHIC_FAIL_RATIO = 0.80
GLOBAL_MIN_SECONDS = 15
RECAP_MIN_SECONDS = 180
VAULT_MIN_SECONDS = 60
ACTION_MIN_SECONDS = 30

# --- REGEX PATTERNS ---
DATE_RE = re.compile(r"\|\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*$")
EXCLUDED_KEYWORDS_RE = re.compile(r"\b(WNBA|G-?League|2K\d+|Promo|Preview|Trailer)\b", re.IGNORECASE)
RECAP_INCLUDE_RE = re.compile(r"\bFULL GAME HIGHLIGHTS\b", re.IGNORECASE)
ACTION_INCLUDE_RE = re.compile(r"\b(Top\s*(10|5)|Plays of the (Night|Week)|Dunk of the Night|Assist of the Night|Block of the Night|Posterized|Clutch)\b", re.IGNORECASE)
INSIDE_INCLUDE_RE = re.compile(r"\b(Mic['’]d Up|Sound of the Game|Shaqtin|Postgame|Interview|Mini-?Movie|All-?Access)\b", re.IGNORECASE)
VAULT_INCLUDE_RE = re.compile(r"\b(Classic Game|Hardwood Classics|Ultimate Mixtape|Career High|Retrospective|On This Day)\b", re.IGNORECASE)
ACTION_BLOCK_A_RE = re.compile(r"\b(Top\s*(10|5)|Plays of the Night)\b", re.IGNORECASE)
ACTION_BLOCK_B_RE = re.compile(r"\b(Dunk of the Night|Assist of the Night|Block of the Night|Posterized|Clutch)\b", re.IGNORECASE)
ACTION_BLOCK_C_RE = re.compile(r"\bPlays of the Week\b", re.IGNORECASE)

@dataclass
class Video:
    id: str
    title: str
    published_at: datetime
    duration_seconds: int
    game_date: Optional[date]
    like_count: int = 0
    view_count: int = 0
    channel: Optional[str] = None
    action_type: Optional[str] = None

def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def parse_game_date(title: str) -> Optional[date]:
    m = DATE_RE.search(title)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%B %d, %Y").date()
    except ValueError:
        return None

def duration_iso8601_to_seconds(dur: str) -> int:
    m = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", dur)
    if not m: return 0
    h, mi, s = int(m.group(1) or 0), int(m.group(2) or 0), int(m.group(3) or 0)
    return h * 3600 + mi * 60 + s

def global_filter(title: str, duration_seconds: int) -> bool:
    if duration_seconds < GLOBAL_MIN_SECONDS: return False
    if EXCLUDED_KEYWORDS_RE.search(title): return False
    return True

def resolve_active_day(videos: List[Video], now_utc: datetime) -> Tuple[date, bool]:
    dated_videos = [v for v in videos if v.game_date is not None]
    buckets = {}
    for v in dated_videos: buckets[v.game_date] = buckets.get(v.game_date, 0) + 1
    valid_dates = [d for d, c in buckets.items() if c >= RULE_OF_3]
    
    if not valid_dates:
        selected = max((v.game_date for v in dated_videos if v.game_date), default=now_utc.date())
    else:
        selected = sorted(valid_dates, reverse=True)[0]
    
    selected_noon = datetime(selected.year, selected.month, selected.day, 12, 0, tzinfo=timezone.utc)
    is_dark = (now_utc - selected_noon) > timedelta(hours=48)
    return selected, is_dark

def assign_channel_waterfall(v: Video) -> Optional[str]:
    if VAULT_INCLUDE_RE.search(v.title) and v.duration_seconds > VAULT_MIN_SECONDS: return "vault"
    if RECAP_INCLUDE_RE.search(v.title):
        if v.duration_seconds >= RECAP_MIN_SECONDS and v.game_date: return "recap"
        return None
    if ACTION_INCLUDE_RE.search(v.title):
        if v.duration_seconds >= ACTION_MIN_SECONDS: return "action"
        return None
    if INSIDE_INCLUDE_RE.search(v.title): return "inside"
    return None

def get_smart_filler(candidates: List[Video], n: int) -> List[Video]:
    return sorted(candidates, key=lambda v: (v.like_count, v.view_count, int(_utc(v.published_at).timestamp())), reverse=True)[:n]

def build_action_playlist(active_day: date, videos: List[Video], min_sec: int) -> List[Video]:
    daily = [v for v in videos if v.game_date == active_day]
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    weekly = [v for v in videos if v.game_date != active_day and _utc(v.published_at) >= cutoff]
    
    block_a = [v for v in daily if ACTION_BLOCK_A_RE.search(v.title)]
    block_b = [v for v in daily if not ACTION_BLOCK_A_RE.search(v.title) and ACTION_BLOCK_B_RE.search(v.title)]
    block_daily_rest = [v for v in daily if v not in block_a and v not in block_b]
    
    plays_week = [v for v in weekly if ACTION_BLOCK_C_RE.search(v.title)]
    rest_pool = [v for v in weekly if v not in plays_week]
    best_rest = get_smart_filler(rest_pool, 5)
    
    import random
    rng = random.Random(f"action:{active_day}")
    for l in [block_a, block_b, block_daily_rest]: rng.shuffle(l)
    
    pl = block_a + block_b + block_daily_rest
    if sum(v.duration_seconds for v in pl) < min_sec:
        rng.shuffle(plays_week)
        pl += plays_week
        if sum(v.duration_seconds for v in pl) < min_sec: pl += best_rest
        
    for v in pl: v.action_type = "daily" if v.game_date == active_day else "filler"
    return pl

def build_inside_playlist(active_day: date, videos: List[Video], now_utc: datetime) -> List[Video]:
    daily, rolling = [], []
    cutoff = now_utc - timedelta(days=4)
    for v in videos:
        is_today = (v.game_date == active_day) or ((now_utc - _utc(v.published_at)) < timedelta(hours=24))
        if is_today: daily.append(v)
        elif _utc(v.published_at) > cutoff: rolling.append(v)
        
    best_rolling = get_smart_filler(rolling, 15)
    import random
    rng = random.Random(f"inside:{active_day}")
    rng.shuffle(daily)
    
    chunked = []
    for i in range(0, len(best_rolling), 5):
        c = best_rolling[i:i+5]
        rng.shuffle(c)
        chunked.extend(c)
    return daily + chunked

def youtube_fetch(api_key, ch_id, n):
    yt = build("youtube", "v3", developerKey=api_key)
    uploads_id = yt.channels().list(part="contentDetails", id=ch_id).execute()["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
    videos, next_page = [], None
    while len(videos) < n:
        pl = yt.playlistItems().list(part="contentDetails", playlistId=uploads_id, maxResults=min(50, n-len(videos)), pageToken=next_page).execute()
        vid_ids = [i["contentDetails"]["videoId"] for i in pl.get("items", [])]
        if not vid_ids: break
        v_resp = yt.videos().list(part="snippet,contentDetails,statistics", id=",".join(vid_ids)).execute()
        videos.extend(v_resp.get("items", []))
        next_page = pl.get("nextPageToken")
        if not next_page: break
    return videos[:n]

def fetch_vault(api_key, ids):
    if not ids: return []
    yt = build("youtube", "v3", developerKey=api_key)
    videos = []
    for i in range(0, len(ids), 50):
        batch = ids[i:i+50]
        try:
            resp = yt.videos().list(part="snippet,contentDetails,statistics", id=",".join(batch)).execute()
            videos.extend(resp.get("items", []))
        except: pass
    return videos

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--channel-id", required=True)
    parser.add_argument("--vault-file", default="vault_library.json")
    parser.add_argument("--out", default="manifest.json")
    parser.add_argument("--last-good", default="manifest.last_good.json")
    args = parser.parse_args()

    print("Fetching feed...")
    feed = youtube_fetch(args.api_key, args.channel_id, FETCH_N)
    
    print("Fetching vault...")
    with open(args.vault_file) as f: vault_ids = json.load(f)
    vault_items = fetch_vault(args.api_key, vault_ids)

    # BUILD
    last_good = None
    if os.path.exists(args.last_good):
        try: 
            with open(args.last_good) as f: last_good = json.load(f)
        except: pass
        
    logs, parsed, regex_fail = [], [], 0
    now_utc = datetime.now(timezone.utc)
    
    for it in feed:
        try:
            dur = duration_iso8601_to_seconds(it["contentDetails"]["duration"])
            if not global_filter(it["snippet"]["title"], dur): continue
            gd = parse_game_date(it["snippet"]["title"])
            if not gd: regex_fail += 1
            parsed.append(Video(it["id"], it["snippet"]["title"], datetime.fromisoformat(it["snippet"]["publishedAt"].replace("Z", "+00:00")), dur, gd, int(it.get("statistics",{}).get("likeCount",0)), int(it.get("statistics",{}).get("viewCount",0))))
        except: continue

    ratio = regex_fail / max(1, len(feed))
    if ratio > CATASTROPHIC_FAIL_RATIO:
        print("CRITICAL FAIL. Using last good.")
        if last_good:
            with open(args.out, "w") as f: json.dump(last_good, f)
            return
    
    active_day, is_dark = resolve_active_day(parsed, now_utc)
    recap, action, inside = [], [], []
    for v in parsed:
        ch = assign_channel_waterfall(v)
        v.channel = ch
        if ch == "recap": recap.append(v)
        elif ch == "action": action.append(v)
        elif ch == "inside": inside.append(v)
        
    import random
    rng = random.Random(f"recap:{active_day}")
    recap_final = [v for v in recap if v.game_date == active_day]
    rng.shuffle(recap_final)
    
    action_final = build_action_playlist(active_day, action, 900)
    inside_final = build_inside_playlist(active_day, inside, now_utc)
    
    vault_parsed = []
    for it in vault_items:
        try: vault_parsed.append(Video(it["id"], it["snippet"]["title"], now_utc, duration_iso8601_to_seconds(it["contentDetails"]["duration"]), None))
        except: pass
    
    today_str = now_utc.strftime("%b %d")
    vault_today = [v for v in vault_parsed if today_str in v.title]
    vault_rest = [v for v in vault_parsed if v not in vault_today]
    rng_v = random.Random(f"vault:{active_day}")
    rng_v.shuffle(vault_today); rng_v.shuffle(vault_rest)
    vault_final = (vault_today + vault_rest)[:20]

    manifest = {
        "meta": {"generated_at": now_utc.isoformat(), "active_day": active_day.isoformat(), "is_dark": is_dark},
        "channels": {
            "recap": [{"id": v.id, "title": v.title, "duration": v.duration_seconds} for v in recap_final],
            "action": [{"id": v.id, "title": v.title, "duration": v.duration_seconds} for v in action_final],
            "inside": [{"id": v.id, "title": v.title, "duration": v.duration_seconds} for v in inside_final],
            "vault": [{"id": v.id, "title": v.title, "duration": v.duration_seconds} for v in vault_final],
        }
    }
    
    tmp = args.out + ".tmp"
    with open(tmp, "w") as f: json.dump(manifest, f)
    os.replace(tmp, args.out)
    
    tmp2 = args.last_good + ".tmp"
    with open(tmp2, "w") as f: json.dump(manifest, f)
    os.replace(tmp2, args.last_good)

if __name__ == "__main__":
    main()
