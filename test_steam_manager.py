import pytest
import requests_mock
import os
import json
import tempfile
from datetime import datetime
from steam_manager import SteamManager, SteamGame, Achievement

@pytest.fixture
def temp_cache_file():
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    yield path
    if os.path.exists(path):
        os.remove(path)

@pytest.fixture
def steam_manager(temp_cache_file):
    return SteamManager(api_key="TEST_API_KEY", steam_id="TEST_STEAM_ID", cache_file=temp_cache_file)

def test_fetch_owned_games_success(steam_manager, requests_mock):
    mock_url = f"{steam_manager.base_url}/IPlayerService/GetOwnedGames/v0001/"
    mock_response = {
        "response": {
            "game_count": 1,
            "games": [
                {
                    "appid": 10,
                    "name": "Counter-Strike",
                    "playtime_forever": 120,
                    "img_icon_url": "icon_10"
                }
            ]
        }
    }
    requests_mock.get(mock_url, json=mock_response)

    games = steam_manager.fetch_owned_games()

    assert len(games) == 1
    assert games[0].appid == "10"
    assert games[0].name == "Counter-Strike"
    assert games[0].playtime_forever == 120
    assert games[0].icon_url == "http://media.steampowered.com/steamcommunity/public/images/apps/10/icon_10.jpg"

def test_fetch_owned_games_missing_api_key(steam_manager):
    steam_manager.api_key = "YOUR_STEAM_WEB_API_KEY"
    games = steam_manager.fetch_owned_games()
    assert games == []

    steam_manager.api_key = ""
    games = steam_manager.fetch_owned_games()
    assert games == []

def test_fetch_owned_games_auth_error(steam_manager, requests_mock):
    mock_url = f"{steam_manager.base_url}/IPlayerService/GetOwnedGames/v0001/"
    requests_mock.get(mock_url, status_code=401)

    games = steam_manager.fetch_owned_games()
    assert games == []

    requests_mock.get(mock_url, status_code=403)
    games = steam_manager.fetch_owned_games()
    assert games == []

def test_fetch_owned_games_empty_games(steam_manager, requests_mock):
    mock_url = f"{steam_manager.base_url}/IPlayerService/GetOwnedGames/v0001/"
    mock_response = {"response": {}}
    requests_mock.get(mock_url, json=mock_response)

    games = steam_manager.fetch_owned_games()
    assert games == []

def test_fetch_owned_games_exception(steam_manager, requests_mock):
    mock_url = f"{steam_manager.base_url}/IPlayerService/GetOwnedGames/v0001/"
    requests_mock.get(mock_url, exc=Exception("Connection error"))

    games = steam_manager.fetch_owned_games()
    assert games == []

def test_fetch_achievements_success(steam_manager, requests_mock):
    appid = "10"
    schema_url = f"{steam_manager.base_url}/ISteamUserStats/GetSchemaForGame/v2/"
    stats_url = f"{steam_manager.base_url}/ISteamUserStats/GetPlayerAchievements/v0001/"

    mock_schema = {
        "game": {
            "availableGameStats": {
                "achievements": [
                    {"name": "ACH_1", "icon": "icon_url_1"}
                ]
            }
        }
    }
    requests_mock.get(schema_url, json=mock_schema)

    mock_stats = {
        "playerstats": {
            "achievements": [
                {
                    "apiname": "ACH_1",
                    "name": "First Achievement",
                    "description": "You did it!",
                    "achieved": 1,
                    "unlocktime": 1600000000
                }
            ]
        }
    }
    requests_mock.get(stats_url, json=mock_stats)

    achievements = steam_manager.fetch_achievements(appid)

    assert len(achievements) == 1
    assert achievements[0].api_id == "ACH_1"
    assert achievements[0].title == "First Achievement"
    assert achievements[0].description == "You did it!"
    assert achievements[0].is_unlocked is True
    assert achievements[0].icon_url == "icon_url_1"
    assert achievements[0].unlock_time == datetime.fromtimestamp(1600000000)

def test_fetch_achievements_missing_api_key(steam_manager):
    steam_manager.api_key = "YOUR_STEAM_WEB_API_KEY"
    achievements = steam_manager.fetch_achievements("10")
    assert achievements == []

    steam_manager.api_key = ""
    achievements = steam_manager.fetch_achievements("10")
    assert achievements == []

