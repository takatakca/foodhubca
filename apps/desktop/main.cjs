const { app, BrowserWindow, Menu, shell } = require('electron');
const { ORIGIN, isHubUrl } = require('./navigation.cjs');

let window;
let lastHubUrl = ORIGIN;
let isOffline = false;

function openHub(path) {
  lastHubUrl = new URL(path, ORIGIN).href;
  isOffline = false;
  return window.loadURL(lastHubUrl).catch(() => {});
}

function setMenu(fr) {
  const nav = [
    [fr ? 'Accueil' : 'Home', '/'],
    [fr ? 'Commandes' : 'Orders', '/orders'],
    [fr ? 'Cuisine' : 'Kitchen', '/kitchen'],
    [fr ? 'Réglages' : 'Settings', '/settings'],
  ];
  const items = nav.map(([label, path]) => ({ label, click: () => openHub(path) }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'ON2GO Hub',
      submenu: [
        ...items,
        { type: 'separator' },
        { label: fr ? 'Réessayer la connexion' : 'Retry connection', accelerator: 'CmdOrCtrl+R', click: () => openHub(lastHubUrl) },
        { label: fr ? 'Ouvrir dans le navigateur' : 'Open in browser', click: () => shell.openExternal(lastHubUrl).catch(() => {}) },
        { role: 'quit', label: fr ? 'Quitter' : 'Quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

function createWindow() {
  const fr = app.getLocale().startsWith('fr');
  window = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 360,
    minHeight: 540,
    title: 'ON2GO Hub',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged,
      partition: 'persist:on2go-hub',
    },
  });
  const contents = window.webContents;
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
  for (const eventName of ['will-navigate', 'will-redirect']) {
    contents.on(eventName, (event) => {
      if (event.isMainFrame && !isHubUrl(event.url)) event.preventDefault();
    });
  }
  contents.on('did-navigate', (_event, url) => {
    if (isHubUrl(url)) lastHubUrl = url;
  });
  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (code === -3 || !isMainFrame || isOffline || !isHubUrl(url)) return;
    isOffline = true;
    window.loadFile(fr ? 'offline-fr.html' : 'offline-en.html').catch(() => {});
  });
  window.on('closed', () => { window = null; });
  setMenu(fr);
  openHub('/orders');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
