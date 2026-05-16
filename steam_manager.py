from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import json
import os
import sys
import concurrent.futures
from datetime import datetime
from typing import List, Optional, Dict
from dataclasses import dataclass

app = Flask(__name__)
CORS(app)

# Global configuration state
SETTINGS_FILE = sys.argv[1] if len(sys.argv) > 1 else 'settings.json'
# Use USER_DATA_PATH from Electron if available, otherwise fallback to settings dir or current dir
USER_DATA_PATH = os.getenv('USER_DATA_PATH')
if USER_DATA_PATH:
    CACHE_DIR = USER_DATA_PATH
    print(f"[Python] Using USER_DATA_PATH for cache: {CACHE_DIR}")
else:
    CACHE_DIR = os.path.dirname(os.path.abspath(SETTINGS_FILE))
    print(f"[Python] Falling back to settings directory for cache: {CACHE_DIR}")

CACHE_FILE_PATH = os.path.join(CACHE_DIR, "steam_cache.json")

config = {
    "steamApiKey": os.getenv("STEAM_API_KEY", "YOUR_STEAM_WEB_API_KEY"),
    "steamId": os.getenv("STEAM_ID", "YOUR_STEAM_ID_64"),
    "cache_file": CACHE_FILE_PATH
}

def reload_config():
    global config
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                config['steamApiKey'] = settings.get('steamApiKey', config['steamApiKey'])
                config['steamId'] = settings.get('steamId', config['steamId'])
                print(f"[Python] Config reloaded from {SETTINGS_FILE}")
        except Exception as e:
            print(f"[Python] Failed to reload config: {e}")

# Call initially
reload_config()

# Adatmodellek (Architecture szellemében)
@dataclass
class Achievement:
    api_id: str
    title: str
    description: str
    is_unlocked: bool
    icon_url: str
    unlock_time: Optional[datetime] = None
    platform: str = "Steam"

    def to_dict(self):
        return {
            "api_id": self.api_id,
            "title": self.title,
            "description": self.description,
            "is_unlocked": self.is_unlocked,
            "icon_url": self.icon_url,
            "unlock_time": self.unlock_time.isoformat() if self.unlock_time else None,
            "platform": self.platform
        }

class SteamGame:
    def __init__(self, appid, name, playtime_forever, img_icon_url):
        self.appid = str(appid)
        self.name = name
        self.playtime_forever = playtime_forever # percekben
        self.icon_url = f"http://media.steampowered.com/steamcommunity/public/images/apps/{appid}/{img_icon_url}.jpg"
        self.header_image = f"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{appid}/header.jpg"
        self.achievements: List[Achievement] = []
        self.platform = "Steam"

    @property
    def completion_rate(self) -> float:
        if not self.achievements:
            return 0.0
        unlocked = sum(1 for a in self.achievements if a.is_unlocked)
        return round((unlocked / len(self.achievements)) * 100, 2)

    def to_dict(self):
        return {
            "appid": self.appid,
            "name": self.name,
            "playtime_hours": round(self.playtime_forever / 60, 1),
            "icon_url": self.icon_url,
            "header_image": self.header_image,
            "platform": self.platform,
            "completion_rate": self.completion_rate,
            "total_achievements": len(self.achievements),
            "unlocked_achievements": sum(1 for a in self.achievements if a.is_unlocked),
            "achievements": [a.to_dict() for a in self.achievements]
        }