def test_fetch_achievements_stats_400(steam_manager, requests_mock):
    appid = "10"
    schema_url = f"{steam_manager.base_url}/ISteamUserStats/GetSchemaForGame/v2/"
    stats_url = f"{steam_manager.base_url}/ISteamUserStats/GetPlayerAchievements/v0001/"

    requests_mock.get(schema_url, json={"game": {}})
    requests_mock.get(stats_url, status_code=400)

    achievements = steam_manager.fetch_achievements(appid)
    assert achievements == []

def test_fetch_achievements_exception(steam_manager, requests_mock):
    appid = "10"
    schema_url = f"{steam_manager.base_url}/ISteamUserStats/GetSchemaForGame/v2/"

    requests_mock.get(schema_url, exc=Exception("Schema error"))

    achievements = steam_manager.fetch_achievements(appid)
    assert achievements == []

def test_sync_all_success(steam_manager, requests_mock, mocker):
    game_mock = SteamGame(appid=10, name="Game", playtime_forever=100, img_icon_url="")
    mocker.patch.object(steam_manager, 'fetch_owned_games', return_value=[game_mock])

    ach_mock = Achievement(api_id="A1", title="Ach", description="", is_unlocked=True, icon_url="")
    mocker.patch.object(steam_manager, 'fetch_achievements', return_value=[ach_mock])

    result = steam_manager.sync_all(use_cache=False)

    assert len(result) == 1
    assert result[0]["appid"] == "10"
    assert len(result[0]["achievements"]) == 1
    assert result[0]["achievements"][0]["api_id"] == "A1"

    # Verify cache file was created
    assert os.path.exists(steam_manager.cache_file)
    with open(steam_manager.cache_file, "r", encoding="utf-8") as f:
        cache_data = json.load(f)
        assert len(cache_data) == 1
        assert cache_data[0]["appid"] == "10"

def test_sync_all_fallback_cache(steam_manager, mocker):
    # Setup initial cache
    initial_cache = [{
        "appid": "10",
        "name": "Game",
        "playtime_hours": 1.0,
        "icon_url": "",
        "header_image": "",
        "platform": "Steam",
        "completion_rate": 100.0,
        "total_achievements": 1,
        "unlocked_achievements": 1,
        "achievements": [{
            "api_id": "A1",
            "title": "Cached Ach",
            "description": "",
            "is_unlocked": True,
            "icon_url": "",
            "unlock_time": None,
            "platform": "Steam"
        }]
    }]
    with open(steam_manager.cache_file, "w", encoding="utf-8") as f:
        json.dump(initial_cache, f)

    game_mock = SteamGame(appid=10, name="Game", playtime_forever=100, img_icon_url="")
    mocker.patch.object(steam_manager, 'fetch_owned_games', return_value=[game_mock])

    # fetch_achievements fails (returns empty)
    mocker.patch.object(steam_manager, 'fetch_achievements', return_value=[])

    result = steam_manager.sync_all(use_cache=False)

    assert len(result) == 1
    assert len(result[0]["achievements"]) == 1
    assert result[0]["achievements"][0]["title"] == "Cached Ach"

def test_sync_all_use_cache_early_return(steam_manager):
    # Setup initial cache
    initial_cache = [{"appid": "10", "name": "Cached Game"}]
    with open(steam_manager.cache_file, "w", encoding="utf-8") as f:
        json.dump(initial_cache, f)

    result = steam_manager.sync_all(use_cache=True)

    assert len(result) == 1
    assert result[0]["name"] == "Cached Game"

def test_sync_all_save_exception(steam_manager, mocker):
    game_mock = SteamGame(appid=10, name="Game", playtime_forever=100, img_icon_url="")
    mocker.patch.object(steam_manager, 'fetch_owned_games', return_value=[game_mock])

    ach_mock = Achievement(api_id="A1", title="Ach", description="", is_unlocked=True, icon_url="")
    mocker.patch.object(steam_manager, 'fetch_achievements', return_value=[ach_mock])

    # Force an exception during save by mocking json.dump
    mocker.patch('json.dump', side_effect=Exception("Save error"))

    result = steam_manager.sync_all(use_cache=False)

    # Function should still return the data even if save fails
    assert len(result) == 1
    assert result[0]["appid"] == "10"

    # Temp file should be cleaned up
    temp_file = steam_manager.cache_file + ".tmp"
    assert not os.path.exists(temp_file)
