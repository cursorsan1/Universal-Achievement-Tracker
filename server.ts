import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";

dotenv.config();

const app = express();
const PORT = 3000;
const CACHE_FILE = "steam_cache.json";

// Steam API configuration
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_ID = process.env.STEAM_ID;

const getCleanId = (id: string | number) => {
  return id.toString().replace('debug-', '').replace('steam-', '').replace('goldberg-', '');
};

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const CONFIG_FILE = "config.json";

// Helper to get config
function getConfig() {
  let config = {
    steamApiKey: process.env.STEAM_API_KEY || "",
    steamId: process.env.STEAM_ID || "",
    raUsername: process.env.RA_USERNAME || "",
    raApiKey: process.env.RA_API_KEY || "",
    xboxXuid: "",
    xboxAuthHeader: "",
    rpcs3Path: "",
    goldbergPath: "",
    notificationScale: 1.0,
    notificationStyle: {
      bgColor: "#0f172a", // default tailwind slate-900
      textColor: "#f8fafc", // default tailwind slate-50
      borderRadius: "0.75rem", // default rounded-xl
      padding: "1rem" // default p-4
    },
    sounds: {
      common: "",
      rare: "",
      ultrarare: "",
      platinum: ""
    }
  };

  if (fs.existsSync(CONFIG_FILE)) {
    const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    config = { ...config, ...fileConfig };
  }
  
  return config;
}

const CACHE_DIR = "cache";
const NOTIFIED_CACHE_FILE = path.join(CACHE_DIR, "notified_achievements.json");
const SCRAPE_CACHE_FILE = path.join(CACHE_DIR, "scraped_images.json");

// Cleanup cache on startup
if (fs.existsSync(CACHE_DIR)) {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
}
fs.mkdirSync(CACHE_DIR);


// Global Config for Local Library storage
const LIBRARY_FILE = "local_library.json";
const IMAGE_CACHE_DIR = path.resolve(CACHE_DIR, "images");

if (!fs.existsSync(IMAGE_CACHE_DIR)) {
  fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
}

// Ensure library file exists
if (!fs.existsSync(LIBRARY_FILE)) {
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify([], null, 2));
}

function getLocalLibrary(): any[] {
  try {
    return JSON.parse(fs.readFileSync(LIBRARY_FILE, "utf-8"));
  } catch (e) {
    return [];
  }
}

function saveLocalLibrary(library: any[]) {
  fs.writeFileSync(LIBRARY_FILE, JSON.stringify(library, null, 2));
}

