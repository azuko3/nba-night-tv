import os
import json
import requests
import isodate 
from datetime import datetime, timedelta, timezone

# --- CONFIGURATION ---
API_KEY = os.environ.get("YOUTUBE_API_KEY")
CONFIG_FILE = "sources_config.json"
OUTPUT_FILE = "playlist.json"

if not API_KEY:
    raise Exception("Error: YOUTUBE_API_KEY is missing.")

def load_config():
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def get_uploads_from_playlist(playlist_id, days_back, limit=10):
    """Fetches videos from a playlist (UU...) cheaper than search (1 unit)."""
    videos = []
    base_url = "https://www.googleapis.com/youtube/v3/playlistItems"
    
    # Calculate cutoff date (offset-aware UTC)
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_back)
    
    params = {
        "part": "snippet,contentDetails",
        "playlistId": playlist_id,
        "maxResults": limit, 
        "key": API_KEY
    }

    try:
        response = requests.get(base_url, params=params)
        data = response.json()
        
        if "items" not in data:
            print(f"Warning: No items found for playlist {playlist_id}")
            return []

        # Filter by Date first to save calls on details
        candidates = []
        for item in data["items"]:
            # Some items might store publishedAt in snippet, some in contentDetails, standardizing check
            published_at_str = item["contentDetails"].get("videoPublishedAt") or item["snippet"].get("publishedAt")
            try:
                # Handle Z by replacing with +00:00 for isoformat compatibility
                pub_date = datetime.fromisoformat(published_at_str.replace('Z', '+00:00'))
            except:
                continue # Skip if date format error
            
            if pub_date >= cutoff_date:
                candidates.append(item)
        
        if not candidates:
            return []

        # Now fetch details (duration) for candidates
        video_ids = [item["contentDetails"]["videoId"] for item in candidates]
        return fetch_video_details(video_ids)

    except Exception as e:
        print(f"Error fetching playlist {playlist_id}: {e}")
        return []

def search_keywords(keywords, days_back):
    """Placeholder for keyword search if needed later."""
    print(f"Searching for keywords: {keywords} (Feature not fully enabled to save quota)")
    return [] 

def fetch_video_details(video_ids):
    """Get content details (duration) and status (embeddable)."""
    if not video_ids:
        return []
        
    url = "https://www.googleapis.com/youtube/v3/videos"
    params = {
        "part": "contentDetails,snippet,status",
        "id": ",".join(video_ids),
        "key": API_KEY
    }
    
    res = requests.get(url, params=params)
    data = res.json()
    items = []
    
    if "items" in data:
        for item in data["items"]:
            # Normalize structure for frontend
            items.append({
                "id": item["id"],
                "title": item["snippet"]["title"],
                "snippet": item["snippet"],           # Keep raw snippet for future use
                "contentDetails": item["contentDetails"], # Keep raw details for duration check
                "status": item["status"]
            })
    return items

def filter_videos(videos_data, settings, source_rules):
    """Applies global settings and channel-specific rules."""
    valid_videos = []
    
    for video in videos_data:
        vid_id = video["id"]
        title = video["title"]
        duration_iso = video["contentDetails"]["duration"] 
        is_embeddable = video["status"]["embeddable"]
        
        # 1. Must be embeddable
        if not is_embeddable:
            continue

        # 2. Duration Check (Filter Shorts)
        try:
            duration = isodate.parse_duration(duration_iso)
            if settings.get("ignore_shorts", True) and duration.total_seconds() < 60:
                continue
        except:
            pass 

        # 3. Channel Specific: Exclude Keywords
        exclude_words = source_rules.get("exclude_keywords", [])
        if any(word.lower() in title.lower() for word in exclude_words):
            print(f"Skipped (Exclude Keyword): {title}")
            continue

        # 4. Channel Specific: Must Contain
        must_words = source_rules.get("must_contain", [])
        if must_words:
            # Matches if AT LEAST ONE word is present
            if not any(word.lower() in title.lower() for word in must_words):
                print(f"Skipped (Missing Context): {title}")
                continue

        # Append minimal object for playlist.json
        # Append object for playlist.json
        # Include source-specific override if present
        video_obj = {
            "id": vid_id,
            "title": title
        }
        
        # Inject per-source trim if defined
        if "trim_seconds" in source_rules:
            video_obj["trim"] = source_rules["trim_seconds"]

        valid_videos.append(video_obj)
    
    return valid_videos

def main():
    print("Starting Content Fetcher...")
    try:
        config = load_config()
    except Exception as e:
        print(f"Failed to load config: {e}")
        return

    final_playlist = {}
    
    # Iterate over channels defined in config
    for ch_config in config["channels"]:
        print(f"\nProcessing Channel {ch_config['id']}: {ch_config['name']}")
        channel_videos = []
        
        # Iterate over sources within that channel
        sources = ch_config.get("sources", [])
        
        # Handle Keyword Search Channels (like Deni Avdija)
        if ch_config.get("type") == "keyword_search":
             # Logic placeholder - currently skips to save quota unless implemented
             print("Skipping keyword search channel for now.")
             continue

        for source in sources:
            print(f"  > Source: {source['name']}")
            
            days = source.get("time_window_days", ch_config.get("time_window_days", 7))
            
            raw_videos = []
            
            if "playlist_id" in source:
                raw_videos = get_uploads_from_playlist(source["playlist_id"], days)
            
            # Filter and add
            filtered_videos = filter_videos(raw_videos, config["settings"], source)
            print(f"    Added {len(filtered_videos)} videos.")
            channel_videos.extend(filtered_videos)
        
        # Post-Processing
        if ch_config.get("type") == "shuffle_mix":
            import random
            random.shuffle(channel_videos)
        
        # Ensure unique IDs
        seen = set()
        unique_list = []
        for vid in channel_videos:
            if vid["id"] not in seen:
                seen.add(vid["id"])
                unique_list.append(vid)
        channel_videos = unique_list

        # Add to final JSON
        # IMPORTANT: Maintain compatibility with frontend
        # Frontend currently expects "1" and "2".
        # We are generating "0", "1", "2", ... "6".
        # We will map them 1:1, but ensure 0 is also present.
        final_playlist[ch_config["id"]] = channel_videos

    # Add timestamp
    final_playlist["updated_at"] = datetime.utcnow().isoformat()

    # Save
    with open(OUTPUT_FILE, "w") as f:
        json.dump(final_playlist, f, indent=2)
    
    print("\n----------------------------------")
    print(f"Success! {OUTPUT_FILE} updated.")

if __name__ == "__main__":
    main()