// Dev launcher: VS Code terminals export ELECTRON_RUN_AS_NODE=1, which makes the
// `electron` binary run as plain Node (require('electron') then resolves to the
// npm stub and ipcMain is undefined). Strip it before launching.
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = require('child_process');
const electron = require('electron');

const child = spawn(electron, ['.'], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));
