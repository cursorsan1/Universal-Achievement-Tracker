import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import axios from 'axios';

// ESM fix a __dirname helyettesítésére
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const cachePath = path.join(app.getPath('userData'), 'steam_cache.json');
console.log(`[Electron] Settings path: ${settingsPath}`);
console.log(`[Electron] Cache path: ${cachePath}`);

// Ensure directory exists
const settingsDir = path.dirname(settingsPath);
if (!fs.existsSync(settingsDir)) {
  fs.mkdirSync(settingsDir, { recursive: true });
}

// Settings IPC Handlers
ipcMain.handle('get-settings', async () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
  return {};
});

ipcMain.handle('get-cached-steam-data', async () => {
  try {
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath, 'utf8');
      const parsed = JSON.parse(data);
      console.log(`[Electron] Explicit cache request: providing ${parsed.length} games.`);
      return parsed;
    }
  } catch (err) {
    console.error('[Electron] Failed to load cached steam data:', err);
  }
  return [];
});

ipcMain.on('request-steam-cache', async (event) => {
  try {
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath, 'utf8');
      const parsed = JSON.parse(data);
      console.log(`[Electron] request-steam-cache received: pushing ${parsed.length} games to UI.`);
      event.reply('steam-data-updated', parsed);
    }
  } catch (err) {
    console.error('[Electron] Failed to respond to request-steam-cache:', err);
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    // 1. Save to local JSON file
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('[Electron] Settings saved to file.');

    // 2. Notify Python Backend
    try {
      console.log('[Electron] Notifying Python backend at http://localhost:5000/update-config...');
      const response = await axios.post('http://localhost:5000/update-config', {
        steamApiKey: settings.steamApiKey,
        steamId: settings.steamId,
        settingsPath: settingsPath
      });
      console.log('[Electron] Python backend response:', response.data);
      return { success: true, backendResponse: response.data };
    } catch (fetchErr) {
      console.error('[Electron] Failed to notify Python backend:', fetchErr.message);
      return { success: true, backendError: fetchErr.message };
    }
  } catch (err) {
    console.error('Failed to save settings:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('trigger-steam-sync', async () => {
  try {
    console.log('[Electron] Deep Sync request sent to Python for Steam, Xbox, and RetroAchievements...');

    const results = await Promise.allSettled([
      axios.post('http://localhost:5000/sync-steam', { settingsPath: settingsPath }, { timeout: 30000 }),
      axios.post('http://localhost:5000/sync-xbox', { settingsPath: settingsPath }, { timeout: 30000 }),
      axios.post('http://localhost:5000/sync-retro', { settingsPath: settingsPath }, { timeout: 30000 })
    ]);

    const steamResult = results[0];
    const xboxResult = results[1];
    const retroResult = results[2];

    let responseData = { steam: null, xbox: null, retro: null };

    if (steamResult.status === 'fulfilled') {
      console.log('[Electron] Python Steam sync response:', steamResult.value.data);
      responseData.steam = steamResult.value.data;
      if (mainWindow && responseData.steam.games) {
        mainWindow.webContents.send('steam-data-updated', responseData.steam.games);
      }
    } else {
      console.error('[Electron] Failed to trigger Python Steam sync:', steamResult.reason.message);
    }

    if (xboxResult.status === 'fulfilled') {
      console.log('[Electron] Python Xbox sync response:', xboxResult.value.data);
      responseData.xbox = xboxResult.value.data;
      if (mainWindow && responseData.xbox.games) {
        mainWindow.webContents.send('xbox-data-updated', responseData.xbox.games);
      }
    } else {
      console.error('[Electron] Failed to trigger Python Xbox sync:', xboxResult.reason.message);
    }

    if (retroResult.status === 'fulfilled') {
      console.log('[Electron] Python RetroAchievements sync response:', retroResult.value.data);
      responseData.retro = retroResult.value.data;
      if (mainWindow && responseData.retro.games) {
        mainWindow.webContents.send('retro-data-updated', responseData.retro.games);
      }
    } else {
      console.error('[Electron] Failed to trigger Python RetroAchievements sync:', retroResult.reason.message);
    }

    return responseData;
  } catch (err: any) {
    console.error('[Electron] Failed to trigger Python deep sync:', err.message);
    throw new Error('A háttérfolyamat nem válaszol. Kérlek indítsd újra az appot!');
  }
});

