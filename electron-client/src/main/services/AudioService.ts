// src/main/services/AudioService.ts
import { spawn, ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import { app } from "electron"
import fs from "fs"

const DEBUG = process.env.DEBUG === "true"

// ✅ Let Deepgram handle silence by default
const ENABLE_LOCAL_VAD = process.env.ENABLE_LOCAL_VAD === "true"
const VAD_THRESHOLD = Number(process.env.VAD_THRESHOLD ?? "0.003") // safer default

const TARGET_RMS = 0.1
const MAX_GAIN = 10
const MIN_RMS_FOR_NORMALIZE = 1e-6

const MAX_RESTART_ATTEMPTS = 3
const RESTART_BASE_DELAY_MS = 2000

export class AudioService {
    private proc: ChildProcessWithoutNullStreams | null = null
    private onChunkCb: ((chunk: Buffer) => void) | null = null

    private restartAttempts = 0
    private isIntentionallyStopped = false
    private leftover: Buffer | null = null // prevent sample split

    startCapture(onChunk: (chunk: Buffer) => void): void {
        if (this.proc) return
        this.onChunkCb = onChunk
        this.restartAttempts = 0
        this.isIntentionallyStopped = false
        this.spawnProcess()
    }

    stopCapture(): void {
        this.isIntentionallyStopped = true
        this.killProcess()
    }

    private spawnProcess(): void {
        const binaryPath = this.resolveBinaryPath()
        this.log("Spawning:", binaryPath)

        this.proc = spawn(binaryPath)

        this.proc.stdout.on("data", (chunk: Buffer) => {
            this.handleChunk(chunk)
        })

        this.proc.stderr.on("data", (data) => {
            // ✅ Ensure your native binary logs ONLY to stderr
            this.log("stderr:", data.toString())
        })

        this.proc.on("error", (err) => {
            this.error("Spawn error:", err.message)
        })

        this.proc.on("close", (code) => {
            this.proc = null

            if (code === 0 || this.isIntentionallyStopped) return

            this.error("Process crashed:", code)
            this.scheduleRestart()
        })
    }

    private killProcess(): void {
        if (!this.proc) return
        this.proc.removeAllListeners()
        this.proc.kill("SIGTERM")
        this.proc = null
    }

    private scheduleRestart(): void {
        if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) return
        this.restartAttempts++

        const base = this.restartAttempts * RESTART_BASE_DELAY_MS
        const jitter = Math.random() * 500
        const delay = base + jitter

        setTimeout(() => {
            if (!this.isIntentionallyStopped) this.spawnProcess()
        }, delay)
    }

    private handleChunk(chunk: Buffer): void {
        // merge leftover byte if any
        if (this.leftover) {
            chunk = Buffer.concat([this.leftover, chunk])
            this.leftover = null
        }

        // enforce even length (16-bit samples)
        if (chunk.length % 2 !== 0) {
            this.leftover = chunk.subarray(chunk.length - 1)
            chunk = chunk.subarray(0, chunk.length - 1)
        }
        if (chunk.length === 0) return

        const rms = this.computeRMS(chunk)

        // ✅ VAD only if explicitly enabled
        if (ENABLE_LOCAL_VAD && rms < VAD_THRESHOLD) return

        // ✅ Normalize only if signal present; otherwise pass-through
        const out = rms > MIN_RMS_FOR_NORMALIZE ? this.normalizeChunk(chunk, rms) : chunk

        this.onChunkCb?.(out)
    }

    private computeRMS(buffer: Buffer): number {
        let sum = 0
        const samples = buffer.length / 2

        for (let i = 0; i < samples; i++) {
            const s = buffer.readInt16LE(i * 2) / 32768
            sum += s * s
        }

        return Math.sqrt(sum / samples)
    }

    private normalizeChunk(buffer: Buffer, rms: number): Buffer {
        const gain = Math.min(TARGET_RMS / rms, MAX_GAIN)
        const out = Buffer.allocUnsafe(buffer.length)

        const samples = buffer.length / 2
        for (let i = 0; i < samples; i++) {
            let s = buffer.readInt16LE(i * 2) / 32768
            s = Math.max(-1, Math.min(1, s * gain))
            out.writeInt16LE(Math.round(s * 32767), i * 2)
        }

        return out
    }

    private resolveBinaryPath(): string {
        const name =
            process.platform === "win32"
                ? "audio-capture.exe"
                : "audio-capture"

        // 🔥 Always resolve relative to compiled file
        const devPath = path.join(__dirname, "../../../resources/audio", name)

        const prodPath = path.join(process.resourcesPath, "audio", name)

        const finalPath = app.isPackaged ? prodPath : devPath

        // ✅ Debug check (VERY IMPORTANT)
        if (!fs.existsSync(finalPath)) {
            console.error("[AudioService] ❌ Binary NOT FOUND at:", finalPath)
        } else {
            console.log("[AudioService] ✅ Binary found at:", finalPath)
        }

        return finalPath
    }

    private log(...args: any[]) {
        if (DEBUG) console.log("[AudioService]", ...args)
    }

    private error(...args: any[]) {
        console.error("[AudioService]", ...args)
    }
}