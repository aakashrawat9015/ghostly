import { spawn, ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import { app } from "electron"
import { EventEmitter } from "events"

const DEBUG = process.env.DEBUG === "true"
const KILL_TIMEOUT_MS = 1500

export class MicService extends EventEmitter {
    private proc: ChildProcessWithoutNullStreams | null = null
    private onChunkCb: ((chunk: Buffer) => void) | null = null

    private isRunning = false
    private isIntentionallyStopped = false
    private killTimer: NodeJS.Timeout | null = null

    start(onChunk: (chunk: Buffer) => void): void {
        if (this.isRunning) return

        this.onChunkCb = onChunk
        this.isIntentionallyStopped = false
        this.spawnProcess()
    }

    stop(): void {
        this.isIntentionallyStopped = true
        this.onChunkCb = null
        this.killProcess()
    }

    private spawnProcess(): void {
        const binaryPath = this.resolveBinaryPath()
        this.log("Spawning:", binaryPath)

        this.proc = spawn(binaryPath)

        this.proc.once("spawn", () => {
            this.isRunning = true
            this.log("Mic capture started")
        })

        this.proc.stdout.on("data", (chunk: Buffer) => {
            if (chunk.length > 0) this.onChunkCb?.(chunk)
        })

        this.proc.stderr.on("data", (data) => {
            this.log("stderr:", data.toString())
        })

        this.proc.on("error", (err) => {
            this.error("Spawn error:", err.message)
            this.emit("error", err)
            this.isRunning = false
        })

        this.proc.on("close", (code) => {
            this.clearKillTimer()
            this.proc = null
            this.isRunning = false

            if (code === 0 || this.isIntentionallyStopped) return
            this.error("Process crashed:", code)
        })
    }

    private killProcess(): void {
        if (!this.proc) return

        // Stop receiving any more events
        this.proc.removeAllListeners()

        try {
            this.proc.kill("SIGTERM")
        } catch {
            // ignore
        }

        // ✅ Hard kill fallback (important on Windows)
        this.killTimer = setTimeout(() => {
            try {
                this.proc?.kill("SIGKILL")
            } catch {
                // ignore
            }
            this.proc = null
            this.isRunning = false
            this.log("Mic capture force-stopped")
        }, KILL_TIMEOUT_MS)

        this.killTimer.unref?.()

        this.proc = null
        this.isRunning = false
        this.log("Mic capture stopped")
    }

    private clearKillTimer() {
        if (!this.killTimer) return
        clearTimeout(this.killTimer)
        this.killTimer = null
    }

    private resolveBinaryPath(): string {
        const name = process.platform === "win32" ? "mic-capture.exe" : "mic-capture"
        if (app.isPackaged) return path.join(process.resourcesPath, "audio", name)
        return path.join(process.cwd(), "resources", "audio", name)
    }

    private log(...args: any[]) {
        if (DEBUG) console.log("[MicService]", ...args)
    }

    private error(...args: any[]) {
        console.error("[MicService]", ...args)
    }

    get running(): boolean {
        return this.isRunning
    }
}