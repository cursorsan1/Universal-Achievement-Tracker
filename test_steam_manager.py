import unittest
from datetime import datetime
from steam_manager import Achievement

class TestAchievement(unittest.TestCase):
    def test_init(self):
        ach = Achievement("test_id", "Test Title", "Test Desc", True, "http://icon", None)
        self.assertEqual(ach.api_id, "test_id")
        self.assertEqual(ach.title, "Test Title")
        self.assertEqual(ach.description, "Test Desc")
        self.assertEqual(ach.is_unlocked, True)
        self.assertEqual(ach.icon_url, "http://icon")
        self.assertIsNone(ach.unlock_time)
        self.assertEqual(ach.platform, "Steam")

    def test_to_dict_without_unlock_time(self):
        ach = Achievement("test_id", "Test Title", "Test Desc", True, "http://icon", None)
        d = ach.to_dict()
        self.assertEqual(d["api_id"], "test_id")
        self.assertEqual(d["title"], "Test Title")
        self.assertEqual(d["description"], "Test Desc")
        self.assertEqual(d["is_unlocked"], True)
        self.assertEqual(d["icon_url"], "http://icon")
        self.assertIsNone(d["unlock_time"])
        self.assertEqual(d["platform"], "Steam")

    def test_to_dict_with_unlock_time(self):
        dt = datetime(2023, 1, 1, 12, 0, 0)
        ach = Achievement("test_id", "Test Title", "Test Desc", True, "http://icon", dt)
        d = ach.to_dict()
        self.assertEqual(d["unlock_time"], "2023-01-01T12:00:00")

if __name__ == '__main__':
    unittest.main()