// Scrape Cache Helpers
function getScrapedCache(): Record<string, string> {
  if (fs.existsSync(SCRAPE_CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SCRAPE_CACHE_FILE, "utf-8"));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveScrapedCache(cache: Record<string, string>) {
  fs.writeFileSync(SCRAPE_CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function getScrapedSteamImage(appId: string, platform?: string): Promise<string | null> {
  const cache = getScrapedCache();
  if (cache[appId]) return cache[appId];
  
  // Only scrape for Steam/Goldberg
  const p = (platform || "").toUpperCase();
  if (p !== "STEAM" && p !== "GOLDBERG") return null;

  try {
    const url = `https://store.steampowered.com/app/${appId}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Cookie': 'wants_mature_content=1; birthtime=-2208988800; lastagecheckage=1-0-1900'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    
    // Try to find the header image or fallback to open graph image
    let imgSrc = $('.game_header_image_full').attr('src') || $('meta[property="og:image"]').attr('content');
    
    console.log(`DEBUG: Scraped image for AppID ${appId} - URL: ${imgSrc}`);

    if (imgSrc) {
      const cleanUrl = imgSrc.split('?')[0]; // Remove query params
      
      // Verify URL is valid
      try {
        await axios.head(cleanUrl, { timeout: 5000 });
        cache[appId] = cleanUrl;
        saveScrapedCache(cache);
        return cleanUrl;
      } catch (headError) {
        console.warn(`Scraped URL invalid for ${appId}: ${cleanUrl}`);
      }
    }
  } catch (error) {
    console.warn(`Scraping failed for AppID ${appId}:`, (error as Error).message);
  }
  return null;
}

// Helpers for Notified Achievements
function getNotifiedAchievements(): Record<string, string[]> {
  if (fs.existsSync(NOTIFIED_CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(NOTIFIED_CACHE_FILE, "utf-8"));
    } catch (e) {
      return {};
    }
  }
  return {};
}

function saveNotifiedAchievements(notified: Record<string, string[]>) {
  fs.writeFileSync(NOTIFIED_CACHE_FILE, JSON.stringify(notified, null, 2));
}

// Global Notification Processing
let latestNotification: any = null;

async function detectNewAchievements(game: any, achievements: any[], platform: string) {
  const notifiedMap = getNotifiedAchievements();
  const gameKey = `${platform.toLowerCase()}-${game.appid || game.id}`;
  
  // Is this the first time we've ever seen this game's achievement data?
  const isInitialSync = !Object.prototype.hasOwnProperty.call(notifiedMap, gameKey);
  
  const notifiedList = notifiedMap[gameKey] || [];
  const newUnlocks = achievements.filter(ach => ach.is_unlocked && !notifiedList.includes(ach.api_id));
  const newNotifications: any[] = [];

  if (newUnlocks.length > 0 || isInitialSync) {
    const labels: Record<string, string> = {
      "Steam": "New Achievement",
      "Goldberg": "Achievement Unlocked",
      "Xbox": "Achievement Unlocked",
      "RetroAchievements": "Mastery Progress",
      "PS3": "Trophy Earned"
    };

    newUnlocks.forEach(ach => {
      // Only push notification if it's NOT the first time we see this game
      if (!isInitialSync) {
        const notif = {
          id: Date.now() + Math.random(),
          title: ach.title,
          description: ach.description,
          rarity: "rare", // Could be dynamic if API provides it
          gameTitle: game.name || game.title,
          gameIcon: game.icon_url || game.icon,
          platformLabel: labels[platform] || "Achievement Unlocked",
          isPlatinum: false
        };
        newNotifications.push(notif);
        latestNotification = notif;
      }
      if (!notifiedList.includes(ach.api_id)) {
        notifiedList.push(ach.api_id);
      }
    });

    // Platinum/Mastery Check
    const totalUnlocked = achievements.filter(a => a.is_unlocked).length;
    const totalCount = achievements.length;
    
    if (totalUnlocked === totalCount && totalCount > 0) {
      if (!notifiedList.includes("__PLATINUM__")) {
        // Only push notification if it's NOT the first time we see this game
        if (!isInitialSync) {
          const notif = {
            id: Date.now() + Math.random() + 1,
            title: platform === "PS3" ? "Platinum Trophy" : "Full Mastery",
            description: "Ultimate Achievement Unlocked (100%)",
            rarity: "platinum",
            gameTitle: game.name || game.title,
            gameIcon: game.icon_url || game.icon,
            platformLabel: "Mastery Complete",
            isPlatinum: true
          };
          newNotifications.push(notif);
          latestNotification = notif;
        }
        notifiedList.push("__PLATINUM__");
      }
    }

    notifiedMap[gameKey] = notifiedList;
    saveNotifiedAchievements(notifiedMap);
  }

  return newNotifications;
}

// API route to get latest-notification
app.get("/api/latest-notification", (req, res) => {
  res.json(latestNotification);
});

// API route for external achievement push (e.g. from Python backend)
app.post("/api/new-achievement", (req, res) => {
  const notif = req.body;
  if (notif && notif.title) {
    latestNotification = {
      id: Date.now() + Math.random(),
      ...notif
    };
    res.json({ status: "ok", notification: latestNotification });
  } else {
    res.status(400).json({ error: "Invalid achievement data" });
  }
});

// API route to get config
app.get("/api/config", (req, res) => {
  res.json(getConfig());
});

// API route to update config
app.post("/api/update-config", (req, res) => {
  try {
    const newConfig = req.body;
    const currentConfig = getConfig();
    const updatedConfig = { ...currentConfig, ...newConfig };
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updatedConfig, null, 2));
    
    // Also update process.env for the current session if keys are provided
    if (newConfig.steamApiKey) process.env.STEAM_API_KEY = newConfig.steamApiKey;
    if (newConfig.steamId) process.env.STEAM_ID = newConfig.steamId;
    if (newConfig.raUsername) process.env.RA_USERNAME = newConfig.raUsername;
    if (newConfig.raApiKey) process.env.RA_API_KEY = newConfig.raApiKey;

    res.json({ status: "ok", config: updatedConfig });
  } catch (error) {
    console.error("Failed to update config:", error);
    res.status(500).json({ error: "Failed to update config" });
  }
});

// API route to test connection and sync status
app.get("/api/sync-status", (req, res) => {
  const config = getConfig();
  const status = {
    steam: {
      configured: !!config.steamApiKey && config.steamApiKey !== "YOUR_STEAM_WEB_API_KEY",
      valid: false
    },
    retroachievements: {
      configured: !!config.raUsername && !!config.raApiKey,
      valid: false
    }
  };
  res.json(status);
});

// API route to get Steam achievements for a game
app.get("/api/steam/achievements/:appid", async (req, res) => {
  const { appid } = req.params;
  const config = getConfig();
  const apiKey = config.steamApiKey;
  const steamId = config.steamId;
  const achCacheFile = path.join(CACHE_DIR, `achievements_steam_${steamId}_${appid}.json`);

  if (!apiKey || !steamId || apiKey === "YOUR_STEAM_WEB_API_KEY") {
    return res.status(403).json({ error: "Steam API key not configured", code: "AUTH_REQUIRED" });
  }

  if (fs.existsSync(achCacheFile)) {
    return res.json(JSON.parse(fs.readFileSync(achCacheFile, "utf-8")));
  }

  try {
    // 1. Get Game Schema (Names, Descriptions, Icons)
    const schemaResponse = await fetch(
      `http://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appid}&l=hungarian`
    );
    
    if (schemaResponse.status === 401 || schemaResponse.status === 403) {
      return res.status(403).json({ error: "Invalid Steam API key", code: "AUTH_INVALID" });
    }

    const schemaData = await schemaResponse.json();
    const availableAchievements = schemaData.game?.availableGameStats?.achievements || [];

    // 2. Get User Progress
    const progressResponse = await fetch(
      `http://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?key=${apiKey}&steamid=${steamId}&appid=${appid}`
    );
    const progressData = await progressResponse.json();

    if (progressData.playerstats?.error === "Requested app has no stats") {
        return res.json([]);
    }
    
    if (progressData.playerstats?.success === false) {
        return res.status(403).json({ error: "Failed to fetch player stats. Profile might be private.", code: "AUTH_PRIVATE" });
    }

    const userAchievements = progressData.playerstats?.achievements || [];

    // 3. Merge
    const result = availableAchievements.map((schemaAch: any) => {
      const userProgress = userAchievements.find((u: any) => u.apiname === schemaAch.name);
      return {
        api_id: schemaAch.name,
        title: schemaAch.displayName || schemaAch.name,
        description: schemaAch.description || "",
        is_unlocked: userProgress ? !!userProgress.achieved : false,
        icon_url: userProgress?.achieved ? schemaAch.icon : (schemaAch.icongray || schemaAch.icon),
        unlock_time: userProgress?.unlocktime > 0 ? new Date(userProgress.unlocktime * 1000).toISOString() : null
      };
    });

    fs.writeFileSync(achCacheFile, JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error) {
    console.error(`Error fetching achievements for ${appid}:`, error);
    res.status(500).json({ error: "Failed to fetch achievements" });
  }
});

// API route to get RetroAchievements games with Deep Sync (Parallel progress fetching)
app.get("/api/ra/games", async (req, res) => {
  const config = getConfig();
  const raUser = config.raUsername;
  const raKey = config.raApiKey;

  if (!raUser || !raKey) {
    return res.json([]);
  }

  const cacheFile = path.join(CACHE_DIR, `ra_games_deep_${raUser}.json`);
  const forceRefresh = req.query.refresh === "true";

  if (!forceRefresh && fs.existsSync(cacheFile)) {
    return res.json(JSON.parse(fs.readFileSync(cacheFile, "utf-8")));
  }

  try {
    // 1. Elsődleges lista lekérése (legutóbb játszottak, ami az RA leggyakoribb listája)
    const response = await fetch(
      `https://retroachievements.org/API/API_GetUserRecentlyPlayedGames.php?u=${raUser}&z=${raUser}&y=${raKey}`
    );
    const baseGames = await response.json();
    
    // 2. MÉLYSZINKRONIZÁCIÓ (DEEP SYNC)
    // Párhuzamosan lekérjük minden játék részletes progress-ét
    const result: any[] = [];
    const chunkSize = 10; // 10-esével küldjük a kéréseket a sebesség és stabilitás kedvéért

    for (let i = 0; i < baseGames.length; i += chunkSize) {
      const chunk = baseGames.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (game: any) => {
        try {
          const detailRes = await fetch(
            `https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?u=${raUser}&g=${game.GameID}&z=${raUser}&y=${raKey}`
          );
          const detail = await detailRes.json();
          
          const unlocked = detail.NumAwarded || 0;
          const total = detail.NumAchievements || 0;
          const completionRate = total > 0 ? Math.round((unlocked / total) * 100 * 10) / 10 : 0;
          
          const raIcon = game.ImageIcon && game.ImageIcon.startsWith('http') 
            ? game.ImageIcon 
            : (game.ImageIcon ? `https://media.retroachievements.org${game.ImageIcon}` : "");

          result.push({
            id: String(game.GameID),
            name: game.Title,
            playtime_hours: 0,
            icon_url: raIcon,
            platform: "RetroAchievements",
            console_name: game.ConsoleName,
            last_played: game.LastPlayed,
            unlocked_achievements: unlocked,
            total_achievements: total,
            completion_rate: completionRate
          });
        } catch (err) {
          console.error(`Error fetching RA progress for game ${game.GameID}:`, err);
          // Ha egy játék részletei nem jönnek le, az alap adatokat adjuk hozzá
          const raIcon = game.ImageIcon && game.ImageIcon.startsWith('http') 
            ? game.ImageIcon 
            : (game.ImageIcon ? `https://media.retroachievements.org${game.ImageIcon}` : "");
            
          result.push({
            id: String(game.GameID),
            name: game.Title,
            playtime_hours: 0,
            icon_url: raIcon,
            platform: "RetroAchievements",
            console_name: game.ConsoleName,
            last_played: game.LastPlayed,
            unlocked_achievements: 0,
            total_achievements: 0,
            completion_rate: 0
          });
        }
      }));
    }

    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
    
    // NOTIFICATION DETECTION (RA)
    const notifications: any[] = [];
    const notifiedMap = getNotifiedAchievements();

    for (const game of result) {
      const gameKey = `retroachievements-${game.id}`;
      const notifiedList = notifiedMap[gameKey] || [];

      if (game.unlocked_achievements > notifiedList.length) {
        try {
          // Fetch full list for detection
          const detailRes = await fetch(`https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?u=${raUser}&g=${game.id}&z=${raUser}&y=${raKey}`);
          const detail = await detailRes.json();
          const internalAchs = Object.values(detail.Achievements || {}).map((ach: any) => ({
            api_id: String(ach.ID),
            title: ach.Title,
            description: ach.Description,
            is_unlocked: !!ach.DateEarned
          }));
          const newNotifs = await detectNewAchievements(game, internalAchs, "RetroAchievements");
          notifications.push(...newNotifs);
        } catch (e) {}
      }
    }

    res.json({ games: result, notifications });
  } catch (error) {
    console.error("Error fetching RA games Deep Sync:", error);
    res.status(500).json({ error: "Failed to fetch RA games" });
  }
});

