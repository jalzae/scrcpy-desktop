# scrcpy-desktop

Minimal desktop wrapper around the `scrcpy` CLI. Start/stop mirroring per connected
device and watch scrcpy's output (errors included) in the app.

Uses the `scrcpy` and `adb` binaries already installed on your system — it does not
bundle or build them. Paths are auto-detected (homebrew, Android SDK, PATH); override
them in the in-app Settings panel.

## Run from source

```bash
cd desktop
npm install
npm start
```

## Build installers

```bash
cd desktop
npm run dist:mac     # .dmg into desktop/dist/
npm run dist:win     # .exe (NSIS) into desktop/dist/
npm run dist:linux   # .AppImage into desktop/dist/
```

Note for macOS: apps launched from Finder don't inherit your shell `PATH`, so the
wrapper also probes `/opt/homebrew/bin`, `/usr/local/bin` and
`~/Library/Android/sdk/platform-tools` to find `scrcpy`/`adb`.
