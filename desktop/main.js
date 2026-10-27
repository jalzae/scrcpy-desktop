const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, spawnSync } = require('child_process');
const { existsSync } = require('fs');
const os = require('os');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

/** serial -> ChildProcess */
const running = new Map();

// ---------------------------------------------------------------------------
// Config (persisted in userData so paths survive restarts)
// ---------------------------------------------------------------------------

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

let config = {};

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------
// GUI apps launched from Finder / Start Menu do not inherit the shell PATH
// (on macOS: /usr/bin:/bin:/usr/sbin:/sbin only), so search the usual install
// locations ourselves before falling back to `which`/`where`.

const SEARCH_DIRS = {
  darwin: [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), 'Library/Android/sdk/platform-tools'),
    '/usr/bin',
    '/bin',
  ],
  linux: [
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
    path.join(os.homedir(), 'Android/Sdk/platform-tools'),
    path.join(os.homedir(), '.local/bin'),
  ],
  win32: [
    'C:\\platform-tools',
    path.join(os.homedir(), 'AppData\\Local\\Android\\Sdk\\platform-tools'),
    path.join(os.homedir(), 'scoop\\shims'),
  ],
};

function exeName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function resolveBinary(name, override) {
  if (override && existsSync(override)) return override;
  if (override) return override; // keep the user's path so the error message shows it

  for (const dir of SEARCH_DIRS[process.platform] || []) {
    const candidate = path.join(dir, exeName(name));
    if (existsSync(candidate)) return candidate;
  }

  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const res = spawnSync(lookup, [name], { encoding: 'utf8', windowsHide: true });
  if (res.status === 0) {
    const first = res.stdout.split(/\r?\n/).find(Boolean);
    if (first) return first.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// adb devices -l parsing
// ---------------------------------------------------------------------------

function parseDevices(output) {
  const devices = [];
  let inList = false;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!inList) {
      if (line.startsWith('List of devices attached')) inList = true;
      continue;
    }
    if (line.startsWith('* ')) continue; // adb server chatter on stderr
    if (line.startsWith('daemon ')) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [serial, state] = parts;
    let model = '';
    for (const part of parts.slice(2)) {
      if (part.startsWith('model:')) model = part.slice(6).replace(/_/g, ' ');
    }
    devices.push({ serial, state, model: model || '(unknown model)' });
  }
  return devices;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('paths:detect', () => ({
  scrcpy: resolveBinary('scrcpy', config.scrcpyPath),
  adb: resolveBinary('adb', config.adbPath),
}));

ipcMain.handle('paths:set', (_e, next) => {
  config = { ...config, scrcpyPath: next.scrcpyPath || '', adbPath: next.adbPath || '' };
  saveConfig(config);
  return { ok: true };
});

ipcMain.handle('devices:list', () => {
  const adb = resolveBinary('adb', config.adbPath);
  if (!adb) {
    return { error: 'adb not found. Install Android platform-tools (or set the adb path in settings).' };
  }
  const res = spawnSync(adb, ['devices', '-l'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (res.error) {
    return { error: `failed to run adb: ${res.error.message}` };
  }
  if (res.status !== 0) {
    return { error: `adb devices failed (exit ${res.status}): ${res.stderr || res.stdout || 'no output'}` };
  }
  return { devices: parseDevices(res.stdout) };
});

ipcMain.handle('scrcpy:start', (_e, serial) => {
  if (running.has(serial)) return { error: `scrcpy already running for ${serial}` };
  const scrcpy = resolveBinary('scrcpy', config.scrcpyPath);
  if (!scrcpy) {
    return { error: 'scrcpy not found. Install it (e.g. brew install scrcpy) or set the path in settings.' };
  }
  const adb = resolveBinary('adb', config.adbPath);
  if (!adb) {
    return { error: 'adb not found. Install Android platform-tools (or set the adb path in settings).' };
  }

  // GUI apps don't inherit the shell PATH, and scrcpy itself execs `adb`
  // (start-server, push, ...) — give the child the resolved binary via the ADB
  // env var plus a PATH that includes both tool directories.
  const childEnv = {
    ...process.env,
    ADB: adb,
    PATH: [
      path.dirname(scrcpy),
      path.dirname(adb),
      process.env.PATH || '',
    ].join(path.delimiter),
  };

  let proc;
  try {
    proc = spawn(scrcpy, ['-s', serial], { windowsHide: true, env: childEnv });
  } catch (err) {
    return { error: `failed to launch scrcpy: ${err.message}` };
  }

  running.set(serial, proc);

  const sendLog = (stream, text) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scrcpy:log', { serial, stream, text });
    }
  };

  proc.stdout.on('data', (chunk) => sendLog('stdout', chunk.toString()));
  proc.stderr.on('data', (chunk) => sendLog('stderr', chunk.toString()));

  proc.on('error', (err) => {
    sendLog('stderr', `[scrcpy-desktop] failed to launch: ${err.message}\n`);
    running.delete(serial);
  });

  proc.on('exit', (code, signal) => {
    running.delete(serial);
    sendLog('stdout', `[scrcpy-desktop] scrcpy exited (code=${code === null ? 'null' : code}, signal=${signal})\n`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scrcpy:exit', { serial, code, signal });
    }
  });

  return { ok: true, pid: proc.pid };
});

ipcMain.handle('scrcpy:stop', (_e, serial) => {
  const proc = running.get(serial);
  if (!proc) return { error: `scrcpy not running for ${serial}` };

  if (process.platform === 'win32') {
    // /t kills the whole process tree (adb helpers included)
    spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
  } else {
    proc.kill('SIGTERM');
  }
  return { ok: true };
});

ipcMain.handle('scrcpy:running', () => [...running.keys()]);

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 640,
    title: 'scrcpy-desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function stopAll() {
  for (const [, proc] of running) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
    } else {
      proc.kill('SIGTERM');
    }
  }
  running.clear();
}

app.whenReady().then(() => {
  config = loadConfig();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopAll();
  app.quit();
});

app.on('before-quit', stopAll);
