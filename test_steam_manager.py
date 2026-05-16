import pytest
import steam_manager
from unittest.mock import patch, mock_open

@pytest.fixture(autouse=True)
def reset_config():
    """Reset the global config before each test."""
    # Backup the original config
    original_config = steam_manager.config.copy()
    yield
    # Restore the original config after the test
    steam_manager.config = original_config


def test_reload_config_exception(capsys):
    with patch('os.path.exists', return_value=True):
        with patch('builtins.open', side_effect=Exception("mocked error")):
            steam_manager.reload_config()

    captured = capsys.readouterr()
    assert "[Python] Failed to reload config: mocked error" in captured.out

def test_reload_config_invalid_json(capsys):
    with patch('os.path.exists', return_value=True):
        with patch('builtins.open', mock_open(read_data="{invalid_json")):
            steam_manager.reload_config()

    captured = capsys.readouterr()
    assert "[Python] Failed to reload config:" in captured.out

def test_reload_config_happy_path(capsys):
    mock_json = '{"steamApiKey": "test_key", "steamId": "test_id"}'
    with patch('os.path.exists', return_value=True):
        with patch('builtins.open', mock_open(read_data=mock_json)):
            steam_manager.reload_config()

    assert steam_manager.config['steamApiKey'] == 'test_key'
    assert steam_manager.config['steamId'] == 'test_id'

    captured = capsys.readouterr()
    assert "[Python] Config reloaded from" in captured.out