class SteamManager:
    def __init__(self, api_key: str, steam_id: str, cache_file: str = "steam_cache.json"):
        self.api_key = api_key
        self.steam_id = steam_id
        self.cache_file = cache_file
        self.base_url = "http://api.steampowered.com"

    def _make_owned_games_request(self) -> list:
        """Kiszolgálja a Steam API kérést a játékok lekéréséhez."""
        print(f"PYTHON_EXECUTING_SYNC: Using key {self.api_key[:5]}... and ID {self.steam_id}")
        url = f"{self.base_url}/IPlayerService/GetOwnedGames/v0001/"
        params = {
            "key": self.api_key,
            "steamid": self.steam_id,
            "format": "json",
            "include_appinfo": True,
            "include_played_free_games": True
        }
        
        if self.api_key == "YOUR_STEAM_WEB_API_KEY" or not self.api_key:
            print("Kérlek add meg a Steam API kulcsodat a configban!")
            return []
        
        masked_url = f"{url}?key=XXXXX&steamid={self.steam_id}"
        print(f"DEBUG: Steam API Request: {masked_url}")
        
        try:
            response = requests.get(url, params=params)
            print(f"DEBUG: Steam API Response Status: {response.status_code}")
            
            if response.status_code == 401 or response.status_code == 403:
                print("Hiba: Érvénytelen Steam API kulcs vagy hozzáférés megtagadva.")
                return []
            
            response.raise_for_status()
            data = response.json()
            games_data = data.get("response", {}).get("games", [])
            
            if not games_data:
                print("DEBUG: Steam returned 0 games. Check Privacy Settings!")
                return []
            
            return games_data
        except Exception as e:
            print(f"Hiba a játékok lekérésekor: {e}")
            return []

    def _parse_owned_games(self, games_data: list) -> List[SteamGame]:
        """Feldolgozza a Steam API válaszát és SteamGame objektumokat készít."""
        games = []
        for item in games_data:
            app_id = item["appid"]
            game_name = item["name"]
            game = SteamGame(
                appid=app_id,
                name=game_name,
                playtime_forever=item.get("playtime_forever", 0),
                img_icon_url=item.get("img_icon_url", "")
            )
            games.append(game)
        return games

    def fetch_owned_games(self) -> List[SteamGame]:
        """Lekéri a felhasználó összes játékát."""
        games_data = self._make_owned_games_request()
        return self._parse_owned_games(games_data)

    def fetch_achievements(self, appid: str) -> List[Achievement]:
        """Lekéri egy adott játék eredményeit és ikonjait."""
        # 1. Get player achievement status (achieved/not achieved)
        url_stats = f"{self.base_url}/ISteamUserStats/GetPlayerAchievements/v0001/"
        params_stats = {
            "key": self.api_key,
            "steamid": self.steam_id,
            "appid": appid,
            "l": "hungarian" 
        }
        
        # 2. Get game schema for icons
        url_schema = f"{self.base_url}/ISteamUserStats/GetSchemaForGame/v2/"
        params_schema = {
            "key": self.api_key,
            "appid": appid,
            "l": "hungarian"
        }

        if self.api_key == "YOUR_STEAM_WEB_API_KEY" or not self.api_key:
            return []
        
        try:
            # Fetch Schema first to have icons
            response_schema = requests.get(url_schema, params=params_schema)
            schema_data = {}
            if response_schema.status_code == 200:
                schema_data = response_schema.json().get("game", {}).get("availableGameStats", {}).get("achievements", [])
            
            icons_map = {item["name"]: item.get("icon", "") for item in schema_data}

            # Fetch Player stats
            response_stats = requests.get(url_stats, params=params_stats)
            if response_stats.status_code == 400:
                return []
            
            response_stats.raise_for_status()
            data_stats = response_stats.json()
            
            achievements = []
            player_stats = data_stats.get("playerstats", {})
            if "achievements" in player_stats:
                for item in player_stats["achievements"]:
                    api_id = item["apiname"]
                    icon_url = icons_map.get(api_id, "")
                    
                    ach = Achievement(
                        api_id=api_id,
                        title=item.get("name", item["apiname"]),
                        description=item.get("description", ""),
                        is_unlocked=bool(item["achieved"]),
                        icon_url=icon_url, 
                        unlock_time=datetime.fromtimestamp(item["unlocktime"]) if item["unlocktime"] > 0 else None
                    )
                    achievements.append(ach)
            return achievements
        except Exception as e:
            print(f"DEBUG: Error fetching achievements for {appid}: {e}")
            return []

    def sync_all(self, use_cache: bool = True) -> List[Dict]:
        """Teljes szinkronizáció okos összefésüléssel."""
        existing_cache = []
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    existing_cache = json.load(f)
                    if use_cache:
                        print(f"[Python] Using {len(existing_cache)} cached games.")
                        return existing_cache
            except Exception as e:
                print(f"[Python] Warning: Could not load cache: {e}")

        # Create lookup for existing detailed data
        cache_lookup = {str(g['appid']): g for g in existing_cache}

        print(f"Szinkronizálás indítása (SteamID: {self.steam_id})...")
        games = self.fetch_owned_games()
        played_games = [g for g in games if g.playtime_forever > 0]
        
        result = []
        skipped_count = 0

        def process_game(game):
            # Smart Merge: Ha már megvan az achievement lista és nem változott drasztikusan a playtime (vagy mindig frissítünk)
            # A biztonság kedvéért most mindig lekérjük az achievementeket, ha szinkronizálunk, 
            # de megőrizzük a meglévőket, ha a hívás sikertelen.
            new_achievements = self.fetch_achievements(game.appid)
            if new_achievements:
                game.achievements = new_achievements
            elif str(game.appid) in cache_lookup:
                # Fallback to cached achievements if fetch failed
                cached_data = cache_lookup[str(game.appid)]
                print(f"[Python] Using cached achievements for {game.name}")
                # We need to rebuild Achievement objects if we want to use game.to_dict() properly
                game.achievements = [
                    Achievement(
                        api_id=a['api_id'],
                        title=a['title'],
                        description=a['description'],
                        is_unlocked=a['is_unlocked'],
                        icon_url=a['icon_url'],
                        unlock_time=datetime.fromisoformat(a['unlock_time']) if a.get('unlock_time') else None
                    ) for a in cached_data.get('achievements', [])
                ]
            return game

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            processed_games = list(executor.map(process_game, played_games))

        for game in processed_games:
            if len(game.achievements) > 0:
                result.append(game.to_dict())
            else:
                skipped_count += 1

        print(f"DEBUG: Filtered out {skipped_count} games with no achievements.")

        # Resilient Save: Use temporary file then rename
        temp_file = self.cache_file + ".tmp"
        try:
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=4)
            
            # Atomic rename
            if os.path.exists(self.cache_file):
                os.remove(self.cache_file)
            os.rename(temp_file, self.cache_file)
            print(f"[Python] Cache updated: {len(result)} games saved.")
        except Exception as e:
            print(f"[Python] CRITICAL: Failed to save cache: {e}")
            if os.path.exists(temp_file):
                os.remove(temp_file)
        
        return result