// API route to get RetroAchievements progress for a specific game
app.get("/api/ra/achievements/:gameid", async (req, res) => {
  const { gameid } = req.params;
  const config = getConfig();
  const raUser = config.raUsername;
  const raKey = config.raApiKey;
  const cacheFile = path.join(CACHE_DIR, `ra_achievements_${raUser}_${gameid}.json`);

  if (!raUser || !raKey) return res.json([]);
  if (fs.existsSync(cacheFile)) return res.json(JSON.parse(fs.readFileSync(cacheFile, "utf-8")));

  try {
    const response = await fetch(
      `https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php?u=${raUser}&g=${gameid}&z=${raUser}&y=${raKey}`
    );
    const data = await response.json();
    
    // We need to return an array of achievements in the common format
    const achievements = Object.values(data.Achievements || {}).map((ach: any) => ({
      api_id: String(ach.ID),
      title: ach.Title,
      description: ach.Description,
      is_unlocked: !!ach.DateEarned,
      icon_url: !!ach.DateEarned 
        ? `https://media.retroachievements.org/Badge/${ach.BadgeName}.png`
        : `https://media.retroachievements.org/Badge/${ach.BadgeName}_lock.png`,
      unlock_time: ach.DateEarned || null
    }));

    // Add extra info to the game progress if needed?
    // For RA, we should probably update the main game list with more accurate % from here
    
    fs.writeFileSync(cacheFile, JSON.stringify(achievements, null, 2));
    res.json(achievements);
  } catch (error) {
    console.error(`Error fetching RA achievs for ${gameid}:`, error);
    res.status(500).json({ error: "Failed to fetch RA achievements" });
  }
});

