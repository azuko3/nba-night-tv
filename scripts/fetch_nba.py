import os
import json
import requests
from datetime import datetime, timedelta

# --- CONFIGURATION ---
API_KEY = os.environ.get("YOUTUBE_API_KEY")
if not API_KEY:
    raise Exception("Error: YOUTUBE_API_KEY is missing from environment variables.")

# Target Channel: GAMETIME HIGHLIGHTS
TARGET_CHANNEL_ID = "UC0LrZO9wORIqn_aRJtKdgfA" 

def get_nba_videos():
    """
    Fetches videos from the specific NBA channel from the last 24 hours.
    If no videos found (e.g., no games yesterday), falls back to latest videos generally.
    """
    
    # 1. Calculate timestamp for 24 hours ago (RFC 3339 format)
    # Example format: 2025-01-13T00:00:00Z
    yesterday = datetime.utcnow() - timedelta(hours=24)
    published_after = yesterday.isoformat("T") + "Z"

    print(f"Fetching videos from channel {TARGET_CHANNEL_ID} published after {published_after}...")

    # 2. Try fetching Last 24 Hours
    base_url = "https://www.googleapis.com/youtube/v3/search"
    params = {
        "part": "snippet",
        "channelId": TARGET_CHANNEL_ID,
        "type": "video",
        "order": "date",
        "publishedAfter": published_after, # ONLY last 24h
        "maxResults": 15,
        "key": API_KEY
    }

    response = requests.get(base_url, params=params)
    data = response.json()
    
    video_ids = []

    if "items" in data and len(data["items"]) > 0:
        video_ids = [item["id"]["videoId"] for item in data["items"]]
        print(f"Found {len(video_ids)} videos from the last 24h.")
    else:
        print("No videos found in the last 24h (Off-season or break?). fetching latest videos instead...")
        # 3. Fallback: Just fetch latest 10 videos without time limit
        del params["publishedAfter"]
        params["maxResults"] = 10
        
        response = requests.get(base_url, params=params)
        data = response.json()
        if "items" in data:
            video_ids = [item["id"]["videoId"] for item in data["items"]]

    return video_ids

def main():
    try:
        # Get the NBA list
        nba_playlist = get_nba_videos()

        # Construct the final JSON
        output_data = {
            "1": nba_playlist, # Channel 1: Gametime Highlights (24h)
            "2": ["dQw4w9WgXcQ", "L_jWHffIx5E", "9bZkp7q19f0"], # Channel 2: Comedy/Music (Static for now)
            "updated_at": datetime.utcnow().isoformat()
        }

        # Save to file
        with open("playlist.json", "w") as f:
            json.dump(output_data, f, indent=2)
            
        print("playlist.json saved successfully.")
        print(f"Channel 1 IDs: {nba_playlist}")

    except Exception as e:
        print(f"An error occurred: {e}")
        exit(1)

if __name__ == "__main__":
    main()