# Flask Endpoints
@app.route('/update-config', methods=['POST'])
def update_config():
    reload_config()
    data = request.json
    if not data:
        return jsonify({"status": "error", "message": "No data provided"}), 400
    
    print(f"[Python] Update requested: {data}")
    
    settings_path = data.get('settingsPath')
    if settings_path and os.path.exists(settings_path):
        try:
            with open(settings_path, 'r', encoding='utf-8') as f:
                settings = json.load(f)
                config['steamApiKey'] = settings.get('steamApiKey', config['steamApiKey'])
                config['steamId'] = settings.get('steamId', config['steamId'])
                print(f"Python: Reloaded settings from {settings_path}")
        except Exception as e:
            print(f"[Python] Failed to read settings file: {e}")

    # Fallback to direct keys if provided in balance
    if 'steamApiKey' in data:
        config['steamApiKey'] = data['steamApiKey']
    if 'steamId' in data:
        config['steamId'] = data['steamId']
    
    manager = SteamManager(config['steamApiKey'], config['steamId'])
    try:
        results = manager.sync_all(use_cache=False)
        print(f"[Python] Synchronization completed successfully. Found {len(results)} games.")
        return jsonify({
            "status": "success", 
            "message": "Python config updated, sync started", 
            "count": len(results),
            "games": results
        })
    except Exception as e:
        print(f"[Python] Synchronization failed: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/sync-steam', methods=['POST'])
def sync_steam():
    reload_config()
    print(f"Python: Syncing started for Steam ID: {config['steamId']}")

    manager = SteamManager(config['steamApiKey'], config['steamId'])
    try:
        results = manager.sync_all(use_cache=False)
        print(f"[Python] Synchronization completed successfully. Found {len(results)} games.")
        return jsonify({
            "status": "success", 
            "message": "Python sync completed", 
            "count": len(results),
            "games": results
        })
    except Exception as e:
        print(f"[Python] Synchronization failed: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/sync', methods=['GET'])
def get_sync():
    manager = SteamManager(config['steamApiKey'], config['steamId'])
    data = manager.sync_all(use_cache=True)
    return jsonify(data)

if __name__ == "__main__":
    print("[Python] Backend server starting on port 5000...")
    app.run(port=5000, host='0.0.0.0')
