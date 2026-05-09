const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let mainWindow;
let overlayWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#0A0A0F',
    title: "Universal Achievement Notifier - Dashboard"
  });

  // In production, point to the built index.html
  // In development, point to your dev server
  const startUrl = process.env.NODE_ENV === 'development' 
    ? 'http://localhost:3000' 
    : `file://${path.join(__dirname, 'dist/index.html')}`;

  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (overlayWindow) overlayWindow.close();
  });
}

function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 400,
    height: 200,
    x: width - 420,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  // Set click-through
  overlayWindow.setIgnoreMouseEvents(true);

  const startUrl = process.env.NODE_ENV === 'development' 
    ? 'http://localhost:3000/overlay' 
    : `file://${path.join(__dirname, 'dist/index.html')}#/overlay`;

  overlayWindow.loadURL(startUrl);

  // Example IPC for positioning
  ipcMain.on('set-overlay-position', (event, pos) => {
    if (overlayWindow) {
      if (pos === 'top-right') overlayWindow.setPosition(width - 420, 20);
      if (pos === 'bottom-right') overlayWindow.setPosition(width - 420, height - 220);
      if (pos === 'top-left') overlayWindow.setPosition(20, 20);
    }
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

app.on('ready', () => {
  createMainWindow();
  createOverlayWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});
