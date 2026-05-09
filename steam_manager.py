import requests
import json
import os
from datetime import datetime
from typing import List, Optional, Dict

# Adatmodellek (Architecture szellemében)
class Achievement:
    def __init__(self, api_id, title, description, is_unlocked, icon_url, unlock_time=None):
        self.api_id = api_id
        self.title = title
        self.description = description
        self.is_unlocked = is_unlocked
        self.icon_url = icon_url
        self.unlock_time = unlock_time
        self.platform = "Steam"

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
            "platform": self.platform,
            "completion_rate": self.completion_rate,
            "total_achievements": len(self.achievements),
            "unlocked_achievements": sum(1 for a in self.achievements if a.is_unlocked)
        }

class SteamManager:
    def __init__(self, api_key: str, steam_id: str, cache_file: str = "steam_cache.json"):
        self.api_key = api_key
        self.steam_id = steam_id
        self.cache_file = cache_file
        self.base_url = "http://api.steampowered.com"

    def fetch_owned_games(self) -> List[SteamGame]:
        """Lekéri a felhasználó összes játékát."""
        url = f"{self.base_url}/IPlayerService/GetOwnedGames/v0001/"
        params = {
            "key": self.api_key,
            "steamid": self.steam_id,
            "format": "json",
            "include_appinfo": True,
            "include_played_free_games": True
        }
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            games = []
            for item in data.get("response", {}).get("games", []):
                app_id = item["appid"]
                game_name = item["name"]
                print(f"DEBUG: Processing game {game_name} with AppID {app_id}")
                game = SteamGame(
                    appid=app_id,
                    name=game_name,
                    playtime_forever=item.get("playtime_forever", 0),
                    img_icon_url=item.get("img_icon_url", "")
                )
                games.append(game)
            return games
        except Exception as e:
            print(f"Hiba a játékok lekérésekor: {e}")
            return []

    def fetch_achievements(self, appid: str) -> List[Achievement]:
        """Lekéri egy adott játék eredményeit."""
        url = f"{self.base_url}/ISteamUserStats/GetPlayerAchievements/v0001/"
        params = {
            "key": self.api_key,
            "steamid": self.steam_id,
            "appid": appid,
            "l": "hungarian" # Magyar nyelvű leírások
        }
        
        try:
            response = requests.get(url, params=params)
            # Ha a játéknak nincs achievementje, a Steam 400-at dobhat
            if response.status_code == 400:
                return []
            
            response.raise_for_status()
            data = response.json()
            
            achievements = []
            player_stats = data.get("playerstats", {})
            if "achievements" in player_stats:
                for item in player_stats["achievements"]:
                    ach = Achievement(
                        api_id=item["apiname"],
                        title=item.get("name", item["apiname"]),
                        description=item.get("description", ""),
                        is_unlocked=bool(item["achieved"]),
                        icon_url="", # A web API itt nem ad közvetlen ikont, ahhoz az ISteamUserStats/GetSchemaForGame kellene
                        unlock_time=datetime.fromtimestamp(item["unlocktime"]) if item["unlocktime"] > 0 else None
                    )
                    achievements.append(ach)
            return achievements
        except Exception as e:
            # print(f"Hiba az eredmények lekérésekor ({appid}): {e}")
            return []

    def sync_all(self, use_cache: bool = True) -> List[Dict]:
        """Teljes szinkronizáció: Játékok + Achievementek + Cache."""
        if use_cache and os.path.exists(self.cache_file):
            with open(self.cache_file, "r", encoding="utf-8") as f:
                print("Adatok betöltése cache-ből...")
                return json.load(f)

        print("Szinkronizálás a Steam szervereivel... (ez eltarthat egy ideig)")
        games = self.fetch_owned_games()
        
        # Csak azokat a játékokat dolgozzuk fel, amikkel játszott legalább 1 percet
        played_games = [g for g in games if g.playtime_forever > 0]
        
        result = []
        for game in played_games:
            game.achievements = self.fetch_achievements(game.appid)
            # Csak akkor adjuk hozzá, ha vannak achievementjei
            if game.achievements:
                result.append(game.to_dict())

        # Mentés cache-be
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=4)
        
        return result

# Példa használat (teszteléshez):
if __name__ == "__main__":
    # Innen töltsd be a kulcsokat (pl. környezeti változóból)
    API_KEY = "YOUR_STEAM_WEB_API_KEY"
    STEAM_ID = "YOUR_STEAM_ID_64"
    
    manager = SteamManager(API_KEY, STEAM_ID)
    data = manager.sync_all(use_cache=True)
    
    print(f"Összesen {len(data)} Steam játék szinkronizálva.")
    for game in data[:5]:
        print(f"- {game['name']}: {game['completion_rate']}% ({game['playtime_hours']} óra)")
