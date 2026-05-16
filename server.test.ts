import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "fs";
import { app } from "./server";

// We need to mock fetch since server.ts uses it directly for Steam API calls
// Notice in server.ts line ~1459: const gamesResponse = await fetch(...)
// and ~1476: const achResponse = await fetch(...)

describe("GET /api/steam/games", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks();

    // We can spy on fs.existsSync and fs.readFileSync for caching/config files
    vi.spyOn(fs, "existsSync").mockImplementation((path) => {
      // Mock that cache file does NOT exist to force fetch
      if (path === "steam_cache.json") return false;
      if (path === "config.json") return true;
      return false;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 400 if Steam API credentials are missing", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((path, encoding) => {
      if (path === "config.json") {
        return JSON.stringify({
          steamApiKey: "",
          steamId: ""
        });
      }
      return "";
    });

    const response = await request(app).get("/api/steam/games");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Steam API credentials missing" });
  });

  it("should return 400 if Steam API key is the default placeholder", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((path, encoding) => {
      if (path === "config.json") {
        return JSON.stringify({
          steamApiKey: "YOUR_STEAM_WEB_API_KEY",
          steamId: "123456789"
        });
      }
      return "";
    });

    const response = await request(app).get("/api/steam/games");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Steam API credentials missing" });
  });

  it("should return games array successfully when credentials are valid", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((path, encoding) => {
      if (path === "config.json") {
        return JSON.stringify({
          steamApiKey: "VALID_API_KEY",
          steamId: "123456789"
        });
      }
      return "";
    });

    // Mock fetch for Steam API calls
    const mockFetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string') {
        if (url.includes("GetOwnedGames")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              response: {
                games: [
                  { appid: 10, name: "Counter-Strike", playtime_forever: 120 }
                ]
              }
            })
          });
        }
        if (url.includes("GetPlayerAchievements")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              playerstats: {
                achievements: [
                  { apiname: "ACH_1", achieved: 1 },
                  { apiname: "ACH_2", achieved: 0 }
                ]
              }
            })
          });
        }
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    // Replace global.fetch with our mock
    vi.stubGlobal('fetch', mockFetch);

    // Mock fs.writeFileSync so it doesn't try to write the cache to disk during test
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});

    const response = await request(app).get("/api/steam/games");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("games");
    expect(response.body).toHaveProperty("notifications");
    expect(response.body.games).toHaveLength(1);
    expect(response.body.games[0]).toMatchObject({
      appid: "10",
      name: "Counter-Strike",
      platform: "Steam",
      total_achievements: 2,
      unlocked_achievements: 1,
      completion_rate: 50 // (1/2)*100
    });
  });

  it("should handle steam API errors gracefully", async () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((path, encoding) => {
      if (path === "config.json") {
        return JSON.stringify({
          steamApiKey: "VALID_API_KEY",
          steamId: "123456789"
        });
      }
      return "";
    });

    // Mock fetch to reject
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    vi.stubGlobal('fetch', mockFetch);

    const response = await request(app).get("/api/steam/games");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to fetch from Steam API" });
  });
});
