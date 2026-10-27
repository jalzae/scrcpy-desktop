const api = window.scrcpyDesktop;

const deviceRows = document.getElementById('device-rows');
const logPanel = document.getElementById('log-panel');
const pathsStatus = document.getElementById('paths-status');
const settingsPanel = document.getElementById('settings');
const inputScrcpy = document.getElementById('input-scrcpy');
const inputAdb = document.getElementById('input-adb');

/** serial -> true while scrcpy runs for that device */
const runningSerials = new Set();

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

async function refreshDevices() {
  const res = await api.listDevices();
  if (res.error) {
    renderDevices([]);
    appendLog('main', `[scrcpy-desktop] ${res.error}\n`, 'err');
    return;
  }
  renderDevices(res.devices);
}

function renderDevices(devices) {
  deviceRows.textContent = '';
  if (!devices.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'muted';
    td.textContent = 'No devices. Connect a phone with USB debugging enabled, then Refresh.';
    tr.appendChild(td);
    deviceRows.appendChild(tr);
    return;
  }

  for (const device of devices) {
    const isRunning = runningSerials.has(device.serial);
    const usable = device.state === 'device';

    const tr = document.createElement('tr');

    const tdSerial = document.createElement('td');
    tdSerial.className = 'mono';
    tdSerial.textContent = device.serial;

    const tdModel = document.createElement('td');
    tdModel.textContent = device.model;

    const tdState = document.createElement('td');
    tdState.textContent = isRunning ? 'mirroring' : device.state;
    tdState.className = isRunning ? 'state-running' : `state-${device.state}`;

    const tdAction = document.createElement('td');
    const btn = document.createElement('button');
    if (isRunning) {
      btn.textContent = 'Stop';
      btn.className = 'danger';
      btn.addEventListener('click', () => api.stop(device.serial));
    } else {
      btn.textContent = 'Start';
      btn.disabled = !usable;
      btn.addEventListener('click', () => startDevice(device.serial));
    }
    tdAction.appendChild(btn);

    tr.append(tdSerial, tdModel, tdState, tdAction);
    deviceRows.appendChild(tr);
  }
}

async function startDevice(serial) {
  const res = await api.start(serial);
  if (res.error) {
    appendLog('main', `[scrcpy-desktop] ${res.error}\n`, 'err');
    return;
  }
  runningSerials.add(serial);
  appendLog('main', `[scrcpy-desktop] started scrcpy for ${serial} (pid ${res.pid})\n`);
  refreshDevices();
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

function appendLog(serial, text, level) {
  const line = document.createElement('span');
  line.className = `log-line log-${level || 'info'}`;
  line.textContent = `[${serial}] ${text}`;
  logPanel.appendChild(line);
  logPanel.scrollTop = logPanel.scrollHeight;
}

api.onLog(({ serial, stream, text }) => {
  // scrcpy writes its normal logs to stderr; highlight errors/warnings only
  let level = stream === 'stderr' ? 'out' : 'info';
  if (/ERROR|FATAL|failed|Failed/.test(text)) level = 'err';
  else if (/WARN/.test(text)) level = 'warn';
  appendLog(serial, text, level);
});

api.onExit(({ serial }) => {
  runningSerials.delete(serial);
  refreshDevices();
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function loadPaths() {
  const detected = await api.detectPaths();
  const fmt = (p) => (p ? p : 'not found');
  pathsStatus.textContent = `scrcpy: ${fmt(detected.scrcpy)} · adb: ${fmt(detected.adb)}`;
  pathsStatus.className = detected.scrcpy && detected.adb ? 'ok' : 'bad';
  return detected;
}

document.getElementById('btn-settings').addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  await api.setPaths({ scrcpyPath: inputScrcpy.value.trim(), adbPath: inputAdb.value.trim() });
  await loadPaths();
  refreshDevices();
});

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

document.getElementById('btn-refresh').addEventListener('click', refreshDevices);

document.getElementById('btn-stop-all').addEventListener('click', async () => {
  for (const serial of [...runningSerials]) {
    await api.stop(serial);
  }
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

(async function init() {
  const detected = await loadPaths();
  inputScrcpy.placeholder = detected.scrcpy || 'scrcpy not found — enter full path';
  inputAdb.placeholder = detected.adb || 'adb not found — enter full path';
  // restore "mirroring" state for scrcpy processes started in a previous window
  const runningNow = await api.running();
  for (const serial of runningNow) runningSerials.add(serial);
  await refreshDevices();
})();
