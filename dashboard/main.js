const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');

let mainWindow;
let flServerProcess = null;
let clientProcesses = {};

// ── Get local IP address ──
function getLocalIP() {
  const interfaces = os.networkInterfaces();

  let fallback = null;

  for (const name of Object.keys(interfaces)) {
    const lower = name.toLowerCase();

    for (const iface of interfaces[name]) {
      if (iface.family !== 'IPv4' || iface.internal) continue;

      // ❌ Skip VMware / Virtual adapters
      if (
        lower.includes('vmware') ||
        lower.includes('virtual') ||
        lower.includes('loopback')
      ) {
        continue;
      }

      // ✅ PRIORITY: WiFi
      if (
        lower.includes('wi-fi') ||
        lower.includes('wifi') ||
        lower.includes('wlan') ||
        lower.includes('wireless')
      ) {
        return iface.address;
      }

      // Save as fallback (Ethernet etc.)
      if (!fallback) {
        fallback = iface.address;
      }
    }
  }

  return fallback || '127.0.0.1';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#050a0f',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);

  // Send QR code to renderer after window loads
  mainWindow.webContents.on('did-finish-load', async () => {
    const ip = getLocalIP();
    const url = `http://${ip}:8000`;
    try {
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 200,
        margin: 2,
        color: { dark: '#00ff9d', light: '#050a0f' }
      });
      mainWindow.webContents.send('qr-ready', { qrDataUrl, url });
    } catch (err) {
      console.error('QR generation failed:', err);
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (flServerProcess) flServerProcess.kill();
  Object.values(clientProcesses).forEach(p => p.kill());
  if (process.platform !== 'darwin') app.quit();
});

// Window controls
ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('close-window', () => {
  if (flServerProcess) flServerProcess.kill();
  Object.values(clientProcesses).forEach(p => p.kill());
  app.quit();
});

// Get QR on demand
ipcMain.handle('get-qr', async () => {
  const ip = getLocalIP();
  const url = `http://${ip}:8000`;
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: 200,
    margin: 2,
    color: { dark: '#00ff9d', light: '#050a0f' }
  });
  return { qrDataUrl, url };
});

// File dialog for video selection
ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'avi', 'mov', 'mkv'] }]
  });
  return result.filePaths[0] || null;
});

// Start FL Server
ipcMain.on('start-fl-server', (event) => {
  if (flServerProcess) {
    event.sender.send('server-log', 'Server already running');
    return;
  }

  const aresPath = path.join(__dirname, '../server');
  event.sender.send('server-log', '🚀 Starting FL Server...');

  flServerProcess = spawn('python', ['fl_server.py'], {
    cwd: aresPath,
    env: { ...process.env },
    shell: true
  });

  flServerProcess.stdout.on('data', (data) => {
    event.sender.send('server-log', data.toString());
  });
  flServerProcess.stderr.on('data', (data) => {
    event.sender.send('server-log', data.toString());
  });
  flServerProcess.on('close', (code) => {
    event.sender.send('server-log', `Server stopped (code ${code})`);
    flServerProcess = null;
    event.sender.send('server-stopped');
  });
  flServerProcess.on('error', (err) => {
    event.sender.send('server-log', `❌ Error: ${err.message}`);
    flServerProcess = null;
    event.sender.send('server-stopped');
  });
});

// Stop FL Server
ipcMain.on('stop-fl-server', (event) => {
  if (flServerProcess) {
    flServerProcess.kill();
    flServerProcess = null;
    event.sender.send('server-log', '⛔ Server stopped');
  }
});

// Start FL Client
ipcMain.on('start-fl-client', (event, { clientId, videoPath }) => {
  if (clientProcesses[clientId]) {
    event.sender.send('client-log', { clientId, msg: 'Client already running' });
    return;
  }

  const aresPath = path.join(__dirname, '..');
  const proc = spawn('python', [
    'client/fl_client.py',
    String(clientId),
    videoPath
  ], {
    cwd: aresPath,
    env: { ...process.env },
    shell: true
  });

  clientProcesses[clientId] = proc;
  event.sender.send('client-log', { clientId, msg: `🎥 Client ${clientId} started` });

  proc.stdout.on('data', (data) => {
    event.sender.send('client-log', { clientId, msg: data.toString() });
  });
  proc.stderr.on('data', (data) => {
    event.sender.send('client-log', { clientId, msg: data.toString() });
  });
  proc.on('close', (code) => {
    delete clientProcesses[clientId];
    event.sender.send('client-log', { clientId, msg: `Client ${clientId} finished (code ${code})` });
    event.sender.send('client-stopped', clientId);
  });
  proc.on('error', (err) => {
    event.sender.send('client-log', { clientId, msg: `❌ Error: ${err.message}` });
    delete clientProcesses[clientId];
    event.sender.send('client-stopped', clientId);
  });
});

// Stop FL Client
ipcMain.on('stop-fl-client', (event, clientId) => {
  if (clientProcesses[clientId]) {
    clientProcesses[clientId].kill();
    delete clientProcesses[clientId];
    event.sender.send('client-log', { clientId, msg: `⛔ Client ${clientId} stopped` });
  }
});

// Read training history from file
ipcMain.handle('get-training-history', () => {
  try {
    const filePath = path.join(__dirname, '../outputs/training_history.json');
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
});
