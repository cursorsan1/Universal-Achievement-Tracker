import { motion, AnimatePresence } from "motion/react";
import { 
  Gamepad2, 
  Trophy, 
  Clock, 
  TerminalSquare, 
  Search, 
  Settings, 
  CheckCircle2, 
  Layers,
  Menu,
  X,
  RefreshCw,
  ArrowLeft,
  Calendar,
  Play,
  Upload,
  Bell,
  Terminal,
  Star,
  Zap
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback, useRef, ChangeEvent } from "react";

interface Game {
  id: string;
  appid?: string;
  title: string;
  platform: string;
  completion: number;
  playtime: string;
  icon: string;
  color: string;
  platformColor: string;
  unlockedCount?: number;
  totalCount?: number;
  consoleName?: string;
  scid?: string;
  headerImage?: string;
  cover_url?: string;
}

interface Achievement {
  api_id: string;
  title: string;
  description: string;
  is_unlocked: boolean;
  icon_url: string;
  unlock_time: string | null;
}

// Kezdeti statikus adatok (Fallback - Üres indítás)
const INITIAL_GAMES: Game[] = [];

const getCleanId = (id: string | number) => {
  return id.toString().replace('debug-', '').replace('steam-', '').replace('goldberg-', '');
};

// Start of the Dashboard component (previously App)
function Dashboard() {
  const [activeTab, setActiveTab] = useState("recent");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [games, setGames] = useState<Game[]>(INITIAL_GAMES);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Achievement detail state
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [isAchLoading, setIsAchLoading] = useState(false);
  
  // Settings state
  const [steamApiKey, setSteamApiKey] = useState("");
  const [steamId, setSteamId] = useState("");
  const [raUsername, setRaUsername] = useState("");
  const [raApiKey, setRaApiKey] = useState("");
  const [xboxXuid, setXboxXuid] = useState("");
  const [xboxAuthHeader, setXboxAuthHeader] = useState("");
  const [rpcs3Path, setRpcs3Path] = useState("");
  const [goldbergPath, setGoldbergPath] = useState("");
  const [testAppId, setTestAppId] = useState("");
  const [testJsonContent, setTestJsonContent] = useState("");
  const [debugLogs, setDebugLogs] = useState<{msg: string, type: 'info' | 'error'}[]>([]);
  const [isDebugProcessing, setIsDebugProcessing] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const isInitialized = useRef(false);
  const logRef = useRef<{msg: string, type: 'info' | 'error'}[]>([]);

  const getSteamImageUrl = useCallback((appId: string | number, iconPath: string, useProxy = true) => {
    if (!iconPath) return "";
    
    // Clean AppID: remove platform prefixes for CDN lookups
    const cleanAppId = getCleanId(appId);
    
    if (iconPath.startsWith("http") && !iconPath.includes("steamcdn") && !iconPath.includes("akamaihd")) return iconPath;
    
    let finalUrl = "";
    if (iconPath.startsWith("http")) {
      finalUrl = iconPath.replace("http://", "https://");
    } else {
      // Extract hash using regex: remove path/ and .extension
      const match = iconPath.match(/(?:.*\/)?([a-f0-9]+)(?:\.\w+)?/i);
      const hash = match ? match[1] : iconPath;
      finalUrl = `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${cleanAppId}/${hash}.jpg`;
    }
    
    // Use proxy for Steam CDN images to fix CORS and Protocol issues
    if (!useProxy) return finalUrl;
    return `/api/proxy-image?url=${encodeURIComponent(finalUrl)}`;
  }, []);

  const addLog = useCallback((msg: string, type: 'info' | 'error' = 'info') => {
    if (type === 'error') {
      console.error(`[INTERNAL ERROR] ${msg}`);
      setDebugLogs(prev => [{ msg: `[${new Date().toLocaleTimeString()}] ${msg}`, type }, ...prev].slice(0, 100));
    } else {
      console.log(`[INFO] ${msg}`);
    }
  }, []);

  const addLogs = useCallback((newLogs: { msg: string, type?: 'info' | 'error' }[]) => {
    const time = new Date().toLocaleTimeString();
    const errorsOnly = newLogs.filter(l => l.type === 'error');
    
    if (errorsOnly.length > 0) {
      const formatted = errorsOnly.map(l => ({
        msg: `[${time}] ${l.msg}`,
        type: l.type || 'info'
      }));
      setDebugLogs(prev => [...formatted, ...prev].slice(0, 100));
    }
    
    newLogs.forEach(l => {
      if (l.type === 'error') console.error(`[DEBUG ERROR] ${l.msg}`);
      else console.log(`[DEBUG INFO] ${l.msg}`);
    });
  }, []);
  const [raritySounds, setRaritySounds] = useState<Record<string, string>>({
    common: "",
    rare: "",
    ultrarare: "",
    platinum: ""
  });

  const getAudioUrl = (rarity: string) => {
    // Return custom sound if available, otherwise fallback to default
    if (raritySounds[rarity]) return raritySounds[rarity];
    return "https://assets.mixkit.co/active_storage/sfx/2012/2012-preview.mp3";
  };

  const processIncomingNotifications = (notifs: any[]) => {
    if (!notifs || notifs.length === 0) return;
    
    notifs.forEach((notif, index) => {
      setTimeout(() => {
        const id = Date.now() + index;
        setNotifications(prev => [...prev, { ...notif, id }]);

        // Sound handle (Rarity based)
        const soundUrl = getAudioUrl(notif.rarity || "common");
        const audio = new Audio(soundUrl);
        audio.volume = notificationVolume / 100;
        audio.play().catch(() => {});

        setTimeout(() => {
          setNotifications(prev => prev.filter(n => n.id !== id));
        }, notificationDuration * 1000);
      }, index * 1000); // Stagger notifications
    });
  };
  
  // Notification states
  const [notifications, setNotifications] = useState<any[]>([]);
  const [overlayPosition, setOverlayPosition] = useState("top-right");
  const [notificationVolume, setNotificationVolume] = useState(80);
  const [notificationDuration, setNotificationDuration] = useState(5);
  const [notificationScale, setNotificationScale] = useState(1.0);

  const [xboxStatus, setXboxStatus] = useState<"ok" | "expired" | "idle">("idle");
  const [showXboxHelper, setShowXboxHelper] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success">("idle");

  // Load config on mount
  useEffect(() => {
    fetch("/api/config")
      .then(res => res.json())
      .then(data => {
        setSteamApiKey(data.steamApiKey || "");
        setSteamId(data.steamId || "");
        setRaUsername(data.raUsername || "");
        setRaApiKey(data.raApiKey || "");
        setXboxXuid(data.xboxXuid || "");
        setXboxAuthHeader(data.xboxAuthHeader || "");
        setRpcs3Path(data.rpcs3Path || "");
        setGoldbergPath(data.goldbergPath || "");
        setNotificationScale(data.notificationScale !== undefined ? data.notificationScale : 1.0);
        if (data.sounds) setRaritySounds(data.sounds);
      });
  }, []);

  useEffect(() => {
    if (selectedGame) {
      console.log("🖼️ COVER LOAD ATTEMPT:", { 
        appId: getCleanId(selectedGame.id), 
        receivedUrl: selectedGame.cover_url || selectedGame.headerImage 
      });
    }
  }, [selectedGame]);

  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true;
      syncGames();
    }
  }, []);

  const syncGames = async (force: boolean = false) => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      // 1. Fetch Steam
      const steamResponse = await fetch(`/api/steam/games${force ? "?refresh=true" : ""}`);
      const steamData = await steamResponse.json();
      const steamGames = Array.isArray(steamData) ? steamData : (steamData.games || []);
      if (steamData.notifications) processIncomingNotifications(steamData.notifications);

      const steamGamesConverted: Game[] = steamGames.map((g: any) => ({
        id: `steam-${g.appid}`,
        appid: g.appid,
        title: g.name,
        platform: "Steam",
        completion: g.completion_rate,
        playtime: `${g.playtime_hours} óra`,
        icon: g.icon_url,
        headerImage: g.header_image,
        cover_url: g.cover_url,
        color: g.completion_rate === 100 ? "from-yellow-400/20 to-yellow-600/0" : "from-indigo-500/10 to-transparent",
        platformColor: "text-slate-200 bg-slate-700/50",
        unlockedCount: g.unlocked_achievements,
        totalCount: g.total_achievements
      }));

      // 2. Fetch RetroAchievements
      const raResponse = await fetch(`/api/ra/games${force ? "?refresh=true" : ""}`);
      const raData = await raResponse.json();
      const raGames = Array.isArray(raData) ? raData : (raData.games || []);
      if (raData.notifications) processIncomingNotifications(raData.notifications);

      const raGamesConverted: Game[] = raGames.map((g: any) => ({
        id: `ra-${g.id}`,
        appid: g.id,
        title: g.name,
        platform: "RetroAchievements",
        completion: g.completion_rate, 
        playtime: g.last_played ? `Utoljára: ${new Date(g.last_played).toLocaleDateString()}` : "Nincs adat",
        icon: g.icon_url,
        color: g.completion_rate === 100 ? "from-yellow-400/20 to-yellow-600/0" : "from-orange-500/10 to-transparent",
        platformColor: "text-orange-400 bg-orange-400/10",
        unlockedCount: g.unlocked_achievements,
        totalCount: g.total_achievements,
        consoleName: g.console_name
      }));

      // 3. Fetch Xbox
      const xboxResponse = await fetch(`/api/xbox/games${force ? "?refresh=true" : ""}`);
      if (xboxResponse.status === 401) {
        setXboxStatus("expired");
      } else if (xboxResponse.ok) {
        setXboxStatus("ok");
      }

      const xboxData = await xboxResponse.json();
      const xbGames = Array.isArray(xboxData) ? xboxData : (xboxData.games || []);
      if (xboxData.notifications) processIncomingNotifications(xboxData.notifications);

      const xboxGamesConverted: Game[] = xbGames.map((g: any) => ({
        id: `xbox-${g.id}`,
        appid: g.id,
        title: g.name,
        platform: "Xbox",
        completion: g.completion_rate,
        playtime: g.last_played ? `Utoljára: ${new Date(g.last_played).toLocaleDateString()}` : "Xbox Live",
        icon: g.icon_url || "https://images.unsplash.com/photo-1621252179027-9c445cb08041?q=80&w=300&h=450&auto=format&fit=crop",
        color: g.completion_rate === 100 ? "from-yellow-400/20 to-yellow-600/0" : "from-green-500/10 to-transparent",
        platformColor: "text-green-400 bg-green-400/10",
        unlockedCount: g.unlocked_achievements,
        totalCount: g.total_achievements,
        scid: g.scid
      }));

      // 4. Fetch RPCS3
      let rpcs3GamesConverted: Game[] = [];
      try {
        const rpcs3Response = await fetch("/api/rpcs3/games");
        const rpcs3Data = await rpcs3Response.json();
        const rpGames = Array.isArray(rpcs3Data) ? rpcs3Data : (rpcs3Data.games || []);
        if (rpcs3Data.notifications) processIncomingNotifications(rpcs3Data.notifications);

        rpcs3GamesConverted = rpGames.map((g: any) => ({
          id: `rpcs3-${g.id}`,
          appid: g.id,
          title: g.name,
          platform: "PS3",
          completion: g.completion_rate,
          playtime: "Helyi trófeaszerver",
          icon: g.icon_url || "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&h=450&fit=crop&q=40",
          color: g.completion_rate === 100 ? "from-yellow-400/20 to-yellow-600/0" : "from-blue-500/10 to-transparent",
          platformColor: "text-blue-400 bg-blue-400/10",
          unlockedCount: g.unlocked_achievements,
          totalCount: g.total_achievements
        }));
      } catch (e) {
        console.warn("RPCS3 sync failed:", e);
      }
      
      // 5. Fetch Goldberg
      let goldbergGamesConverted: Game[] = [];
      try {
        const goldbergResponse = await fetch("/api/goldberg/games");
        const goldbergData = await goldbergResponse.json();
        const goldGames = Array.isArray(goldbergData) ? goldbergData : (goldbergData.games || []);
        if (goldbergData.notifications) processIncomingNotifications(goldbergData.notifications);

        goldbergGamesConverted = goldGames.map((g: any) => ({
          id: `goldberg-${g.id}`,
          appid: g.id,
          title: g.name,
          platform: "Goldberg",
          completion: g.completion_rate,
          playtime: "Helyi Steam Emulátor",
          icon: g.icon_url,
          headerImage: g.header_image,
          cover_url: g.cover_url,
          color: g.completion_rate === 100 ? "from-yellow-400/20 to-yellow-600/0" : "from-slate-500/10 to-transparent",
          platformColor: "text-slate-400 bg-slate-400/10",
          unlockedCount: g.unlocked_achievements,
          totalCount: g.total_achievements
        }));
      } catch (e) {
        console.warn("Goldberg sync failed:", e);
      }

      setGames(prev => {
        const otherGames = prev.filter(g => !g.id.startsWith("steam-") && !g.id.startsWith("ra-") && !g.id.startsWith("xbox-") && !g.id.startsWith("rpcs3-") && !g.id.startsWith("goldberg-"));
        return [...otherGames, ...steamGamesConverted, ...raGamesConverted, ...xboxGamesConverted, ...rpcs3GamesConverted, ...goldbergGamesConverted];
      });
    } catch (error) {
      console.error("Hiba a szinkronizáláskor:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  const getSteamHeaderUrl = useCallback((appId: string | number, apiCoverUrl?: string, useProxy = true, platform?: string) => {
    let finalUrl = "";
    const cleanAppId = getCleanId(appId);
    
    if (apiCoverUrl) {
      finalUrl = apiCoverUrl;
    } else {
      finalUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${cleanAppId}/header.jpg`;
    }
    
    if (!useProxy) return finalUrl;
    return `/api/proxy-image?url=${encodeURIComponent(finalUrl)}&appid=${cleanAppId}${platform ? `&platform=${platform}` : ''}`;
  }, []);

  const getImageSource = useCallback((game: Game | null, type: 'icon' | 'header' | 'achievement', data?: any) => {
    if (!game) return "";
    const platform = (game.platform || "").toUpperCase();

    if (type === 'achievement') {
      if (platform === 'RETROACHIEVEMENTS') {
        // Direct pass, no proxy, no modifications. RetroAchievements URLs are reliable.
        return data?.icon_url || `https://api.dicebear.com/7.x/identicon/svg?seed=${data?.api_id}`;
      }
      if (platform === 'STEAM' || platform === 'GOLDBERG') {
        // Use proxy for achievements as they are usually small and often on different CDN subdomains
        return getSteamImageUrl(game.id, data?.original_hash || data?.icon_url, true);
      }
      return data?.icon_url || `https://api.dicebear.com/7.x/identicon/svg?seed=${data?.api_id}`;
    }

    if (type === 'header') {
      if (platform === 'RETROACHIEVEMENTS') {
        // Direct pass for RA header (typically icon)
        return game.icon || "";
      }
      if (platform === 'STEAM' || platform === 'GOLDBERG') {
        // Use proxy for Steam and Goldberg for banner images
        return `/api/proxy-image?appid=${encodeURIComponent(getCleanId(game.id))}&platform=${platform}`;
      }
      // For all other platforms, return original icon/image URL directly
      return game.icon || "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&h=450&fit=crop&q=40";
    }

    // Default icon (Library view)
    if (platform === 'RETROACHIEVEMENTS') return game.icon || "";
    
    if (platform === 'STEAM' || platform === 'GOLDBERG') {
      const cleanId = getCleanId(game.id);
      // Fallback logic: prefer explicit cover_url if provided in the object, otherwise go for library_600x900
      const libUrl = (platform === 'GOLDBERG' ? undefined : game.cover_url) || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${cleanId}/library_600x900.jpg`;
      
      // Use proxy even for library view to avoid CORS issues as requested
      return `/api/proxy-image?url=${encodeURIComponent(libUrl)}&appid=${cleanId}&platform=${platform}`;
    }
    
    return game.icon || "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&h=450&fit=crop&q=40";
  }, [getSteamImageUrl, getSteamHeaderUrl]);

  const fetchAchievements = async (game: Game) => {
    if (isAchLoading) return;
    setIsAchLoading(true);
    setAchievements([]);
    setSelectedGame(game);
    try {
      let endpoint = "";
      if (game.platform === "Steam") {
        endpoint = `/api/steam/achievements/${game.appid}`;
      } else if (game.platform === "RetroAchievements") {
        endpoint = `/api/ra/achievements/${game.appid}`;
      } else if (game.platform === "Xbox") {
        endpoint = `/api/xbox/achievements/${game.scid}/${game.appid}`;
      } else if (game.platform === "PS3") {
        endpoint = `/api/rpcs3/achievements/${game.appid}`;
      } else if (game.platform === "Goldberg") {
        endpoint = `/api/goldberg/achievements/${game.appid}`;
      }
      
      const response = await fetch(endpoint);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Szerver hiba (${response.status}): ${errorText.substring(0, 100)}`);
      }
      
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error("A szerver nem JSON választ küldött. Valószínűleg lejárt a munkamenet vagy hálózati hiba történt.");
      }

      const data = await response.json();
      setAchievements(data);

      // Recalculate stats from the achievement list (RA & Xbox)
      if ((game.platform === "RetroAchievements" || game.platform === "Xbox" || game.platform === "PS3" || game.platform === "Goldberg") && data.length > 0) {
        const unlocked = data.filter((a: any) => a.is_unlocked).length;
        const total = data.length;
        const rate = Math.round((unlocked / total) * 100);
        
        setGames(prev => prev.map(g => g.id === game.id ? { 
          ...g, 
          completion: rate, 
          unlockedCount: unlocked, 
          totalCount: total,
          color: rate === 100 ? "from-yellow-400/20 to-yellow-600/0" : g.color
        } : g));
        
        setSelectedGame(prev => prev ? { 
          ...prev, 
          completion: rate, 
          unlockedCount: unlocked, 
          totalCount: total 
        } : null);
      }
    } catch (error) {
      console.error("Hiba az achievementek lekérésekor:", error);
    } finally {
      setIsAchLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setSaveStatus("saving");
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          steamApiKey, 
          steamId, 
          raUsername, 
          raApiKey, 
          xboxXuid, 
          xboxAuthHeader, 
          rpcs3Path,
          goldbergPath,
          sounds: raritySounds,
          notificationScale
        })
      });
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 2000);
      syncGames(true); // Re-fetch after save
    } catch (error) {
      console.error("Save error:", error);
      setSaveStatus("idle");
    }
  };

  useEffect(() => {
    if (games.length === 0 && !isSyncing) {
      syncGames();
    }
  }, []);

  const triggerTestNotification = (rarity: string = "common") => {
    const id = Date.now();
    const rarities = {
      common: { title: "New Achievement", desc: "You've made progress!", color: "white" },
      rare: { title: "Rare Achievement", desc: "Impressive skills!", color: "blue" },
      ultrarare: { title: "Ultra Rare Achievement", desc: "A true master!", color: "gold" },
      platinum: { title: "Platinum Trophy", desc: "Ultimate Mastery 100%", color: "cyan" }
    };
    
    const configData = (rarities as any)[rarity];

    const newNotification = {
      id,
      title: configData.title,
      description: configData.desc,
      rarity: rarity,
      gameIcon: selectedGame?.icon || "https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?w=100&h=100&fit=crop",
      gameTitle: selectedGame?.title || "Universal Hub"
    };

    setNotifications(prev => [...prev, newNotification]);
    
    // Test Sound
    const soundUrl = getAudioUrl(rarity);
    const audio = new Audio(soundUrl);
    audio.volume = notificationVolume / 100;
    audio.play().catch(() => {});

    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, notificationDuration * 1000);
  };

  const handleSoundUpload = (rarity: string, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setRaritySounds(prev => ({ ...prev, [rarity]: base64 }));
    };
    reader.readAsDataURL(file);
  };

  const playSoundPreview = (rarity: string) => {
    const soundUrl = getAudioUrl(rarity);
    const audio = new Audio(soundUrl);
    audio.volume = notificationVolume / 100;
    audio.play().catch(() => {});
  };

  const replayNotification = (ach: Achievement, game: Game) => {
    const id = Date.now();
    
    // Simple rarity logic: if it's the last one or marked somehow? 
    // Usually we don't have rarity in the achievement object yet, default to rare.
    // However, if the title looks like a 100% completion, we could trigger platinum.
    const rarity = "rare"; 
    
    const newNotification = {
      id,
      title: ach.title,
      description: ach.description,
      rarity: rarity,
      gameIcon: ach.icon_url || game.icon,
      gameTitle: game.title,
      platformLabel: game.platform === "PS3" ? "Trophy Earned" : "Achievement Unlocked"
    };

    setNotifications(prev => [...prev, newNotification]);
    
    const soundUrl = getAudioUrl(rarity);
    const audio = new Audio(soundUrl);
    audio.volume = notificationVolume / 100;
    audio.play().catch(() => {});

    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, notificationDuration * 1000);
  };

  const handleDebugTest = async () => {
    if (!testAppId || !testJsonContent) {
      alert("Kérlek adj meg egy AppID-t és tölts fel egy JSON fájlt!");
      return;
    }

    setIsDebugProcessing(true);
    setIsMapping(true);
    try {
      const response = await fetch("/api/debug/process-goldberg-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: testAppId, achievementsJson: testJsonContent })
      });
      const data = await response.json();
      
      if (data.error) throw new Error(data.error);

      // Log the results in batch
      const logs: {msg: string}[] = [];
      const cleanAppId = getCleanId(testAppId);
      data.achievements.forEach((ach: any) => {
        const finalUrl = getSteamImageUrl(cleanAppId, ach.original_hash || ach.icon_url);
        logs.push({ msg: `ID: ${ach.api_id}` });
        logs.push({ msg: `  [ORIGINAL HASH]: ${ach.original_hash}` });
        logs.push({ msg: `  [GENERATED URL]: ${finalUrl}` });
      });
      addLogs(logs);

      // Create a virtual game to show the result
      const virtualGame: Game = {
        id: `debug-${testAppId}`,
        appid: testAppId,
        title: `[TEST] ${data.gameName}`,
        platform: "Goldberg",
        completion: data.achievements.length > 0 ? Math.round((data.achievements.filter((a: any) => a.is_unlocked).length / data.achievements.length) * 100) : 0,
        playtime: "Sandbox Teszt",
        icon: data.icon,
        color: "from-pink-500/20 to-transparent",
        platformColor: "text-pink-400 bg-pink-400/10",
        unlockedCount: data.achievements.filter((a: any) => a.is_unlocked).length,
        totalCount: data.achievements.length
      };

      setGames(prev => [virtualGame, ...prev.filter(g => g.id !== virtualGame.id)]);
      setAchievements(data.achievements);
      setSelectedGame(virtualGame);
      setActiveTab("recent"); // Go back to show it
      
    } catch (error: any) {
      console.error("Debug failed:", error);
      alert("Hiba: " + error.message);
    } finally {
      setIsDebugProcessing(false);
      setIsMapping(false);
    }
  };

  const handleTestFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setTestJsonContent(event.target?.result as string);
    };
    reader.readAsText(file);
  };

  // Szűrési logika
  const filteredGames = useMemo(() => {
    let result = games;

    // Kategória szűrés
    if (activeTab === "completed") {
      result = result.filter(g => g.completion === 100);
    } else if (activeTab === "steam") {
      result = result.filter(g => g.platform === "Steam");
    } else if (activeTab === "retroachievements") {
      result = result.filter(g => g.platform === "RetroAchievements");
    } else if (activeTab === "xbox") {
      result = result.filter(g => g.platform === "Xbox");
    } else if (activeTab === "rpcs3") {
      result = result.filter(g => g.platform === "PS3");
    } else if (activeTab === "goldberg" || activeTab === "steam") {
      result = result.filter(g => g.platform === "Steam" || g.platform === "Goldberg");
    }

    // Keresés szűrés
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(g => 
        g.title.toLowerCase().includes(query) || 
        g.platform.toLowerCase().includes(query)
      );
    }

    return result;
  }, [games, activeTab, searchQuery]);

  const NavItem = ({ id, icon: Icon, label }: { id: string, icon: any, label: string }) => (
    <button
      onClick={() => {
        setActiveTab(id);
        setIsSidebarOpen(false);
        setSelectedGame(null);
      }}
      className={`relative w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
        activeTab === id 
        ? "bg-indigo-500/10 text-indigo-400 font-medium" 
        : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
      }`}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <span className="truncate">{label}</span>
      {activeTab === id && (
        <motion.div 
          layoutId="activeIndicator"
          className="absolute left-0 w-1 h-8 bg-indigo-500 rounded-r-full" 
        />
      )}
    </button>
  );

  const sortedAchievements = useMemo(() => {
    return [...achievements].sort((a, b) => Number(b.is_unlocked) - Number(a.is_unlocked));
  }, [achievements]);

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-slate-200 font-sans selection:bg-indigo-500/30 flex flex-col md:flex-row">
      
      {/* Mobile Top Bar */}
      <div className="md:hidden flex items-center justify-between p-4 bg-[#0A0A0F]/80 backdrop-blur-md border-b border-slate-800/50 sticky top-0 z-30">
        <h1 className="text-lg font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
          <Trophy className="w-5 h-5 text-indigo-400" />
          Achievement Hub
        </h1>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 text-slate-400 hover:text-white"
        >
          {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Sidebar Overlay for Mobile */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 w-64 border-r border-slate-800/50 bg-[#0A0A0F] md:bg-[#0A0A0F]/50 md:backdrop-blur-xl 
        flex flex-col z-50 transition-transform duration-300 transform
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0 md:static md:h-screen
      `}>
        <div className="p-6 hidden md:block">
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Trophy className="w-6 h-6 text-indigo-400" />
            Universal Hub
          </h1>
        </div>

        <div className="p-6 md:hidden flex justify-between items-center border-b border-slate-800/50 mb-4">
           <h1 className="text-xl font-bold text-white">Navigáció</h1>
           <button onClick={() => setIsSidebarOpen(false)}><X className="w-6 h-6" /></button>
        </div>
        
        <div className="px-3 py-2 flex-1 space-y-1 overflow-y-auto">
          <p className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Kategóriák</p>
          <NavItem id="recent" icon={Clock} label="Mostanában játszott" />
          <NavItem id="platforms" icon={Layers} label="Platformok szerint" />
          <NavItem id="completed" icon={CheckCircle2} label="100% Teljesített" />
          
          <div className="pt-6 pb-2">
            <p className="px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Rendszerek</p>
            <NavItem id="steam" icon={Gamepad2} label="Steam / Goldberg" />
            <NavItem id="xbox" icon={Gamepad2} label="Xbox Live" />
            <NavItem id="rpcs3" icon={Gamepad2} label="RPCS3 Emulátor" />
            <NavItem id="retroachievements" icon={Gamepad2} label="RetroAchievements" />
          </div>
        </div>

        <div className="p-4 border-t border-slate-800/50">
          <NavItem id="settings" icon={Settings} label="Beállítások" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 relative w-full overflow-x-hidden">
        <div className="max-w-6xl mx-auto space-y-6 md:space-y-8">
          
          {/* Header */}
          <header className="flex flex-col md:flex-row gap-4 md:justify-between md:items-center">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                  {activeTab === 'recent' && "Folyamatban lévő kalandok"}
                  {activeTab === 'completed' && "Tökéletesített Játékok (100%)"}
                  {activeTab === 'platforms' && "Kollekció Platformonként"}
                  {activeTab === 'steam' && "Steam & Goldberg Emulátor"}
                  {activeTab === 'xbox' && "Xbox Eredmények"}
                  {activeTab === 'rpcs3' && "PlayStation 3 (RPCS3)"}
                  {activeTab === 'retroachievements' && "RetroAchievements Kollekció"}
                  {activeTab === 'settings' && "Hub Beállítások"}
                </h2>
                <button 
                  onClick={() => syncGames(true)}
                  disabled={isSyncing}
                  className="p-2 text-slate-500 hover:text-indigo-400 transition-colors disabled:opacity-50 flex items-center gap-2"
                  title="Mélyszinkronizálás indítása"
                >
                  <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} onClick={() => syncGames(true)} />
                  {isSyncing && <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 animate-pulse hidden md:inline">Mélyszinkronizálás...</span>}
                </button>
              </div>
              <p className="text-slate-400 text-sm">
                 Itt találod a legfrissebb achievementjeidet minden platformról.
              </p>
            </div>

            <div className="relative w-full md:w-auto">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Keresés..." 
                className="bg-slate-900 border border-slate-800 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all w-full md:w-64 text-white"
              />
            </div>
          </header>

          {/* Stats Bar */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4"
          >
            {[
              { 
                label: "Trófeák", 
                value: games.reduce((acc, g) => acc + (g.unlockedCount || 0), 0).toLocaleString(), 
                color: "text-indigo-400" 
              },
              { label: "100%", value: games.filter(g => g.completion === 100).length, color: "text-yellow-400" },
              { 
                label: "Platform", 
                value: new Set(games.map(g => g.platform)).size, 
                color: "text-emerald-400" 
              },
              { label: "Találat", value: filteredGames.length, color: "text-pink-400" }
            ].map((stat, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 md:p-5 flex flex-col justify-center">
                <span className="text-slate-500 text-xs md:text-sm font-medium mb-1">{stat.label}</span>
                <span className={`text-xl md:text-2xl font-bold tracking-tight ${stat.color}`}>{stat.value}</span>
              </div>
            ))}
          </motion.div>

          {/* Grid or Settings */}
          {activeTab === 'settings' ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6"
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400 ml-1">Steam Web API Key</label>
                  <input 
                    type="password"
                    value={steamApiKey}
                    onChange={(e) => setSteamApiKey(e.target.value)}
                    placeholder="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
                  />
                  <p className="text-[10px] text-slate-500 ml-1">
                    Kulcs igénylése: <a href="https://steamcommunity.com/dev/apikey" target="_blank" className="text-indigo-400 hover:underline">steamcommunity.com/dev/apikey</a>
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400 ml-1">Steam ID (64-bit)</label>
                  <input 
                    type="text"
                    value={steamId}
                    onChange={(e) => setSteamId(e.target.value)}
                    placeholder="7656119XXXXXXXXXX"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
                  />
                </div>

                <div className="pt-4 pb-2 flex items-center justify-between">
                   <h4 className="text-sm font-black text-white uppercase tracking-widest border-l-2 border-green-500 pl-3">Xbox Live</h4>
                   <button 
                    onClick={() => setShowXboxHelper(!showXboxHelper)}
                    className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-500/10 px-2 py-1 rounded"
                   >
                     {showXboxHelper ? "Bezárás" : "Xbox Setup Segéd"}
                   </button>
                </div>

                <AnimatePresence>
                  {showXboxHelper && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl mb-4 space-y-2">
                        <p className="text-xs font-bold text-indigo-400 uppercase tracking-tighter">Token megszerzése:</p>
                        <ol className="text-xs text-slate-400 list-decimal pl-4 space-y-2 leading-relaxed">
                          <li>Jelentkezz be az <a href="https://www.xbox.com/hu-HU" target="_blank" className="text-white underline">xbox.com</a> oldalon.</li>
                          <li>Nyomd meg az <kbd className="bg-slate-800 px-1 rounded text-white">F12</kbd> (Fejlesztői eszközök) gombot.</li>
                          <li>Válaszd a <b className="text-white">Network (Hálózat)</b> fület.</li>
                          <li>Frissítsd az oldalt, majd a keresőbe írd be: <code className="text-white">achievements</code></li>
                          <li>Kattints az egyik találatra, és a <b className="text-white">Headers (Fejlécek)</b> fülön keresd meg az <b className="text-white">Authorization</b> részt.</li>
                          <li>Másold ki a teljes értéket (<code className="text-green-400">XBL3.0 x=...</code>) és az <b className="text-white">XUID</b>-odat!</li>
                        </ol>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400 ml-1 flex items-center justify-between">
                      Xbox XUID
                      <span className="text-[9px] text-slate-600 font-mono italic">Példa: 2533274XXXXXXXX</span>
                    </label>
                    <input 
                      type="text"
                      value={xboxXuid}
                      onChange={(e) => setXboxXuid(e.target.value)}
                      placeholder="Xbox User ID"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400 ml-1">Authorization Header (XBL3.0)</label>
                    <textarea 
                      value={xboxAuthHeader}
                      onChange={(e) => setXboxAuthHeader(e.target.value)}
                      placeholder="XBL3.0 x=userhash;token..."
                      rows={3}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono text-xs resize-none"
                    />
                    {xboxStatus === 'expired' && (
                      <p className="text-[10px] text-red-400 flex items-center gap-1 ml-1 animate-pulse">
                        <X className="w-3 h-3" /> Token lejárt, kérlek frissítsd!
                      </p>
                    )}
                  </div>
                </div>

                <div className="pt-4 pb-2">
                   <h4 className="text-sm font-black text-white uppercase tracking-widest border-l-2 border-indigo-500 pl-3">RetroAchievements</h4>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400 ml-1">Username</label>
                  <input 
                    type="text"
                    value={raUsername}
                    onChange={(e) => setRaUsername(e.target.value)}
                    placeholder="RetroUser"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400 ml-1">Web API Key</label>
                  <input 
                    type="password"
                    value={raApiKey}
                    onChange={(e) => setRaApiKey(e.target.value)}
                    placeholder="xxxxxxxxxxxxxxxx"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
                  />
                  <p className="text-[10px] text-slate-500 ml-1">
                    Kulcs igénylése: <a href="https://retroachievements.org/settings" target="_blank" className="text-indigo-400 hover:underline">retroachievements.org/settings</a> (Control Panel)
                  </p>
                </div>

                <div className="pt-4 pb-2">
                   <h4 className="text-sm font-black text-white uppercase tracking-widest border-l-2 border-blue-500 pl-3">RPCS3 Emulator</h4>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400 ml-1">RPCS3 Root Folder Path</label>
                    <input 
                      type="text"
                      value={rpcs3Path}
                      onChange={(e) => setRpcs3Path(e.target.value)}
                      placeholder="E:\Emulators\RPCS3"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
                    />
                    <p className="text-[10px] text-slate-500 ml-1">
                      Add meg az elérési utat, ahol az rpcs3.exe található. A kód automatikusan keresni fogja a <code className="text-blue-400">dev_hdd0/home/00000001/trophy</code> mappát.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-400 ml-1">Goldberg Emulator Saves Path</label>
                    <input 
                      type="text"
                      value={goldbergPath}
                      onChange={(e) => setGoldbergPath(e.target.value)}
                      placeholder="C:\Users\Admin\AppData\Roaming\Goldberg SteamEmu Saves\settings"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500/50 transition-all font-mono"
                    />
                    <p className="text-[10px] text-slate-500 ml-1">
                      Add meg az utat a Goldberg mentési beállításaihoz. Itt találhatók az AppID-vel elnevezett mappák az achievements.json-ökkel.
                    </p>
                  </div>
                </div>

                <div className="pt-8 pb-2">
                   <h4 className="text-sm font-black text-white uppercase tracking-widest border-l-2 border-pink-500 pl-3">Sandbox / Debug (Tesztkörnyezet)</h4>
                </div>
                
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Steam AppID (pl. 990080)</label>
                    <input 
                      type="text"
                      value={testAppId}
                      onChange={(e) => setTestAppId(e.target.value)}
                      placeholder="990080 (Hogwarts Legacy)"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-pink-500/50 transition-all font-mono"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase font-bold text-slate-500 ml-1">Achievements.json feltöltése</label>
                    <div className="flex items-center gap-3">
                      <label className="flex-1 cursor-pointer bg-slate-900 hover:bg-slate-800 border-2 border-dashed border-slate-800 hover:border-pink-500/50 rounded-xl py-6 flex flex-col items-center justify-center transition-all group">
                         <Upload className={`w-6 h-6 mb-2 ${testJsonContent ? 'text-pink-400' : 'text-slate-600'}`} />
                         <span className="text-xs text-slate-400 group-hover:text-slate-200">
                           {testJsonContent ? "Fájl betöltve (Kattints a cseréhez)" : "Húzd ide vagy kattints a feltöltéshez"}
                         </span>
                         <input type="file" accept=".json" className="hidden" onChange={handleTestFileUpload} />
                      </label>
                    </div>
                  </div>

                  <button 
                    onClick={handleDebugTest}
                    disabled={isDebugProcessing || !testAppId || !testJsonContent}
                    className="w-full py-3 bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 border border-pink-500/20 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    {isDebugProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Metaadat Társítás Futtatása (Sandbox)
                  </button>
                  
                  <p className="text-[9px] text-slate-600 italic text-center">
                    Ez a funkció lehetővé teszi a Steam API és a Goldberg JSON párosításának tesztelését anélkül, hogy ténylegesen telepítve lenne a játék.
                  </p>
                </div>

                {debugLogs.length > 0 && (
                  <div className="pt-6">
                    <div className="flex items-center justify-between mb-2">
                       <h4 className="text-[10px] uppercase font-black text-white/40 tracking-widest pl-3 flex items-center gap-2">
                         <Terminal className="w-3 h-3" /> Image Load Debugger
                       </h4>
                       <button onClick={() => setDebugLogs([])} className="text-[9px] text-slate-600 hover:text-slate-400 uppercase tracking-tighter">Clear</button>
                    </div>
                    <div className="bg-black/40 border border-slate-800 rounded-xl p-3 h-40 overflow-y-auto font-mono text-[10px] space-y-1">
                      {debugLogs.map((log, i) => (
                        <div key={i} className={`${log.type === 'error' ? 'text-red-400' : 'text-slate-400'}`}>
                          {log.msg}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-8 pb-4">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-indigo-400" />
                    Értesítési Beállítások (Overlay)
                  </h3>
                  <div className="h-px bg-slate-800 mt-2"></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="text-sm font-medium text-slate-400">Megjelenítés Pozíciója</label>
                    <div className="grid grid-cols-3 gap-2 w-32">
                      {["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"].map(pos => (
                        <button
                          key={pos}
                          onClick={() => setOverlayPosition(pos)}
                          className={`aspect-square rounded border transition-all ${overlayPosition === pos ? 'bg-indigo-500 border-indigo-400' : 'bg-slate-800 border-slate-700 hover:border-slate-500'}`}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-500">Itt fog felugrani az értesítés ha sikert érsz el.</p>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <label className="text-sm font-medium text-slate-400">Hangerő</label>
                        <span className="text-xs font-mono text-indigo-400">{notificationVolume}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" max="100" 
                        value={notificationVolume}
                        onChange={(e) => setNotificationVolume(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <label className="text-sm font-medium text-slate-400">Megjelenítési idő</label>
                        <span className="text-xs font-mono text-indigo-400">{notificationDuration}s</span>
                      </div>
                      <input 
                        type="range" 
                        min="2" max="15" 
                        value={notificationDuration}
                        onChange={(e) => setNotificationDuration(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                      />
                    </div>

                    <div className="space-y-4 pt-2">
                       <div className="space-y-3">
                        <div className="flex justify-between">
                          <label className="text-sm font-medium text-slate-400">Értesítés mérete (Scale)</label>
                          <span className="text-xs font-mono text-indigo-400">{Math.round(notificationScale * 100)}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0.5" max="1.5" step="0.05"
                          value={notificationScale}
                          onChange={(e) => setNotificationScale(parseFloat(e.target.value))}
                          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                        />
                      </div>
                       <label className="text-sm font-medium text-slate-400 block pb-1 border-b border-slate-800">Egyedi Hangok (Raritás szerint)</label>
                       <div className="space-y-3">
                        {[
                          { id: 'common', label: 'Common', color: 'border-slate-500/50' },
                          { id: 'rare', label: 'Rare', color: 'border-blue-500/50' },
                          { id: 'ultrarare', label: 'Ultra Rare', color: 'border-yellow-500/50' },
                          { id: 'platinum', label: 'Diamond / 100%', color: 'border-cyan-500/50' },
                        ].map((r) => (
                          <div key={r.id} className={`flex items-center gap-3 p-2 rounded-xl bg-slate-950 border ${r.color}`}>
                            <div className="flex-1">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 ml-1 mb-1">{r.label}</p>
                              <div className="flex items-center gap-2">
                                <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-200 transition-colors flex items-center gap-2">
                                  <Upload className="w-3 h-3" />
                                  KIFÁLASZTÁS
                                  <input 
                                    type="file" 
                                    accept=".mp3,.wav,.ogg" 
                                    className="hidden" 
                                    onChange={(e) => handleSoundUpload(r.id, e)} 
                                  />
                                </label>
                                {raritySounds[r.id] && (
                                  <span className="text-[9px] text-emerald-400 font-mono italic">Feltöltve</span>
                                )}
                              </div>
                            </div>
                            <button 
                              onClick={() => playSoundPreview(r.id)}
                              className="p-2.5 rounded-full bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all shadow-lg active:scale-90"
                            >
                              <Play className="w-4 h-4 fill-current" />
                            </button>
                          </div>
                        ))}
                       </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-4">
                   {["common", "rare", "ultrarare", "platinum"].map(r => (
                     <button
                       key={r}
                       onClick={() => triggerTestNotification(r)}
                       className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold uppercase tracking-wider text-slate-300 transition-all active:scale-95 border border-slate-700"
                     >
                       Teszt ({r})
                     </button>
                   ))}
                </div>
              </div>

              <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/10">
                <p className="text-xs text-slate-400 mb-4 font-bold text-center uppercase tracking-widest italic">Élő Előnézet (Húzd a csúszkát!)</p>
                <div className="flex justify-center items-center h-24 overflow-hidden relative">
                   <div style={{ transform: `scale(${notificationScale})`, transformOrigin: 'center' }}>
                      <div className="glass-panel rounded-full px-6 py-4 flex items-center gap-4 min-w-[300px] border border-white/20">
                        <div className="w-10 h-10 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
                           <Trophy className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 text-left">
                           <p className="text-[8px] font-black uppercase text-white/40 mb-0.5">Teszt Játék</p>
                           <h4 className="text-xs font-bold text-white">Achievement Feloldva!</h4>
                        </div>
                      </div>
                   </div>
                </div>
              </div>

              <button 
                onClick={handleSaveConfig}
                disabled={saveStatus !== 'idle'}
                className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {saveStatus === 'saving' ? <RefreshCw className="w-5 h-5 animate-spin" /> : 
                 saveStatus === 'success' ? <CheckCircle2 className="w-5 h-5" /> : 
                 "Beállítások Mentése & Frissítés"}
              </button>

              <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/10">
                <p className="text-xs text-slate-400 leading-relaxed">
                  <b className="text-indigo-400">Megjegyzés:</b> Az adatok mentése után a Hub automatikusan megpróbálja leszinkronizálni az összes játékodat. Első alkalommal ez több másodpercet is igénybe vehet a Steam könyvtár méretétől függően. Akár több száz játékot is támogatunk!
                </p>
              </div>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 pt-2 md:pt-4">
              <AnimatePresence mode="popLayout">
                {filteredGames.map((game, i) => (
                  <motion.div
                    key={game.id}
                    layout
                    onClick={() => fetchAchievements(game)}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2, delay: (Math.min(i, 20)) * 0.05 }}
                    className="group relative bg-slate-900 border border-slate-800/80 rounded-2xl overflow-hidden hover:border-slate-700 transition-colors"
                  >
                    {/* Background Gradient */}
                    <div className={`absolute inset-0 opacity-20 bg-gradient-to-br ${game.color} transition-opacity group-hover:opacity-40`} />
                    
                    <div className="p-5 md:p-6 relative z-10">
                        <div className="relative w-full mb-4 group/img">
                            <img 
                              src={getImageSource(game, 'icon')} 
                              alt={game.title}
                              className="w-full h-auto rounded-xl object-cover ring-2 ring-slate-800 bg-slate-800 shadow-lg border border-slate-700/50 transition-transform group-hover:scale-[1.02]"
                              crossOrigin={['RetroAchievements', 'Steam', 'Goldberg'].includes(game.platform) ? undefined : "anonymous"}
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&h=450&fit=crop&q=40";
                              }}
                            />
                            
                            {/* Platform Badge Overlay */}
                            <div className="absolute top-2 left-2">
                              <span className={`text-[10px] md:text-xs px-2 md:px-2.5 py-1 rounded-full font-bold tracking-wide uppercase shadow-lg backdrop-blur-sm bg-slate-900/40 border border-white/5 ${game.platformColor} ${game.platform === 'Xbox' && xboxStatus === 'expired' ? 'bg-red-500/80 text-white animate-pulse' : ''}`}>
                                {game.platform === "RetroAchievements" && game.consoleName ? game.consoleName : (game.platform === 'Xbox' && xboxStatus === 'expired' ? 'Token lejárt' : game.platform)}
                              </span>
                            </div>

                            {game.completion === 100 && (
                              <div className="absolute -top-3 -right-3 bg-yellow-400 text-slate-900 p-1.5 rounded-full shadow-lg ring-2 ring-slate-900 z-20">
                                <Trophy className="w-3 h-3 md:w-4 md:h-4" />
                              </div>
                            )}
                        </div>

                      <div>
                        <h3 className="text-lg md:text-xl font-bold text-slate-100 mb-1 truncate leading-tight">{game.title}</h3>
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-xs md:text-sm text-slate-400 flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5" />
                            {game.playtime}
                          </p>
                          {game.totalCount && (
                            <span className="text-[10px] font-mono text-slate-500">
                             {game.unlockedCount}/{game.totalCount}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs md:text-sm">
                          <span className="text-slate-300 font-semibold">{game.completion}%</span>
                          <span className="text-slate-500 font-medium">Progress</span>
                        </div>
                        <div className="h-1.5 md:h-2 bg-slate-800 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${game.completion}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            className={`h-full rounded-full shadow-[0_0_8px_rgba(99,102,241,0.5)] ${game.completion === 100 ? 'bg-yellow-400 shadow-yellow-400/30' : 'bg-indigo-500'}`}
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {filteredGames.length === 0 && (
                <div className="col-span-full py-20 text-center space-y-4">
                  <div className="inline-flex p-4 rounded-full bg-slate-900 border border-slate-800 mb-2">
                    <Gamepad2 className="w-8 h-8 text-slate-600" />
                  </div>
                  <h3 className="text-xl font-medium text-slate-400">A könyvtárad jelenleg üres</h3>
                  <p className="text-slate-600 text-sm max-w-sm mx-auto">
                    Kérlek használd a jobb felső sarokban lévő szinkronizálás gombot, vagy állítsd be a Steam és RetroAchievements azonosítóidat a Beállítások menüben.
                  </p>
                </div>
              )}
            </div>
          )}
          
        </div>
      </main>

      {/* Achievement Details Overlay */}
      <AnimatePresence>
        {selectedGame && (
          <motion.div
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="fixed inset-0 bg-[#0A0A0F] z-[100] flex flex-col overflow-hidden"
          >
            {/* Compact Header Service Bar */}
            <div className="h-14 border-b border-slate-800/50 bg-[#0D0D14] flex items-center px-4 justify-between sticky top-0 z-20">
               <button 
                  onClick={() => setSelectedGame(null)}
                  className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors group"
                >
                  <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                  <span className="font-medium hidden md:inline">Vissza a könyvtárhoz</span>
                  <span className="font-medium md:hidden">Vissza</span>
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] uppercase font-black tracking-widest px-2 py-1 bg-indigo-500/10 text-indigo-400 rounded border border-indigo-500/20">
                    ID: {selectedGame.appid || "N/A"}
                  </span>
                </div>
            </div>

            {/* Game Banner Header */}
            <div className="relative w-full bg-[#0D0D14] border-b border-slate-800 shadow-2xl overflow-hidden shrink-0">
               <div className="absolute inset-0 opacity-10 blur-3xl scale-125 pointer-events-none">
                    <img 
                      src={getImageSource(selectedGame, 'header')} 
                      alt="" 
                      className="w-full h-full object-cover"
                      crossOrigin={['RetroAchievements', 'Steam', 'Goldberg'].includes(selectedGame.platform) ? undefined : "anonymous"}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&h=450&fit=crop&q=40";
                      }}
                    />
               </div>
               
               <div className="max-w-7xl mx-auto px-6 py-6 md:py-8 lg:px-12 relative z-10">
                  <div className="flex flex-col md:flex-row gap-6 items-center">
                    <div className="shrink-0 relative">
                      <img 
                        src={getImageSource(selectedGame, 'header')} 
                        alt={selectedGame.title}
                        className={`${(selectedGame.platform === 'Steam' || selectedGame.platform === 'Goldberg') ? 'w-[460px] h-[215px]' : 'w-24 h-36 md:w-28 md:h-40 lg:w-36 lg:h-52'} object-cover rounded-xl shadow-2xl ring-1 ring-slate-700/50 bg-slate-800 border border-white/10`}
                        crossOrigin={['RetroAchievements', 'Steam', 'Goldberg'].includes(selectedGame.platform) ? undefined : "anonymous"}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=300&h=450&fit=crop&q=80";
                        }}
                      />
                      {selectedGame.completion === 100 && (
                        <div className="absolute -top-2 -right-2 bg-yellow-400 text-slate-900 p-1.5 rounded-full shadow-xl ring-4 ring-[#0D0D14] z-10">
                          <Trophy className="w-4 h-4 text-slate-900 fill-slate-900" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 text-center md:text-left space-y-4">
                      <div>
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-1">
                          <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight">{selectedGame.title}</h2>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-tighter ${selectedGame.platformColor}`}>
                            {selectedGame.platform}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-slate-400">
                          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            <Clock className="w-3.5 h-3.5 text-indigo-400" />
                            {selectedGame.playtime}
                          </div>
                          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            <Trophy className="w-3.5 h-3.5 text-indigo-400" />
                            {selectedGame.unlockedCount || 0} / {selectedGame.totalCount || 0} Trófea
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col md:flex-row items-center gap-4 bg-black/20 p-3 rounded-2xl border border-white/5">
                        <div className="flex items-center gap-3 w-full max-w-sm">
                           <div className="flex-1 h-2 bg-slate-800/80 rounded-full overflow-hidden p-0.5">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${selectedGame.completion}%` }}
                                transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                                className={`h-full rounded-full shadow-[0_0_15px_rgba(99,102,241,0.5)] ${selectedGame.completion === 100 ? 'bg-yellow-400 shadow-yellow-400/30' : 'bg-indigo-500'}`}
                              />
                           </div>
                           <span className="text-sm font-black text-white tabular-nums w-10">{selectedGame.completion}%</span>
                        </div>
                        <div className="hidden md:block w-px h-6 bg-slate-800" />
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                           {selectedGame.completion === 100 ? "Mastered Library" : "In Progress"}
                        </div>
                      </div>

                      {(selectedGame.platform === 'Goldberg' || selectedGame.platform === 'Steam') && (
                        <div className="p-3 bg-black/40 rounded-xl border border-white/5 text-[10px] font-mono text-slate-400 leading-tight">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                            <span className="text-indigo-400 font-bold uppercase tracking-tighter">Debug Image Pipeline</span>
                          </div>
                          <p className="break-all opacity-80 mt-1">
                            <span className="text-slate-500">Source:</span> {selectedGame.cover_url ? 'Steam API (Legacy)' : selectedGame.headerImage ? 'Steam API (Resolved)' : 'Auto-generated Fallback'}
                          </p>
                          <p className="break-all mt-1">
                            <span className="text-slate-500">Attempting URL:</span> <span className="text-emerald-400/80">{getSteamHeaderUrl(selectedGame.id, (selectedGame.platform === 'Goldberg' ? undefined : (selectedGame.cover_url || selectedGame.headerImage)))}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
               </div>
            </div>

            {/* Achievement List Section */}
            <div className="flex-1 flex flex-col bg-[#0A0A0F] overflow-hidden">
               <div className="px-6 md:px-12 py-4 border-b border-slate-800/50 flex flex-col sm:flex-row gap-4 items-center justify-between bg-[#0A0A0F] z-10">
                  <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
                    Eredmények Listája
                    <span className="text-[10px] text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full">
                      {achievements.length}
                    </span>
                  </h3>
                  
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/50 rounded-lg border border-slate-800/50">
                       <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                       <span className="text-[10px] font-bold uppercase text-slate-400">Feloldva</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/50 rounded-lg border border-slate-800/50">
                       <div className="w-2 h-2 rounded-full bg-slate-700" />
                       <span className="text-[10px] font-bold uppercase text-slate-400">Zárolva</span>
                    </div>
                  </div>
               </div>

               <div className="flex-1 overflow-y-auto px-4 md:px-12 py-4 space-y-2.5 scrollbar-thin scrollbar-thumb-slate-800">
                {isAchLoading ? (
                  <div className="h-full flex flex-col items-center justify-center space-y-4 py-20">
                    <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin" />
                    <p className="text-slate-500 font-medium animate-pulse uppercase tracking-widest text-xs">Adatok lekérése a hálózatról...</p>
                  </div>
                ) : sortedAchievements.length > 0 ? (
                  sortedAchievements.map((ach, i) => (
                      <motion.div
                        key={ach.api_id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i, 30) * 0.015 }}
                        className={`group flex items-center gap-4 p-3 rounded-xl border transition-all duration-200 ${
                          ach.is_unlocked 
                          ? "bg-slate-900/30 border-slate-800/50 hover:bg-slate-900/60 hover:border-indigo-500/30" 
                          : "bg-black/10 border-slate-900/50 opacity-50 grayscale hover:grayscale-0 hover:opacity-100 hover:border-slate-800"
                        }`}
                      >
                         <div className="relative shrink-0">
                          <img 
                            src={getImageSource(selectedGame, 'achievement', ach)} 
                            alt={ach.title}
                            crossOrigin={selectedGame && ['RetroAchievements', 'Steam', 'Goldberg'].includes(selectedGame.platform) ? undefined : "anonymous"}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              console.error("❌ Kép betöltési hiba:", target.src);
                              target.src = "https://api.dicebear.com/7.x/identicon/svg?seed=" + ach.api_id;
                              addLog(`FAILED TO LOAD: ${target.src}`, 'error');
                            }}
                            className={`w-12 h-12 md:w-14 md:h-14 rounded-lg object-cover shadow-lg border ${
                              ach.is_unlocked ? "border-indigo-500/20" : "border-slate-800"
                            }`}
                          />
                          {!ach.is_unlocked && selectedGame?.platform !== 'Goldberg' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
                               <span className="text-slate-500 block">?</span>
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline gap-2">
                            <h4 className={`text-sm md:text-base font-bold truncate ${ach.is_unlocked ? "text-slate-100" : "text-slate-500"}`}>
                              {ach.title}
                            </h4>
                            {ach.is_unlocked && ach.unlock_time && (
                              <span className="text-[9px] font-bold text-slate-500 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-800 shrink-0">
                                {new Date(ach.unlock_time).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-1 mt-0.5 font-medium">
                            {ach.description || "Titkos vagy nem megadott eredmény."}
                          </p>
                        </div>

                        {ach.is_unlocked ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                replayNotification(ach, selectedGame!);
                              }}
                              className="p-1.5 opacity-0 group-hover:opacity-100 bg-slate-800 text-slate-400 hover:text-indigo-400 hover:bg-slate-700 rounded-lg transition-all"
                              title="Értesítés újrajátszása"
                            >
                              <Bell className="w-4 h-4" />
                            </button>
                            <div className="shrink-0 p-1.5 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
                               <CheckCircle2 className="w-4 h-4 text-indigo-400 shadow-indigo-500/50" />
                            </div>
                          </div>
                        ) : selectedGame?.platform !== 'Goldberg' ? (
                          <div className="shrink-0 p-1.5 bg-slate-900 rounded-lg border border-slate-800 opacity-20">
                             <Clock className="w-4 h-4 text-slate-600" />
                          </div>
                        ) : null}
                      </motion.div>
                    ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center space-y-4 py-20 text-center">
                    <div className="w-16 h-16 rounded-3xl bg-slate-900/50 border border-slate-800 flex items-center justify-center">
                      <Gamepad2 className="w-8 h-8 text-slate-600" />
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-slate-400">Üres Achievement Lista</h4>
                      <p className="text-sm text-slate-600 max-w-xs mx-auto">Ehhez a játékhoz nem tartoznak publikus eredmények a kiválasztott hálózaton.</p>
                    </div>
                  </div>
                )}
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* NOTIFICATION OVERLAY CONTAINER (Click-through) */}
      <div className={`fixed inset-0 z-[999] pointer-events-none flex p-8 ${
        overlayPosition.startsWith('top') ? 'items-start' : 
        overlayPosition.startsWith('middle') ? 'items-center' : 'items-end'
      } ${
        overlayPosition.endsWith('left') ? 'justify-start' : 
        overlayPosition.endsWith('center') ? 'justify-center' : 'justify-end'
      }`}>
        <div 
          className="space-y-4 flex flex-col items-center transition-all duration-300"
          style={{ 
            transform: `scale(${notificationScale})`,
            transformOrigin: overlayPosition.split('-').reverse().join(' ')
          }}
        >
          <AnimatePresence>
            {notifications.map((notif) => (
              <motion.div
                key={notif.id}
                initial={{ opacity: 0, scale: 0.8, y: overlayPosition.startsWith('top') ? -50 : 50 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: 100 }}
                className={`
                  pointer-events-auto relative glass-panel rounded-full px-6 py-4 flex items-center gap-4 min-w-[320px] max-w-[400px] overflow-hidden
                  rarity-glow-${notif.rarity}
                  ${notif.rarity === 'platinum' ? 'diamond-shimmer' : ''}
                `}
              >
                {/* Iridescent sweep for Platinum */}
                {notif.rarity === 'platinum' && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -skew-x-12 translate-x-[-100%] animate-[shimmer_2s_infinite]" />
                )}

                <div className="relative shrink-0">
                  <img 
                    src={notif.gameIcon} 
                    alt="" 
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 rounded-lg object-cover ring-1 ring-white/20 shadow-lg"
                  />
                  <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-slate-900 shadow-lg ${
                    notif.rarity === 'platinum' ? 'bg-cyan-400' : 
                    notif.rarity === 'ultrarare' ? 'bg-yellow-400' : 
                    notif.rarity === 'rare' ? 'bg-blue-500' : 'bg-white'
                  }`}>
                    <Trophy className="w-2.5 h-2.5 text-slate-900" />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40 mb-1 leading-none">{notif.gameTitle}</p>
                  <h4 className="text-sm font-bold text-white truncate leading-tight">{notif.title}</h4>
                  <p className="text-xs text-white/60 truncate">{notif.description}</p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function DesktopOverlay() {
  const [currentNotification, setCurrentNotification] = useState<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const checkNotifications = async () => {
      try {
        const res = await fetch('/api/latest-notification');
        const data = await res.json();
        if (data && (!currentNotification || data.id !== currentNotification.id)) {
          setCurrentNotification(data);
          setIsVisible(true);
          
          // Auto-hide after 5 seconds
          setTimeout(() => {
            setIsVisible(false);
          }, 5000);
        }
      } catch (e) {
        console.error("Overlay sync error:", e);
      }
    };

    const interval = setInterval(checkNotifications, 2000);
    return () => clearInterval(interval);
  }, [currentNotification]);

  if (!currentNotification || !isVisible) return null;

  return (
    <div className="fixed inset-0 flex items-start justify-end p-8 pointer-events-none select-none">
      <motion.div
        initial={{ x: 400, opacity: 0, scale: 0.8 }}
        animate={{ x: 0, opacity: 1, scale: 1 }}
        exit={{ x: 400, opacity: 0, scale: 0.8 }}
        transition={{ type: "spring", damping: 20, stiffness: 100 }}
        className="w-80 bg-[#0A0A0F]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden ring-1 ring-white/5"
      >
        <div className="relative p-4 flex gap-4 items-center">
          <div className={`absolute inset-0 bg-gradient-to-r ${currentNotification.rarity === 'platinum' ? 'from-yellow-500/10' : 'from-indigo-500/10'} to-transparent pointer-events-none`} />
          
          <div className="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden ring-2 ring-white/10 shadow-lg">
            <img 
              src={currentNotification.gameIcon || "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=100&h=100&fit=crop"} 
              alt="" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>

          <div className="flex-1 min-w-0 z-10">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className={`w-3 h-3 ${currentNotification.rarity === 'platinum' ? 'text-yellow-400' : 'text-indigo-400'}`} />
              <span className={`text-[10px] uppercase font-black tracking-widest ${currentNotification.rarity === 'platinum' ? 'text-yellow-400' : 'text-indigo-400'}`}>
                {currentNotification.platformLabel || "Achievement Unlocked"}
              </span>
            </div>
            <h3 className="text-sm font-bold text-white truncate leading-tight">
              {currentNotification.title}
            </h3>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {currentNotification.gameTitle}
            </p>
          </div>
          
          <div className="shrink-0 w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
            {currentNotification.rarity === 'platinum' ? (
              <Star className="w-5 h-5 text-yellow-400 animate-pulse" />
            ) : (
              <Zap className="w-5 h-5 text-indigo-400" />
            )}
          </div>
        </div>

        <motion.div 
          initial={{ width: "100%" }}
          animate={{ width: "0%" }}
          transition={{ duration: 5, ease: "linear" }}
          className={`h-1 ${currentNotification.rarity === 'platinum' ? 'bg-yellow-500' : 'bg-indigo-500'}`}
        />
      </motion.div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isOverlayRoute, setIsOverlayRoute] = useState(window.location.pathname === '/overlay');

  useEffect(() => {
    const handleLocationChange = () => {
      setIsOverlayRoute(window.location.pathname === '/overlay');
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  if (isOverlayRoute) {
    return (
      <div className="bg-transparent min-h-screen">
        <DesktopOverlay />
      </div>
    );
  }

  return <Dashboard />;
}

