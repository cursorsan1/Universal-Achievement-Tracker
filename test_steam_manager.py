import pytest
from steam_manager import SteamGame, Achievement

def create_game():
    return SteamGame(1, "Test Game", 0, "icon")

def create_achievement(is_unlocked):
    return Achievement("id", "title", "desc", is_unlocked, "icon")

def test_completion_rate_empty():
    game = create_game()
    assert game.completion_rate == 0.0

def test_completion_rate_all_locked():
    game = create_game()
    game.achievements.extend([
        create_achievement(False),
        create_achievement(False),
        create_achievement(False)
    ])
    assert game.completion_rate == 0.0

def test_completion_rate_partial_unlocked():
    game = create_game()
    game.achievements.extend([
        create_achievement(True),
        create_achievement(False),
        create_achievement(False)
    ])
    # 1 out of 3 is 33.33%
    assert game.completion_rate == 33.33

def test_completion_rate_all_unlocked():
    game = create_game()
    game.achievements.extend([
        create_achievement(True),
        create_achievement(True),
        create_achievement(True)
    ])
    assert game.completion_rate == 100.0

def test_completion_rate_rounding():
    game = create_game()
    # 2 out of 3 unlocked, expecting 66.67
    game.achievements.extend([
        create_achievement(True),
        create_achievement(True),
        create_achievement(False)
    ])
    assert game.completion_rate == 66.67
