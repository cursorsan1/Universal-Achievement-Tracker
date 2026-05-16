import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectNewAchievements } from './server.ts';
import fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

describe('detectNewAchievements', () => {
  const mockGame = {
    appid: 12345,
    name: "Test Game",
    icon_url: "http://test.icon"
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should not notify anything on initial sync but should save unlocked achievements', async () => {
    (fs.existsSync as any).mockReturnValue(false); // No notified cache

    const achievements = [
      { api_id: "ach1", title: "Ach 1", description: "Desc 1", is_unlocked: true },
      { api_id: "ach2", title: "Ach 2", description: "Desc 2", is_unlocked: false },
    ];

    const notifications = await detectNewAchievements(mockGame, achievements, "Steam");

    expect(notifications).toEqual([]);
    expect(fs.writeFileSync).toHaveBeenCalled();
    const saveCall = (fs.writeFileSync as any).mock.calls[0];
    expect(JSON.parse(saveCall[1] as string)).toEqual({
      "steam-12345": ["ach1"]
    });
  });

  it('should notify about new unlocked achievements without platinum if not complete', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      "steam-12345": ["ach1"] // ach1 was already unlocked
    }));

    const achievements = [
      { api_id: "ach1", title: "Ach 1", description: "Desc 1", is_unlocked: true },
      { api_id: "ach2", title: "Ach 2", description: "Desc 2", is_unlocked: true }, // new unlock
      { api_id: "ach3", title: "Ach 3", description: "Desc 3", is_unlocked: false }, // not complete yet
    ];

    const notifications = await detectNewAchievements(mockGame, achievements, "Steam");

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("Ach 2");
    expect(notifications[0].platformLabel).toBe("New Achievement"); // Steam label

    expect(fs.writeFileSync).toHaveBeenCalled();
    const saveCall = (fs.writeFileSync as any).mock.calls[0];
    const savedData = JSON.parse(saveCall[1] as string);
    expect(savedData["steam-12345"]).toContain("ach1");
    expect(savedData["steam-12345"]).toContain("ach2");
  });

  it('should notify platinum achievement when all achievements are unlocked', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      "steam-12345": ["ach1"]
    }));

    const achievements = [
      { api_id: "ach1", title: "Ach 1", description: "Desc 1", is_unlocked: true },
      { api_id: "ach2", title: "Ach 2", description: "Desc 2", is_unlocked: true }, // new unlock completing the game
    ];

    const notifications = await detectNewAchievements(mockGame, achievements, "Steam");

    // Should contain regular achievement and platinum
    expect(notifications).toHaveLength(2);

    const regularNotif = notifications.find(n => !n.isPlatinum);
    const platinumNotif = notifications.find(n => n.isPlatinum);

    expect(regularNotif?.title).toBe("Ach 2");
    expect(platinumNotif).toBeDefined();
    expect(platinumNotif?.title).toBe("Full Mastery");

    expect(fs.writeFileSync).toHaveBeenCalled();
    const saveCall = (fs.writeFileSync as any).mock.calls[0];
    const savedData = JSON.parse(saveCall[1] as string);
    expect(savedData["steam-12345"]).toContain("__PLATINUM__");
  });

  it('should not notify platinum if already notified', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      "steam-12345": ["ach1", "ach2", "__PLATINUM__"]
    }));

    const achievements = [
      { api_id: "ach1", title: "Ach 1", description: "Desc 1", is_unlocked: true },
      { api_id: "ach2", title: "Ach 2", description: "Desc 2", is_unlocked: true },
    ];

    const notifications = await detectNewAchievements(mockGame, achievements, "Steam");

    expect(notifications).toHaveLength(0);
  });
});