// API route to get Xbox Live games
app.get("/api/xbox/games", async (req, res) => {
  const config = getConfig();
  const xuid = config.xboxXuid;
  let authHeader = config.xboxAuthHeader;

  if (!xuid || !authHeader) {
    return res.json([]);
  }

  if (!authHeader.includes('XBL3.0')) {
    authHeader = `XBL3.0 x=${authHeader}`;
  }

  const cacheFile = path.join(CACHE_DIR, `xbox_games_${xuid}.json`);
  const forceRefresh = req.query.refresh === "true";
  
  if (!forceRefresh && fs.existsSync(cacheFile)) {
    return res.json(JSON.parse(fs.readFileSync(cacheFile, "utf-8")));
  }

  try {
    const response = await axios.get(`https://achievements.xboxlive.com/users/xuid(${xuid})/history/titles`, {
      headers: {
        "x-xbl-contract-version": "2",
        "Authorization": authHeader,
        "Accept-Language": "hu-HU",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const titles = response.data.titles || [];
    
    // FETCH RICH METADATA FROM TITLEHUB (for images)
    let titleHubMap: Record<string, any> = {};
    try {
      const titleIds = titles.slice(0, 30).map((t: any) => String(t.titleId));
      
      if (titleIds.length > 0) {
        // Try Batch first (User-specific) - Correct payload key: titleIds
        try {
          const thResponse = await axios.post(`https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/batch/decoration/detail`, 
            { titleIds: titleIds },
            {
              headers: {
                "x-xbl-contract-version": "2",
                "Authorization": authHeader,
                "Accept": "application/json",
                "Accept-Language": "hu-HU",
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              }
            }
          );
          (thResponse.data.titles || []).forEach((thTitle: any) => {
            titleHubMap[String(thTitle.titleId)] = thTitle;
          });
          console.log(`DEBUG: TitleHub User Batch success. Found ${Object.keys(titleHubMap).length} entries.`);
        } catch (batchErr: any) {
          console.error("TitleHub User Batch failed (400?), trying Global Batch with titleIds key...");
          try {
            const globalBatchRes = await axios.post(`https://titlehub.xboxlive.com/titles/batch/decoration/detail`, 
              { titleIds: titleIds },
              {
                headers: {
                  "x-xbl-contract-version": "2",
                  "Authorization": authHeader,
                  "Accept": "application/json",
                  "Accept-Language": "hu-HU",
                  "Content-Type": "application/json",
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                }
              }
            );
            (globalBatchRes.data.titles || []).forEach((thTitle: any) => {
              titleHubMap[String(thTitle.titleId)] = thTitle;
            });
            console.log(`DEBUG: TitleHub Global Batch success. Found ${Object.keys(titleHubMap).length} entries.`);
          } catch (globalErr) {
            console.error("TitleHub Global Batch also failed, falling back to individual...");
          }
        }

        // If batch was incomplete or failed, try top 15 individually
        const missingIds = titleIds.filter(id => !titleHubMap[id]).slice(0, 15);
        if (missingIds.length > 0) {
          await Promise.all(missingIds.map(async (id) => {
            try {
              const indResponse = await axios.get(`https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/${id}/decoration/detail`, {
                headers: {
                  "x-xbl-contract-version": "2",
                  "Authorization": authHeader,
                  "Accept": "application/json",
                  "Accept-Language": "hu-HU",
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                }
              });
              const indTitles = indResponse.data.titles || [];
              if (indTitles.length > 0) {
                titleHubMap[id] = indTitles[0];
              }
            } catch (indErr) { /* Skip failures */ }
          }));
          console.log(`DEBUG: After individual sync, TitleHub Map has ${Object.keys(titleHubMap).length} entries.`);
        }
      }
    } catch (e: any) {
      console.error("TitleHub meta fetch failed:", e.message);
    }
    
    // Map titles to our internal format, merging rich metadata from TitleHub
    const baseTitles = titles.map((title: any) => {
      const titleIdStr = String(title.titleId);
      const thTitle = titleHubMap[titleIdStr] || {};
      
      const achievementInfo = title.achievement || {};
      let unlocked = achievementInfo.currentAchievements || 0;
      let total = achievementInfo.totalAchievements || 0;
      let rate = achievementInfo.progressPercentage || 0;

      if (total > 0 && !achievementInfo.progressPercentage) {
        rate = Math.round((unlocked / total) * 100);
      }

      // Xbox Image URL Formatting - Strict selection based on store-images.s-microsoft.com
      let iconUrl = "";
      
      // 1. Try different JSON paths for images based on user feedback
      const displayItemImages = (thTitle.displayItem?.images || thTitle.DisplayItem?.images || []);
      const alternateImages = (thTitle.displayInfo?.alternateImages || title.displayInfo?.alternateImages || []);
      const imagesArr = [...displayItemImages, ...alternateImages];

      // 2. Strict prioritization: BoxArt on store-images domain
      let best = imagesArr.find(img => 
        (img.type === "BoxArt" || img.purpose === "BoxArt" || img.type === "LargeBoxArt") && 
        img.url?.includes("store-images.s-microsoft.com")
      );

      // 3. Fallback to Poster on store-images
      if (!best) {
        best = imagesArr.find(img => 
          (img.type === "Poster" || img.purpose === "Poster") && 
          img.url?.includes("store-images.s-microsoft.com")
        );
      }

      // 4. Fallback to ANY store-image
      if (!best) {
        best = imagesArr.find(img => img.url?.includes("store-images.s-microsoft.com"));
      }

      // 5. Fallback to BoxArt or Poster on any domain
      if (!best) {
        best = imagesArr.find(img => ["BoxArt", "LargeBoxArt", "Poster"].includes(img.type || img.purpose));
      }

      const candidateUrl = best?.url || thTitle.displayImage || title.displayImage || thTitle.displayInfo?.itemImage?.url || "";

      if (candidateUrl) {
        let rawUrl = candidateUrl.replace("http://", "https://");
        if (rawUrl.includes("store-images.s-microsoft.com")) {
            const baseUrl = rawUrl.split('?')[0];
            // User kérése: kényszerítsük a w=300&h=450&format=jpg paramétereket
            iconUrl = `${baseUrl}?w=300&h=450&format=jpg`;
        } else {
            iconUrl = rawUrl.replace("{width}", "300").replace("{height}", "450");
        }
      }

      console.log(`DEBUG: Játék: ${title.name} | Talált képek: ${imagesArr.length} | Végső URL: ${iconUrl || "NEM TALÁLHATÓ!"}`);

      return {
        id: titleIdStr,
        name: title.name,
        playtime_hours: 0,
        icon_url: iconUrl || "",
        platform: "Xbox",
        last_played: title.lastPlayed,
        unlocked_achievements: unlocked,
        total_achievements: total,
        completion_rate: rate,
        scid: title.serviceConfigId
      };
    });

    // Deep Sync for stats - Improved: Run in parallel and sync more games
    const syncBatch = baseTitles.slice(0, 20); // Sync first 20 games
    await Promise.all(syncBatch.map(async (game: any) => {
        if (forceRefresh || game.total_achievements === 0) {
            try {
                const achRes = await axios.get(`https://achievements.xboxlive.com/users/xuid(${xuid})/achievements`, {
                    params: { titleId: game.id, maxItems: 200 },
                    headers: {
                        "x-xbl-contract-version": "2",
                        "Authorization": authHeader,
                        "Accept-Language": "hu-HU",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    }
                });
                const achs = achRes.data.achievements || [];
                if (achs.length > 0) {
                    const unlockedList = achs.filter((a: any) => a.progressState === "Achieved");
                    game.unlocked_achievements = unlockedList.length;
                    game.total_achievements = achs.length;
                    game.completion_rate = Math.round((unlockedList.length / achs.length) * 100);
                }
            } catch (e) {
                // Silently skip if individual sync fails
            }
        }
    }));

    fs.writeFileSync(cacheFile, JSON.stringify(baseTitles, null, 2));
    
    // NOTIFICATION DETECTION (Xbox)
    const notifications: any[] = [];
    const notifiedMap = getNotifiedAchievements();

    for (const game of baseTitles) {
      const gameKey = `xbox-${game.id}`;
      const notifiedList = notifiedMap[gameKey] || [];

      if (game.unlocked_achievements > notifiedList.length) {
        try {
          const achRes = await axios.get(`https://achievements.xboxlive.com/users/xuid(${xuid})/achievements`, {
            params: { titleId: game.id, maxItems: 200 },
            headers: {
              "x-xbl-contract-version": "2",
              "Authorization": authHeader,
              "Accept-Language": "hu-HU",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
          });
          const achs = (achRes.data.achievements || []).map((a: any) => ({
            api_id: String(a.id),
            title: a.name,
            description: a.description || a.lockedDescription,
            is_unlocked: a.progressState === "Achieved"
          }));
          const newNotifs = await detectNewAchievements(game, achs, "Xbox");
          notifications.push(...newNotifs);
        } catch (e) {}
      }
    }

    res.json({ games: baseTitles, notifications });
  } catch (error: any) {
    console.error("Error fetching Xbox games:", error.response?.status || error.message);
    if (error.response?.status === 401) {
      return res.status(401).json({ error: "Token lejárt" });
    }
    res.status(500).json({ error: "Failed to fetch Xbox games" });
  }
});

// API route to get Xbox Achievements for a specific title
app.get("/api/xbox/achievements/:scid/:titleId", async (req, res) => {
  const { scid, titleId } = req.params;
  const config = getConfig();
  const xuid = config.xboxXuid;
  let authHeader = config.xboxAuthHeader;

  if (!xuid || !authHeader) return res.json([]);

  if (!authHeader.includes('XBL3.0')) {
    authHeader = `XBL3.0 x=${authHeader}`;
  }

  try {
    const response = await axios.get(`https://achievements.xboxlive.com/users/xuid(${xuid})/achievements`, {
      params: {
        titleId: titleId,
        maxItems: 100
      },
      headers: {
        "x-xbl-contract-version": "2",
        "Authorization": authHeader,
        "Accept-Language": "hu-HU",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const achievements = (response.data.achievements || []).map((ach: any) => {
      let iconUrl = ach.mediaAssets?.[0]?.url || "";
      if (iconUrl) {
        iconUrl = iconUrl.replace("http://", "https://")
                        .replace("{width}", "200")
                        .replace("{height}", "200");
      }
      return {
        api_id: ach.id,
        title: ach.name,
        description: ach.description || ach.lockedDescription,
        is_unlocked: ach.progressState === "Achieved",
        icon_url: iconUrl,
        unlock_time: ach.progression?.timeUnlocked || null,
        gamerscore: ach.rewards?.find((r: any) => r.type === "Gamerscore")?.value || 0
      };
    });

    res.json(achievements);
  } catch (error: any) {
    console.error(`Error fetching Xbox achievements for ${titleId}:`, error.response?.status || error.message);
    if (error.response?.status === 401) {
      return res.status(401).json({ error: "Token lejárt" });
    }
    res.status(500).json({ error: "Failed to fetch Xbox achievements" });
  }
});

// Helper to fetch Steam Metadata for Goldberg
async function getSteamGameMetadata(appId: string, apiKey: string, localGamePath?: string) {
  const metaCacheFile = path.join(CACHE_DIR, `steam_metadata_${appId}.json`);
  const localSchemaFile = localGamePath ? path.join(localGamePath, "steam_schema.json") : null;

  // 1. Check local folder cache first (user request)
  if (localSchemaFile && fs.existsSync(localSchemaFile)) {
    try {
      return JSON.parse(fs.readFileSync(localSchemaFile, "utf-8"));
    } catch (e) {}
  }

  // 2. Check global cache
  if (fs.existsSync(metaCacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(metaCacheFile, "utf-8"));
      // If we have a local path and it didn't have the schema, save it there too
      if (localSchemaFile && !fs.existsSync(localSchemaFile)) {
        fs.writeFileSync(localSchemaFile, JSON.stringify(cached, null, 2));
      }
      return cached;
    } catch (e) {}
  }

  const metadata: any = {
    name: appId,
    achievements: []
  };

  try {
    // 1. Get Game Details (Name and Header Image)
    const storeRes = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=hungarian`);
    if (storeRes.data[appId]?.success) {
      metadata.name = storeRes.data[appId].data.name;
      metadata.header_image = storeRes.data[appId].data.header_image;
    }

    // Advanced Scraper Fallback for Header Image
    if (!metadata.header_image) {
      const scraped = await getScrapedSteamImage(appId, "STEAM");
      metadata.header_image = scraped || `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
    }
    console.log(`[STEAM METADATA] Header Image URL for ${appId}:`, metadata.header_image);

    // 2. Get Achievement Schema from Steam API
    // If apiKey is empty, this might fail, we catch it
    if (apiKey) {
      try {
        const schemaRes = await axios.get(`http://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${appId}&l=hungarian`);
        if (schemaRes.data.game?.availableGameStats?.achievements) {
          metadata.achievements = schemaRes.data.game.availableGameStats.achievements.map((a: any) => ({
            api_id: a.name,
            title: a.displayName || a.name,
            description: a.description || "",
            icon: a.icon?.startsWith("http") ? a.icon : `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appId}/${a.icon}.jpg`
          }));
        }
      } catch (e) {
        console.error(`Steam Schema API failed for ${appId} with key.`);
      }
    }

    // 3. Fallback: Scraping or XML if schema is still empty
    if (metadata.achievements.length === 0) {
      try {
        const xmlRes = await axios.get(`https://steamcommunity.com/stats/${appId}/achievements/?xml=1&l=hungarian`);
        const xml = xmlRes.data;
        // Basic regex parsing for XML achievements
        const achMatches = xml.matchAll(/<achievement>([\s\S]*?)<\/achievement>/g);
        for (const match of achMatches) {
          const content = match[1];
          const nameMatch = content.match(/<name><!\[CDATA\[(.*?)\]\]><\/name>/);
          const titleMatch = content.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
          const descMatch = content.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
          const iconMatch = content.match(/<iconClosed><!\[CDATA\[(.*?)\]\]><\/iconClosed>/);

          if (nameMatch) {
            metadata.achievements.push({
              api_id: nameMatch[1],
              title: titleMatch ? titleMatch[1] : nameMatch[1],
              description: descMatch ? descMatch[1] : "",
              icon: iconMatch ? iconMatch[1] : ""
            });
          }
        }
      } catch (e) {
        console.error(`Steam XML scraping fallback failed for ${appId}.`);
      }
    }

    // Save outputs
    fs.writeFileSync(metaCacheFile, JSON.stringify(metadata, null, 2));
    if (localSchemaFile) {
      try {
        fs.writeFileSync(localSchemaFile, JSON.stringify(metadata, null, 2));
      } catch (e) {}
    }
  } catch (e: any) {
    console.error(`Metadata fetch failed for ${appId}:`, e.message);
  }

  return metadata;
}

// --- GOLDBERG EMULATOR MANAGER ---
app.get("/api/goldberg/games", async (req, res) => {
  const config = getConfig();
  const rootPath = config.goldbergPath;

  if (!rootPath || !fs.existsSync(rootPath)) {
    return res.json([]);
  }

  try {
    const appIds = fs.readdirSync(rootPath).filter(f => fs.statSync(path.join(rootPath, f)).isDirectory());
    const result = await Promise.all(appIds.map(async appId => {
      const appPath = path.join(rootPath, appId);
      const achievementsJsonPath = path.join(appPath, "achievements.json");
      const nameTxtPath = path.join(appPath, "name.txt");

      if (!fs.existsSync(achievementsJsonPath)) return null;

      // 1. Get Game Name (txt or Steam API)
      let gameName = appId;
      if (fs.existsSync(nameTxtPath)) {
        gameName = fs.readFileSync(nameTxtPath, "utf-8").trim();
      }
      
      const steamMeta = await getSteamGameMetadata(appId, config.steamApiKey, appPath);
      if (gameName === appId) gameName = steamMeta.name;

      // 2. Parse Achievements
      const achievementsData = JSON.parse(fs.readFileSync(achievementsJsonPath, "utf-8"));
      // Goldberg format usually: { "ACH_API_NAME": { "earned": true, "earned_time": ... }, ... }
      const achievements = Object.keys(achievementsData).map(key => ({
        api_id: key,
        is_unlocked: !!achievementsData[key].earned
      }));

      const unlockedCount = achievements.filter(a => a.is_unlocked).length;
      const totalCount = achievements.length;
      const rate = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

      const iconUrl = steamMeta.header_image || `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/header.jpg`;

      return {
        id: appId,
        name: gameName,
        playtime_hours: 0,
        icon_url: iconUrl,
        platform: "Goldberg",
        last_played: null,
        unlocked_achievements: unlockedCount,
        total_achievements: totalCount,
        completion_rate: rate,
        localPath: appPath,
        header_image: steamMeta.header_image,
        cover_url: steamMeta.header_image
      };
    }));

    const filteredResult = (result.filter(Boolean) as any[]);

    // NOTIFICATION DETECTION (Goldberg)
    const notifications: any[] = [];
    const notifiedMap = getNotifiedAchievements();
    
    for (const game of filteredResult) {
      const gameKey = `goldberg-${game.id}`;
      const notifiedList = notifiedMap[gameKey] || [];
      
      if (game.unlocked_achievements > notifiedList.length) {
        try {
          const achievementsData = JSON.parse(fs.readFileSync(path.join(game.localPath, "achievements.json"), "utf-8"));
          const steamMeta = await getSteamGameMetadata(game.id, config.steamApiKey, game.localPath);
          
          const internalAchs = Object.keys(achievementsData).map(key => {
            const meta = steamMeta.achievements.find((a: any) => a.api_id === key);
            const localData = achievementsData[key] || {};
            
            // Prioritize metadata icon. If missing, and we have local icon, check if it's a hash.
            let finalIcon = meta?.icon || "";
            if (!finalIcon && localData.icon) {
              if (localData.icon.startsWith("http")) {
                finalIcon = localData.icon;
              } else {
                // Strip images/ folder and .jpg/.png extension to get the clean hash
                const cleanedHash = path.basename(localData.icon, path.extname(localData.icon));
                finalIcon = `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${getCleanId(game.id)}/${cleanedHash}.jpg`;
              }
            }

            return {
              api_id: key,
              title: meta?.title || localData.displayName || key,
              description: meta?.description || localData.description || "",
              is_unlocked: !!localData.earned || !!localData.unlocked,
              icon_url: finalIcon,
              unlock_time: localData.earned_time ? new Date(localData.earned_time * 1000).toISOString() : 
                           localData.unlock_time ? localData.unlock_time : null
            };
          });
          const newNotifs = await detectNewAchievements(game, internalAchs, "Goldberg");
          notifications.push(...newNotifs);
        } catch (e) {}
      }
    }

    res.json({ games: filteredResult, notifications });
  } catch (error) {
    console.error("Error fetching Goldberg games:", error);
    res.status(500).json({ error: "Failed to scan Goldberg folder" });
  }
});

app.get("/api/goldberg/achievements/:appId", async (req, res) => {
  const { appId } = req.params;
  const config = getConfig();
  const rootPath = config.goldbergPath;
  if (!rootPath) return res.json([]);

  const achievementsJsonPath = path.join(rootPath, appId, "achievements.json");
  if (!fs.existsSync(achievementsJsonPath)) return res.json([]);

  try {
    const achievementsData = JSON.parse(fs.readFileSync(achievementsJsonPath, "utf-8"));
    const localGamePath = path.join(rootPath, appId);
    const steamMeta = await getSteamGameMetadata(appId, config.steamApiKey, localGamePath);

    const achievements = Object.keys(achievementsData).map(key => {
      const meta = steamMeta.achievements.find((a: any) => a.api_id === key);
      const localData = achievementsData[key] || {};
      
      let finalIcon = meta?.icon || "";
      if (!finalIcon && localData.icon) {
        if (localData.icon.startsWith("http")) {
          finalIcon = localData.icon;
        } else {
          const cleanedHash = path.basename(localData.icon, path.extname(localData.icon));
          finalIcon = `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${getCleanId(appId)}/${cleanedHash}.jpg`;
        }
      }

      return {
        api_id: key,
        title: meta?.title || localData.displayName || key,
        description: meta?.description || localData.description || "",
        is_unlocked: !!localData.earned || !!localData.unlocked,
        icon_url: finalIcon,
        unlock_time: localData.earned_time ? new Date(localData.earned_time * 1000).toISOString() : 
                     localData.unlock_time ? localData.unlock_time : null
      };
    });
    res.json(achievements);
  } catch (err) {
    res.status(500).json({ error: "Failed to read achievements" });
  }
});

// --- DEBUG / SANDBOX MANAGER ---
app.post("/api/debug/process-goldberg-test", async (req, res) => {
  const { appId, achievementsJson } = req.body;
  const config = getConfig();

  if (!appId || !achievementsJson) {
    return res.status(400).json({ error: "Missing AppID or achievementsJson" });
  }

  try {
    const achievementsData = typeof achievementsJson === 'string' ? JSON.parse(achievementsJson) : achievementsJson;
    const steamMeta = await getSteamGameMetadata(appId, config.steamApiKey);

    const achievements = Object.keys(achievementsData).map(key => {
      const meta = steamMeta.achievements.find((a: any) => a.api_id === key);
      const localData = achievementsData[key] || {};
      
      let finalIcon = meta?.icon || "";
      if (!finalIcon && localData.icon) {
        if (localData.icon.startsWith("http")) {
          finalIcon = localData.icon;
        } else {
          const cleanedHash = path.basename(localData.icon, path.extname(localData.icon));
          finalIcon = `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${getCleanId(appId)}/${cleanedHash}.jpg`;
        }
      }

      return {
        api_id: key,
        title: meta?.title || localData.displayName || key,
        description: meta?.description || localData.description || "",
        is_unlocked: !!localData.earned || !!localData.unlocked,
        icon_url: finalIcon,
        original_hash: localData.icon || "N/A",
        unlock_time: localData.earned_time ? new Date(localData.earned_time * 1000).toISOString() : 
                     localData.unlock_time ? localData.unlock_time : null
      };
    });

    res.json({
      gameName: steamMeta.name,
      icon: `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/header.jpg`,
      achievements
    });
  } catch (error: any) {
    console.error("Debug process failed:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- RPCS3 MANAGER ---
const RPCS3_TROPHY_SUBPATH = "dev_hdd0/home/00000001/trophy";

app.get("/api/rpcs3/games", async (req, res) => {
  const config = getConfig();
  const rootPath = config.rpcs3Path;

  if (!rootPath || !fs.existsSync(rootPath)) {
    return res.json([]);
  }

  const trophyPath = path.join(rootPath, RPCS3_TROPHY_SUBPATH);
  if (!fs.existsSync(trophyPath)) {
    console.warn("RPCS3 Trophy path not found:", trophyPath);
    return res.json([]);
  }

  try {
    const gameDirs = fs.readdirSync(trophyPath).filter(f => fs.statSync(path.join(trophyPath, f)).isDirectory());
    const result = gameDirs.map(dirName => {
      const gameDirPath = path.join(trophyPath, dirName);
      const confPath = path.join(gameDirPath, "TROPCONF.SFM");
      const userDatPath = path.join(gameDirPath, "TROPUSR.DAT");
      const iconPath = path.join(gameDirPath, "ICON0.PNG");

      if (!fs.existsSync(confPath)) return null;

      // 1. Parse TROPCONF.SFM (XML-ish) for Game Title
      const confContent = fs.readFileSync(confPath, "utf-8");
      const titleMatch = confContent.match(/<title>([^<]+)<\/title>/i);
      const gameTitle = titleMatch ? titleMatch[1] : dirName;

      // Count total trophies from TROPCONF
      const trophyCount = (confContent.match(/<trophy id=/gi) || []).length;

      // 2. Parse TROPUSR.DAT for Unlocked count
      let unlockedCount = 0;
      if (fs.existsSync(userDatPath)) {
        const buffer = fs.readFileSync(userDatPath);
        // RPCS3 Wiki: Header is 64 bytes. Each trophy entry is 16 bytes?
        // Actually, we can check 16-byte blocks from offset 64.
        // If the timestamp (usually byte 8-15 of the entry) is > 0, it's earned.
        for (let i = 64; i < buffer.length; i += 16) {
          const timestamp = buffer.readBigUInt64LE(i + 8);
          if (timestamp > 0n) {
            unlockedCount++;
          }
        }
      }

      // 3. Icon handling (serve path or base64)
      let iconUrl = "";
      if (fs.existsSync(iconPath)) {
        // For the web app, we'll serve it through a proxy route
        iconUrl = `/api/rpcs3/image?path=${encodeURIComponent(iconPath)}`;
      }

      return {
        id: dirName,
        name: gameTitle,
        playtime_hours: 0,
        icon_url: iconUrl,
        platform: "PS3",
        last_played: null,
        unlocked_achievements: unlockedCount,
        total_achievements: trophyCount,
        completion_rate: trophyCount > 0 ? Math.round((unlockedCount / trophyCount) * 100) : 0,
        localPath: gameDirPath
      };
    }).filter(Boolean);

    // NOTIFICATION DETECTION (RPCS3)
    const notifications: any[] = [];
    const notifiedMap = getNotifiedAchievements();
    
    for (const game of result) {
      const gameKey = `ps3-${game.id}`;
      const notifiedList = notifiedMap[gameKey] || [];
      
      if (game.unlocked_achievements > notifiedList.length) {
        try {
          const gameDirPath = game.localPath;
          const confPath = path.join(gameDirPath, "TROPCONF.SFM");
          const userDatPath = path.join(gameDirPath, "TROPUSR.DAT");
          
          if (fs.existsSync(confPath) && fs.existsSync(userDatPath)) {
            const confContent = fs.readFileSync(confPath, "utf-8");
            const buffer = fs.readFileSync(userDatPath);
            
            const unlockTimes: Record<number, boolean> = {};
            for (let i = 64; i < buffer.length; i += 16) {
              const timestamp = buffer.readBigUInt64LE(i + 8);
              if (timestamp > 0n) unlockTimes[(i - 64) / 16] = true;
            }

            const trophies: any[] = [];
            const trophyRegex = /<trophy id="(\d+)"[^>]*>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<detail>([^<]+)<\/detail>/gi;
            let m;
            while ((m = trophyRegex.exec(confContent)) !== null) {
              const tid = parseInt(m[1]);
              trophies.push({
                api_id: String(tid),
                title: m[2],
                description: m[3],
                is_unlocked: !!unlockTimes[tid]
              });
            }
            const newNotifs = await detectNewAchievements(game, trophies, "PS3");
            notifications.push(...newNotifs);
          }
        } catch (e) {
          console.error("RPCS3 Notif detect error:", e);
        }
      }
    }

    res.json({ games: result, notifications });
  } catch (error) {
    console.error("Error fetching RPCS3 games:", error);
    res.status(500).json({ error: "Failed to scan RPCS3 folder" });
  }
});

// Serve local images securely
app.get("/api/rpcs3/image", (req, res) => {
  const imgPath = req.query.path as string;
  if (!imgPath || !fs.existsSync(imgPath)) {
    return res.status(404).send("Image not found");
  }
  // Basic security: only serve PNGs from RPCS3 path
  const config = getConfig();
  if (!imgPath.startsWith(config.rpcs3Path)) {
      return res.status(403).send("Forbidden");
  }
  res.sendFile(imgPath);
});

app.get("/api/rpcs3/achievements/:gameId", (req, res) => {
    const { gameId } = req.params;
    const config = getConfig();
    const rootPath = config.rpcs3Path;
    if (!rootPath) return res.json([]);

    const gameDirPath = path.join(rootPath, RPCS3_TROPHY_SUBPATH, gameId);
    const confPath = path.join(gameDirPath, "TROPCONF.SFM");
    const userDatPath = path.join(gameDirPath, "TROPUSR.DAT");

    if (!fs.existsSync(confPath)) return res.json([]);

    try {
        const confContent = fs.readFileSync(confPath, "utf-8");
        const trophies: any[] = [];
        
        // Regex to extract trophy metadata
        const trophyRegex = /<trophy id="(\d+)"[^>]*>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<detail>([^<]+)<\/detail>/gi;
        let match;
        
        // Parse TROPUSR.DAT for unlock times
        const unlockTimes: Record<number, string | null> = {};
        if (fs.existsSync(userDatPath)) {
            const buffer = fs.readFileSync(userDatPath);
            let index = 0;
            for (let i = 64; i < buffer.length; i += 16) {
                const timestamp = buffer.readBigUInt64LE(i + 8);
                if (timestamp > 0n) {
                    // Convert PS3 timestamp (microseconds since 2000-01-01 maybe? or just standard epoch?)
                    // For RPCS3, it's usually standard or similar.
                    unlockTimes[index] = new Date(Number(timestamp) / 1000).toISOString(); 
                }
                index++;
            }
        }

        while ((match = trophyRegex.exec(confContent)) !== null) {
            const id = parseInt(match[1]);
            trophies.push({
                api_id: String(id),
                title: match[2],
                description: match[3],
                is_unlocked: !!unlockTimes[id],
                icon_url: `/api/rpcs3/image?path=${encodeURIComponent(path.join(gameDirPath, `TROP${String(id).padStart(3, '0')}.PNG`))}`, // Individual trophy icons if they exist
                unlock_time: unlockTimes[id] || null
            });
        }

        res.json(trophies);
    } catch (err) {
        res.status(500).json({ error: "Failed to parse achievements" });
    }
});

// --- IMAGE PROXY (CORS FIX) ---
// Achievement icon proxy (direct pass-through)
app.get("/api/proxy-achievement", async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) return res.status(400).send("Missing URL");

  console.log(`DEBUG: Achievement icon request: ${imageUrl}`);

  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    res.set('Content-Type', response.headers['content-type'] as string);
    res.send(response.data);
  } catch (error) {
    console.error(`Proxy error for achievement icon ${imageUrl}:`, (error as Error).message);
    // Return 1x1 transparent pixel on failure
    const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.set('Content-Type', 'image/gif');
    res.send(pixel);
  }
});

app.get("/api/proxy-image", async (req, res) => {
  let imageUrl = req.query.url as string;
  const appId = req.query.appid as string;
  const platform = req.query.platform as string;

  console.log(`DEBUG: Banner image request: appId=${appId}, platform=${platform}, url=${imageUrl}`);

  let finalUrl = "";
  
  if (appId) {
    finalUrl = await getScrapedSteamImage(appId, platform || 'STEAM') || "";
  }
  
  if (!finalUrl && imageUrl) {
      finalUrl = imageUrl.replace(/debug-/, '');
  }
  
  // Fallback: If still no finalUrl, but it's a Steam/Goldberg game, use the header URL directly.
  if (!finalUrl && appId && (platform === 'STEAM' || platform === 'GOLDBERG')) {
      finalUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
  }

  if (!finalUrl) {
    // Return transparent 1x1 GIF on error
    const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.set('Content-Type', 'image/gif');
    res.send(transparentGif);
    return;
  }
  imageUrl = finalUrl;

  try {
    const response = await axios({
      url: imageUrl,
      method: 'GET',
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    res.send(response.data);
  } catch (error) {
    console.warn(`Proxy error for ${imageUrl}:`, (error as Error).message);
    
    // Clear cache if appId was provided, as the URL it got might be stale/bad
    if (appId) {
        const cache = getScrapedCache();
        if (cache[appId]) {
            delete cache[appId];
            saveScrapedCache(cache);
            console.info(`Cleared stale scrape cache for appId: ${appId}`);
        }
    }

    // Return transparent 1x1 GIF on error
    const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.setHeader('Content-Type', 'image/gif');
    res.send(transparentGif);
  }
});

// API route to save config
app.post("/api/config", (req, res) => {
  const { steamApiKey, steamId, raUsername, raApiKey, xboxXuid, xboxAuthHeader, rpcs3Path, goldbergPath, sounds, notificationScale, notificationStyle } = req.body;
  const oldConfig = getConfig();
  const newConfig = { 
    ...oldConfig,
    steamApiKey, 
    steamId, 
    raUsername, 
    raApiKey,
    xboxXuid,
    xboxAuthHeader,
    rpcs3Path,
    goldbergPath: goldbergPath !== undefined ? goldbergPath : oldConfig.goldbergPath,
    notificationScale: notificationScale !== undefined ? notificationScale : oldConfig.notificationScale,
    notificationStyle: notificationStyle || oldConfig.notificationStyle,
    sounds: sounds || oldConfig.sounds
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  // Clear cache when config changes
  if (fs.existsSync(CACHE_FILE)) {
    fs.unlinkSync(CACHE_FILE);
  }
  res.json({ success: true });
});

// API route to get Steam games
app.get("/api/steam/games", async (req, res) => {
  const config = getConfig();
  const apiKey = config.steamApiKey;
  const steamId = config.steamId;

  if (!apiKey || !steamId) {
    return res.json([]);
  }

  // Check cache (only if not forcing refresh)
  const forceRefresh = req.query.refresh === "true";
  if (!forceRefresh && fs.existsSync(CACHE_FILE)) {
    const cacheData = fs.readFileSync(CACHE_FILE, "utf-8");
    return res.json(JSON.parse(cacheData));
  }

  try {
    // 1. Get owned games
    const gamesResponse = await fetch(
      `http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamId}&format=json&include_appinfo=1&include_played_free_games=1`
    );
    const gamesData = await gamesResponse.json();
    const ownedGames = gamesData.response.games || [];

    // Filter games (at least 0 minutes played - fetch all)
    const playedGames = ownedGames;

    const result: any[] = [];
    
    // Batch processing
    const chunkSize = 15; // Slightly smaller chunk for better reliability
    for (let i = 0; i < playedGames.length; i += chunkSize) {
      const chunk = playedGames.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (game: any) => {
        try {
          const achResponse = await fetch(
            `http://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?key=${apiKey}&steamid=${steamId}&appid=${game.appid}`
          );
          
          if (achResponse.ok) {
            const achData = await achResponse.json();
            const achievements = achData.playerstats?.achievements || [];
            
            if (achievements.length > 0) {
              const unlocked = achievements.filter((a: any) => a.achieved).length;
              result.push({
                appid: String(game.appid),
                name: game.name,
                playtime_hours: Math.round(game.playtime_forever / 60 * 10) / 10,
                icon_url: `https://cdn.akamai.steamstatic.com/steam/apps/${getCleanId(game.appid)}/header.jpg`,
                platform: "Steam",
                completion_rate: Math.round((unlocked / achievements.length) * 100 * 10) / 10,
                total_achievements: achievements.length,
                unlocked_achievements: unlocked,
                header_image: `https://cdn.akamai.steamstatic.com/steam/apps/${getCleanId(game.appid)}/header.jpg`,
                cover_url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${getCleanId(game.appid)}/library_600x900.jpg`
              });
            }
          }
        } catch (error) {
          console.warn(`Skipping game ${game.appid} (${game.name})`);
        }
      }));
    }

    // Save cache
    fs.writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2));
    
    // NOTIFICATION DETECTION
    const notifications: any[] = [];
    const notifiedMap = getNotifiedAchievements();
    
    for (const game of result) {
      const gameKey = `steam-${game.appid}`;
      const notifiedList = notifiedMap[gameKey] || [];
      
      // If unlocked count > notified count, fetch details to find what's new
      if (game.unlocked_achievements > notifiedList.length) {
        try {
          // Fetch schema and progress internally
          const apiKey = config.steamApiKey;
          const steamId = config.steamId;
          
          const sRes = await fetch(`http://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${apiKey}&appid=${game.appid}&l=hungarian`);
          const sData = await sRes.json();
          const pRes = await fetch(`http://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?key=${apiKey}&steamid=${steamId}&appid=${game.appid}`);
          const pData = await pRes.json();
          
          const available = sData.game?.availableGameStats?.achievements || [];
          const progress = pData.playerstats?.achievements || [];
          
          const internalAchs = available.map((sa: any) => {
            const up = progress.find((u: any) => u.apiname === sa.name);
            return {
              api_id: sa.name,
              title: sa.displayName || sa.name,
              description: sa.description || "",
              is_unlocked: up ? !!up.achieved : false
            };
          });

          const newNotifs = await detectNewAchievements(game, internalAchs, "Steam");
          notifications.push(...newNotifs);
        } catch (e) {
          console.error(`Steam notification fetch failed for ${game.name}`);
        }
      }
    }

    res.json({ games: result, notifications });

  } catch (error) {
    console.error("Error fetching from Steam:", error);
    res.status(500).json({ error: "Failed to fetch from Steam API" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
