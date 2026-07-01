# 🎬 Screenie

A desktop screenshot timelapse application built with Electron. Automatically captures your screen at configurable intervals and generates timelapse videos of your work sessions.

![Platform](https://img.shields.io/badge/platform-Windows-0078d4)
![Electron](https://img.shields.io/badge/electron-31.x-47848f)
![License](https://img.shields.io/badge/license-Apache_2.0-blue)

## ✨ Features

- **Automatic Screen Capture** — Captures screenshots at configurable intervals (5–120 seconds)
- **Session Management** — Organizes captures into sessions with metadata tracking
- **Timelapse Generation** — Creates MP4 videos from captured frames using FFmpeg
- **Window Detection** — Tracks which application is active during each capture
- **App Filtering** — Optional allowlist to only capture specific applications
- **Idle Detection** — Automatically pauses when you step away
- **Render Settings** — Customize FPS, quality (CRF), encoding speed, resolution, and subtitles
- **System Tray** — Minimize to tray for background operation
- **Modern UI** — Clean, dark interface with real-time capture preview

## 📋 Requirements

- **OS:** Windows 10/11 (x64)
- **Node.js:** v18.0.0 or higher
- **npm:** v9.0.0 or higher

> ⚠️ **Note:** Screenie uses Win32 APIs (user32.dll, kernel32.dll) for window detection and idle tracking. It is Windows-only.

## 🚀 Installation

### Quick Start

```bash
# Clone the repository
git clone https://github.com/StillPillWill/duck.git
cd duck

# Install dependencies
npm install

# Start the application
npm start
```

### Development

```bash
# Run tests
npm test

# Start with DevTools (edit main.js to set devTools: true)
npm start
```

## ⚙️ Configuration

Screenie stores its configuration in:
```
%APPDATA%/screenie/settings.json
```

### Default Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `interval` | 60s | Time between captures (5–120s) |
| `idleThreshold` | 300s | Pause after this much inactivity |
| `quality` | medium | Capture scale (low: 0.5×, medium: 0.75×, high: 1.0×) |
| `allowlistEnabled` | false | Only capture specific apps |
| `allowlist` | [] | List of app executable names to capture |
| `minimizeToTray` | true | Hide to tray instead of closing |
| `timelapseFps` | 1 | Output video framerate (1–30) |
| `timelapseCrf` | 23 | Video quality (18=high, 35=low) |
| `timelapsePreset` | medium | Encoding speed (ultrafast → veryslow) |
| `timelapseResolution` | 1.0 | Output scale (0.5, 0.75, 1.0) |
| `timelapseSubtitles` | true | Burn app/title/timestamp onto frames |

## 📁 Project Structure

```
duck/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── main.js              # App entry, window management, IPC
│   │   ├── captureEngine.js     # Screen capture logic
│   │   ├── sessionManager.js    # Session lifecycle & file I/O
│   │   ├── settingsStore.js     # Settings persistence
│   │   ├── windowDetector.js    # Win32 FFI window detection
│   │   ├── activityDetector.js  # Win32 idle detection
│   │   └── timelapseGenerator.js # FFmpeg video generation
│   └── renderer/                # Electron renderer process
│       ├── index.html           # UI markup
│       ├── app.js               # Renderer logic & IPC
│       ├── styles/main.css      # Styles
│       └── assets/icon.png      # App icon
├── test/                        # Test suite
│   ├── settingsStore.test.js    # Settings CRUD tests
│   ├── sessionManager.test.js   # Session lifecycle tests
│   ├── captureEngine.test.js    # State machine tests
│   ├── timelapseGenerator.test.js # Time formatting tests
│   └── renderer.test.js         # UI logic tests
├── package.json
└── README.md
```

## 🧪 Testing

Screenie uses Node.js built-in test runner (`node:test`):

```bash
npm test
```

This runs 80+ tests covering:
- Settings store (CRUD, persistence, defaults)
- Session manager (create, resume, delete, frame tracking)
- Capture engine (state machine transitions)
- Timelapse generator (ASS timestamp formatting)
- Renderer logic (progress ring math, input clamping)

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `electron` | Desktop app framework |
| `koffi` | Win32 FFI for window/activity detection |
| `fluent-ffmpeg` | FFmpeg wrapper for timelapse generation |
| `ffmpeg-static` | Prebuilt FFmpeg binary |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

Apache 2.0. See [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Built with [Electron](https://www.electronjs.org/)
- Video encoding powered by [FFmpeg](https://ffmpeg.org/)
- Window detection via [koffi](https://koffi.dev/) (Win32 FFI)
