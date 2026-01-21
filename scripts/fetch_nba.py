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

# --- METHOD A: CHEAP (Playlist) ---
def get_uploads_from_playlist(playlist_id, days_back, limit=20):
    """Fetches from 'UU' playlist. Cheap (1 unit). Good for clean channels."""
    base_url = "https://www.googleapis.com/youtube/v3/playlistItems"
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
        
        candidates = []
        if "items" in data:
            for item in data["items"]:
                published_at_str = item["contentDetails"].get("videoPublishedAt") or item["snippet"].get("publishedAt")
                try:
                    pub_date = datetime.fromisoformat(published_at_str.replace('Z', '+00:00'))
                    if pub_date >= cutoff_date:
                        candidates.append(item)
                except:
                    continue
        
        # Return only video IDs
        return [item["contentDetails"]["videoId"] for item in candidates]

    except Exception as e:
        print(f"Error fetching playlist {playlist_id}: {e}")
        return []

# --- METHOD B: EXPENSIVE (Search) ---
def search_channel_videos(channel_id, query, days_back, limit=10):
    """Specific search on a channel. Expensive (100 units). Good for messy channels."""
    base_url = "https://www.googleapis.com/youtube/v3/search"
    published_after = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
    
    params = {
        "part": "snippet",
        "channelId": channel_id,
        "q": query,
        "type": "video",
        "order": "date",  # Get newest first
        "publishedAfter": published_after,
        "maxResults": limit,
        "key": API_KEY
    }

    try:
        print(f"    Running SEARCH on channel {channel_id} for '{query}'...")
        response = requests.get(base_url, params=params)
        data = response.json()
        
        if "items" not in data:
            return []
            
        return [item["id"]["videoId"] for item in data["items"]]

    except Exception as e:
        print(f"Error searching channel {channel_id}: {e}")
        return []

def fetch_video_details(video_ids):
    """Get duration and embed status."""
    if not video_ids:
        return []
        
    url = "https://www.googleapis.com/youtube/v3/videos"
    # Chunking requests if list is huge (limit is 50 per call)
    chunks = [video_ids[i:i + 50] for i in range(0, len(video_ids), 50)]
    all_items = []
    
    for chunk in chunks:
        params = {
            "part": "contentDetails,snippet,status",
            "id": ",".join(chunk),
            "key": API_KEY
        }
        res = requests.get(url, params=params)
        data = res.json()
        all_items.extend(data.get("items", []))
        
    return all_items

def filter_videos(videos_data, settings, source_rules):
    """Common filtering logic."""
    valid_videos = []
    
    for video in videos_data:
        vid_id = video["id"]
        title = video["snippet"]["title"]
        duration_iso = video["contentDetails"]["duration"] 
        is_embeddable = video["status"]["embeddable"]
        
        # 1. Must be embeddable
        if not is_embeddable:
            continue

        # 2. Duration Check
        try:
            duration = isodate.parse_duration(duration_iso)
            if settings.get("ignore_shorts", True) and duration.total_seconds() < 60:
                continue
        except:
            pass 

        # 3. Exclude Keywords
        exclude_words = source_rules.get("exclude_keywords", [])
        if any(word.lower() in title.lower() for word in exclude_words):
            print(f"    Skipped (Exclude): {title}")
            continue

        # 4. Must Contain
        must_words = source_rules.get("must_contain", [])
        if must_words:
            if not any(word.lower() in title.lower() for word in must_words):
                print(f"    Skipped (Missing '{must_words}'): {title}")
                continue

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
    print("Starting Content Fetcher (Hybrid Mode)...")
    config = load_config()
    final_playlist = {}
    
    for ch_config in config["channels"]:
        print(f"\nProcessing Channel {ch_config['id']}: {ch_config['name']}")
        channel_videos = []
        
        # Special case: Deni Avdija (Global Keyword Search)
        if ch_config.get("type") == "keyword_search":
            # For now, we skip global search to save quota unless specifically requested
            # You can implement global search using search_channel_videos without channelId
            print("  Skipping global keyword search.")
            continue

        for source in ch_config.get("sources", []):
            source_name = source["name"]
            method = source.get("method", "playlist")
            days = source.get("time_window_days", ch_config.get("time_window_days", 7))
            
            raw_video_ids = []
            
            # --- DECISION: SEARCH vs PLAYLIST ---
            if method == "search" and "channel_id" in source:
                query = source.get("search_query", "NBA")
                print(f"  > Source: {source_name} [Method: SEARCH]")
                raw_video_ids = search_channel_videos(source["channel_id"], query, days)
                
            elif method == "playlist" and "playlist_id" in source:
                print(f"  > Source: {source_name} [Method: PLAYLIST]")
                raw_video_ids = get_uploads_from_playlist(source["playlist_id"], days)
            
            else:
                print(f"  > Source: {source_name} [Skipped: Missing ID or Method]")
                continue

            # Fetch details for filtering
            videos_with_details = fetch_video_details(raw_video_ids)
            
            # Filter
            filtered_ids = filter_videos(videos_with_details, config["settings"], source)
            print(f"    -> Kept {len(filtered_ids)} videos.")
            channel_videos.extend(filtered_ids)
        
        # Shuffle if needed
        if ch_config.get("type") == "shuffle_mix":
            import random
            random.shuffle(channel_videos)
        else:
             # De-duplicate preserving order
            seen = set()
            unique_list = []
            for vid in channel_videos:
                if vid["id"] not in seen:
                    seen.add(vid["id"])
                    unique_list.append(vid)
            channel_videos = unique_list

        final_playlist[ch_config["id"]] = channel_videos

    # Save
    final_playlist["updated_at"] = datetime.utcnow().isoformat()
    with open(OUTPUT_FILE, "w") as f:
        json.dump(final_playlist, f, indent=2)
    
    print("\n----------------------------------")
    print(f"Success! {OUTPUT_FILE} updated.")

if __name__ == "__main__":
    main()