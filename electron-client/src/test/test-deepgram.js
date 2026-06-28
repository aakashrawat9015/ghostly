/**
 * Standalone test: WASAPI loopback → Deepgram STT
 *
 * Run from electron-client/:
 *   node src/test/test-deepgram.js
 *
 * Play any audio on your speakers while it runs.
 * You should see partial/final transcripts printed within a few seconds.
 */

const path = require("path")
const fs   = require("fs")

// ── Load .env manually ──────────────────────────────────────────
const envPath = path.join(__dirname, "../../.env")
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n")
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eq = trimmed.indexOf("=")
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        const val = trimmed.slice(eq + 1).trim()
        if (!process.env[key]) process.env[key] = val
    }
    console.log("[Test] Loaded .env")
} else {
    console.warn("[Test] No .env found — using existing environment variables")
}

// ── Validate API key ────────────────────────────────────────────
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY
if (!DEEPGRAM_API_KEY) {
    console.error("[Test] ERROR: DEEPGRAM_API_KEY is not set")
    process.exit(1)
}
console.log(`[Test] DEEPGRAM_API_KEY: ${DEEPGRAM_API_KEY.slice(0, 8)}...${DEEPGRAM_API_KEY.slice(-4)}`)

// ── Load native addon ───────────────────────────────────────────
const nativePath = path.join(__dirname, "../../native/ghostly-audio.win32-x64-msvc.node")
let audio
try {
    audio = require(nativePath)
    console.log(`[Test] Loaded ghostly-audio v${audio.getVersion()}`)
} catch (err) {
    console.error("[Test] ERROR loading native addon:", err.message)
    process.exit(1)
}

// ── Load ws ─────────────────────────────────────────────────────
const WebSocket = require("ws")

// ── Connect to Deepgram ─────────────────────────────────────────
const DG_URL = [
    "wss://api.deepgram.com/v1/listen",
    "?model=nova-2",
    "&encoding=linear16",
    "&sample_rate=16000",
    "&channels=1",
    "&interim_results=true",
    "&endpointing=800",
    "&utterance_end_ms=1500",
].join("")

console.log("[Test] Connecting to Deepgram...")

const ws = new WebSocket(DG_URL, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
})

let captureHandle = null
let chunkCount = 0
let transcriptCount = 0

ws.on("open", () => {
    console.log("[Test] ✅ Connected to Deepgram\n")
    console.log("[Test] Starting WASAPI loopback capture (16kHz mono)...")
    console.log("[Test] → Play audio on your speakers. Transcripts will appear below.\n")

    try {
        captureHandle = audio.startLoopback(
            "default",  // WASAPI default render device (loopback)
            16000,
            1,
            (chunk) => {
                const buf = Buffer.from(chunk)
                chunkCount++
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(buf)
                }
            }
        )
        console.log(`[Test] Capture handle: ${captureHandle}`)
    } catch (err) {
        console.error("[Test] ERROR starting capture:", err.message)
        ws.close()
        process.exit(1)
    }
})

ws.on("message", (data) => {
    try {
        const msg = JSON.parse(data.toString())

        if (msg.type === "Metadata") {
            console.log("[Test] Deepgram Metadata:", JSON.stringify(msg, null, 2))
            return
        }

        if (msg.type === "Results") {
            const alt = msg.channel?.alternatives?.[0]
            if (!alt) return
            const text = alt.transcript?.trim()
            if (!text) return

            const isFinal = msg.is_final
            const confidence = (alt.confidence * 100).toFixed(0)

            transcriptCount++
            const tag = isFinal ? "FINAL  " : "partial"
            console.log(`[${tag}] (${confidence}%) ${text}`)
        }

        if (msg.type === "SpeechStarted") {
            process.stdout.write("[Speech detected] ")
        }

        if (msg.type === "UtteranceEnd") {
            console.log("[Utterance ended]\n")
        }

        if (msg.type === "Error") {
            console.error("[Deepgram ERROR]", msg.message ?? msg)
        }
    } catch {
        // ignore parse errors
    }
})

ws.on("error", (err) => {
    console.error("[Test] WebSocket error:", err.message)
})

ws.on("close", (code, reason) => {
    console.log(`\n[Test] Deepgram closed: code=${code} reason=${reason}`)
    if (captureHandle !== null) {
        audio.stopLoopback(captureHandle)
        captureHandle = null
    }
    console.log(`[Test] Sent ${chunkCount} audio chunks, received ${transcriptCount} transcripts`)
    process.exit(0)
})

// ── Deepgram KeepAlive — prevent 12s timeout when no audio ─────
const keepAlive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "KeepAlive" }))
    }
}, 5000)

// ── Stop after 60 seconds ───────────────────────────────────────
setTimeout(() => {
    console.log("\n[Test] 60s timeout — stopping...")
    clearInterval(keepAlive)
    if (captureHandle !== null) {
        audio.stopLoopback(captureHandle)
        captureHandle = null
    }
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "CloseStream" }))
        setTimeout(() => ws.close(), 500)
    }
}, 60_000)

// ── Progress ticker ─────────────────────────────────────────────
let elapsed = 0
setInterval(() => {
    elapsed++
    process.stdout.write(`\r[${elapsed}s] chunks captured: ${chunkCount} | transcripts: ${transcriptCount}   `)
}, 1000).unref()

console.log("[Test] Running for 60 seconds. Press Ctrl+C to stop early.")
console.log("[Test] *** START PLAYING AUDIO ON YOUR SPEAKERS NOW ***\n")
