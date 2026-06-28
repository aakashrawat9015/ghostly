# ghostly-audio — NAPI-RS Native Audio Capture

NAPI-RS native addon for system audio capture in Ghostly Electron client.

## Architecture

```
native/
├── Cargo.toml          # Rust crate config with napi + windows deps
├── build.rs            # napi-build setup
├── build.ps1           # Windows PowerShell build script
├── package.json        # npm wrapper for @napi-rs/cli
├── .cargo/config.toml  # MSVC target defaults for WASAPI
└── src/
    ├── lib.rs              # NAPI-RS entry point — JS exports
    ├── device.rs           # Shared AudioDevice struct + listDevices dispatch
    ├── windows_device.rs   # WASAPI MMDeviceEnumerator → device list
    ├── wasapi_capture.rs   # WASAPI loopback capture (IAudioClient + IAudioCaptureClient)
    ├── macos_device.rs     # CoreAudio stub
    └── stub_device.rs      # Linux stub
```

## Quick Start (Windows)

### Prerequisites

- **Rust MSVC toolchain**: `rustup default stable-msvc`
- **Visual Studio Build Tools** (for Windows SDK)
- **Node.js 18+**

### Build

From Windows PowerShell:

```powershell
cd native
.\build.ps1
```

Or manually:

```powershell
cd native
npm install          # install @napi-rs/cli
npx napi build --platform --release
```

Output: `ghostly-audio.win32-x64-msvc.node`

### Test

```powershell
node -e "
  const m = require('./ghostly-audio.win32-x64-msvc.node');
  console.log('Version:', m.getVersion());
  console.log('Devices:', m.listDevices());
"
```

Or use the full test harness:

```powershell
node ../src/test/test-native-audio.js
```

## JS API

```typescript
const audio = require("./ghostly-audio.win32-x64-msvc.node");

// Enumerate devices
const devices = audio.listDevices();
// [{ id: "...", name: "Speakers", deviceType: "output", channels: 2, ... }]

// Start loopback capture
const handle = audio.startLoopback(
    "default",     // device ID or "default"
    16000,         // sample rate (Hz)
    1,             // channels (1=mono, 2=stereo)
    (err, chunk) => {
        // chunk is a Buffer of 16-bit PCM int LE
        console.log("Got", chunk.length, "bytes");
    }
);

// Stop capture
audio.stopLoopback(handle);

// Get version
audio.getVersion(); // "0.1.0"
```

## Platform Support

| Platform | Capture | Device Enum | Status       |
|----------|---------|-------------|--------------|
| Windows  | WASAPI loopback | WASAPI MMDeviceEnumerator | Working |
| macOS    | CoreAudio (planned) | Stub | Coming soon |
| Linux    | Stub | Stub | Not planned |

## Integrating with Ghostly

The TypeScript wrapper `src/main/services/audio/NativeAudioBackend.ts` provides
a drop-in replacement for `AudioEngine`:

```typescript
import { NativeAudioBackend } from "./NativeAudioBackend";

const backend = new NativeAudioBackend();
const handle = backend.startLoopback("default", 16000, 1, (chunk) => {
    // Forward to WorkerBridge
});
```

## Troubleshooting

**"Failed to load native addon"**
→ Build it first: `cd native && npm run build`

**"No audio devices found"**
→ Check Windows Sound settings — ensure output device is enabled

**Compilation errors about missing Windows SDK**
→ Install Visual Studio Build Tools with "Desktop development with C++"

**Active toolchain is GNU, not MSVC**
→ Run: `rustup default stable-x86_64-pc-windows-msvc`
