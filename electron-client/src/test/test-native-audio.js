/**
 * Test harness for ghostly-audio NAPI-RS addon.
 *
 * Run with:
 *   First build:  npm run native:build
 *   Then test:    node src/test/test-native-audio.js
 *
 * Or from Windows PowerShell:
 *   node src/test/test-native-audio.js
 */

const path = require("path")

// Resolve the .node file based on platform
const platform = process.platform
const arch = process.arch === "x64" ? "x64" : process.arch
let suffix = ""
switch (platform) {
    case "win32":
        suffix = "-msvc"
        break
    case "linux":
        suffix = "-gnu"
        break
}
const triple = `${platform}-${arch}${suffix}`
const nativePath = path.join(
    __dirname,
    "..",
    "..",
    "native",
    `ghostly-audio.${triple}.node`
)

console.log(`[Test] Loading native addon from: ${nativePath}`)

let audio
try {
    audio = require(nativePath)
    console.log(`[Test] Loaded ghostly-audio v${audio.getVersion()}\n`)
} catch (err) {
    console.error(`[Test] Failed to load native addon:`, err.message)
    console.error(
        `[Test] Make sure you built it first: cd native && npm run build`
    )
    process.exit(1)
}

// ── Test 1: List devices ─────────────────────────────

console.log("── Test 1: listDevices() ──")
const devices = audio.listDevices()
console.log(`Found ${devices.length} audio device(s):`)
for (const dev of devices) {
    console.log(
        `  [${dev.deviceType}] "${dev.name}" ` +
            `id=${dev.id} ` +
            `${dev.channels}ch @ ${dev.defaultSampleRate}Hz ` +
            `(${dev.hostApi})`
    )
}
console.log()

// ── Test 2: Loopback capture (3 seconds) ────────────

if (devices.length === 0) {
    console.log("[Test] No devices found — skipping capture test.")
    process.exit(0)
}

console.log("── Test 2: startLoopback() (3 seconds) ──")
let chunkCount = 0
let totalBytes = 0

const handle = audio.startLoopback(
    "default", // device ID
    16000, // sample rate (16kHz for STT)
    1, // mono
    (chunk) => {
        const buf = Buffer.from(chunk)
        chunkCount++
        totalBytes += buf.length
    }
)

console.log(`Capture handle: ${handle}`)

// Stop after 3 seconds
setTimeout(() => {
    audio.stopLoopback(handle)
    console.log(`\n[Test] Stopped. Received ${chunkCount} chunks, ${totalBytes} bytes total.`)
    console.log(
        `[Test] Avg chunk: ${chunkCount > 0 ? (totalBytes / chunkCount).toFixed(0) : "N/A"} bytes`
    )
    process.exit(0)
}, 3000)
