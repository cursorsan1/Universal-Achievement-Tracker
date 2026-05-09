import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process';

// ESM fix a __dirname helyettesítésére
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;

// Notification listener
ipcMain.on('show-notification', (event, arg) => {
  const { title, text, image, rarity, gameTitle, soundPath } = arg;
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
    soundPath: soundPath || ''
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

  console.log(`[Electron] Indítás: ${pythonCommand} ${serverPath}`);

  pythonProcess = spawn(pythonCommand, [serverPath], {
    stdio: 'inherit'
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startPythonServer();
  // Wait 2 seconds for Vite to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));
  createWindow();

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