// Notification listener
ipcMain.on('show-notification', (event, arg) => {
  const { title, text, image, rarity, gameTitle, soundPath, bgColor, textColor, borderRadius, padding } = arg;
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;
  
  const notificationWindow = new BrowserWindow({
    width: 400,
    height: 150,
    x: width - 410,
    y: 20,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    skipTaskbar: true,
    show: false, // Start hidden, we will show after content is ready or via show()
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const baseUrl = isDev ? 'http://localhost:5173' : `file://${path.join(__dirname, '../dist/index.html')}`;
  
  const queryParams = new URLSearchParams({
    title: title || '',
    text: text || '',
    image: image || '',
    rarity: rarity || 'common',
    gameTitle: gameTitle || '',
    soundPath: soundPath || '',
    bgColor: bgColor || '',
    textColor: textColor || '',
    borderRadius: borderRadius || '',
    padding: padding || ''
  });

  notificationWindow.loadURL(`${baseUrl}#/notification?${queryParams.toString()}`);

  notificationWindow.once('ready-to-show', () => {
    notificationWindow.show();
  });

  // Auto-close after 6 seconds to allow for 5s animation + buffer
  setTimeout(() => {
    if (!notificationWindow.isDestroyed()) {
      notificationWindow.close();
    }
  }, 6500);
});

function startPythonServer() {
  // A projekt gyökérkönyvtárában lévő Python manager
  const serverPath = path.join(__dirname, '..', 'steam_manager.py');
  
  // Platformfüggő parancs (Windows: python, minden más: python3)
  const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
  const userDataPath = app.getPath('userData');

  console.log(`[Electron] Indítás: ${pythonCommand} ${serverPath} ${settingsPath}`);
  console.log(`[Electron] UserData path passed to Python: ${userDataPath}`);

  pythonProcess = spawn(pythonCommand, [serverPath, settingsPath], {
    stdio: 'inherit',
    env: { ...process.env, USER_DATA_PATH: userDataPath }
  });

  pythonProcess.on('error', (err) => {
    console.error(`[Electron] Hiba a Python szerver indításakor a következő helyen: ${serverPath}`, err);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 900,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "Universal Achievement Hub",
    autoHideMenuBar: true
  });

  // Fejlesztői módban a Vite szerverét, buildelt módban a lokális fájlt töltjük be
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Handle data hydration after window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    if (fs.existsSync(cachePath)) {
      try {
        const data = fs.readFileSync(cachePath, 'utf8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`[Electron] Cold start: found cache, pushing ${parsed.length} games to UI after delay.`);
          // Delaying push to ensure React is ready
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('steam-data-updated', parsed);
              console.log('[Electron] Push completed.');
            }
          }, 1500);
        }
      } catch (err) {
        console.error('[Electron] Failed to hydrate with cached data:', err);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

let gameTrackingInterval: NodeJS.Timeout | null = null;
let previouslyRunningGames = new Set<string>();

async function startGameTracking() {
  const psListModule = await import('ps-list');
  const psList = psListModule.default;

  const mappingPath = path.join(__dirname, '..', 'app_mapping.json');
  let appMapping: Record<string, string> = {
    "steam.exe": "Steam",
    "rpcs3.exe": "RPCS3 Emulator",
    "retroarch.exe": "RetroArch",
    "xbapp.exe": "Xbox"
  };

  if (fs.existsSync(mappingPath)) {
    try {
      const data = fs.readFileSync(mappingPath, 'utf8');
      appMapping = JSON.parse(data);
    } catch (e) {
      console.error("[Tracker] Failed to load app_mapping.json", e);
    }
  }

  gameTrackingInterval = setInterval(async () => {
    try {
      const processes = await psList();
      const runningGames = new Set<string>();

      for (const p of processes) {
        const procName = p.name.toLowerCase();
        for (const [exeName, gameName] of Object.entries(appMapping)) {
          if (procName === exeName.toLowerCase()) {
            runningGames.add(gameName);
          }
        }
      }

      for (const gameName of runningGames) {
        if (!previouslyRunningGames.has(gameName)) {
          console.log(`[Tracker] Started tracking: ${gameName}`);

          if (mainWindow) {
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width } = primaryDisplay.workAreaSize;

            const notificationWindow = new BrowserWindow({
              width: 400,
              height: 150,
              x: width - 410,
              y: 20,
              frame: false,
              alwaysOnTop: true,
              transparent: true,
              skipTaskbar: true,
              show: false,
              webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                autoplayPolicy: 'no-user-gesture-required'
              }
            });

            const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
            const baseUrl = isDev ? 'http://localhost:5173' : `file://${path.join(__dirname, '../dist/index.html')}`;

            const queryParams = new URLSearchParams({
              title: "Game Detected",
              text: `Tracking started for ${gameName}`,
              image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=100&h=100&fit=crop",
              rarity: "common",
              gameTitle: gameName,
              soundPath: ""
            });

            notificationWindow.loadURL(`${baseUrl}#/notification?${queryParams.toString()}`);

            notificationWindow.once('ready-to-show', () => {
              notificationWindow.show();
            });

            setTimeout(() => {
              if (!notificationWindow.isDestroyed()) {
                notificationWindow.close();
              }
            }, 6500);
          }
        }
      }

      previouslyRunningGames = runningGames;
    } catch (err) {
      console.error("[Tracker] Error polling processes:", err);
    }
  }, 10000); // 10 seconds
}

app.whenReady().then(async () => {
  startPythonServer();
  // Wait 2 seconds for Vite to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));
  createWindow();

  startGameTracking();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Ha bezárjuk az appot, a Python szervert is lőjük le!
app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
  if (process.platform !== 'darwin') app.quit();
});
