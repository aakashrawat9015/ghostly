// src/main/services/AudioService.ts
import { spawn, ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import { app } from "electron"
import fs from "fs"
import net from "net"

const DEBUG = process.env.DEBUG === "true"
const TCP_PORT = 9001

const MAX_RESTART_ATTEMPTS = 3
const RESTART_BASE_DELAY_MS = 2000

export class AudioService {
    private proc: ChildProcessWithoutNullStreams | null = null
    private socket: net.Socket | null = null
    private onChunkCb: ((chunk: Buffer) => void) | null = null

    private restartAttempts = 0
    private isIntentionallyStopped = false
    private leftover: Buffer | null = null

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
        this.log("Spawning Rust Audio Server:", binaryPath)

        this.proc = spawn(binaryPath)

        this.proc.stderr.on("data", (data) => {
            this.log("Rust Log:", data.toString())
        })

        this.proc.on("error", (err) => {
            this.error("Spawn error:", err.message)
        })

        this.proc.on("close", (code) => {
            this.cleanupSocket()
            this.proc = null

            if (code === 0 || this.isIntentionallyStopped) return

            this.error("Process crashed:", code)
            this.scheduleRestart()
        })

        // Give the binary a moment to initialize WASAPI and open the port
        setTimeout(() => {
            this.connectToSocket()
        }, 200);
    }

    private connectToSocket(): void {
        // Ensure we don't have multiple sockets open
        this.cleanupSocket();

        this.socket = new net.Socket();

        this.socket.connect(TCP_PORT, "127.0.0.1", () => {
            this.log("✅ Connected to Rust Audio Server on port", TCP_PORT);
        });

        this.socket.on("data", (chunk: Buffer) => {
            this.handleChunk(chunk);
        });

        this.socket.on("error", (err: any) => { // ✅ Change 'err' to 'any'
            if (err?.code === 'ECONNREFUSED') {
                this.log("Server not ready yet, retrying in 200ms...");
                if (!this.isIntentionallyStopped) {
                    setTimeout(() => {
                        this.connectToSocket();
                    }, 200);
                }
            } else {
                this.error("Socket error:", err.message);
            }
        });


        this.socket.on("close", () => {
            this.log("Socket connection closed");
            if (!this.isIntentionallyStopped) {
                this.scheduleRestart();
            }
        });
    }

    private handleChunk(chunk: Buffer): void {
        if (this.leftover) {
            chunk = Buffer.concat([this.leftover, chunk])
            this.leftover = null
        }

        if (chunk.length % 2 !== 0) {
            this.leftover = chunk.subarray(chunk.length - 1)
            chunk = chunk.subarray(0, chunk.length - 1)
        }

        if (chunk.length === 0) return
        this.onChunkCb?.(chunk)
    }

    private killProcess(): void {
        this.cleanupSocket()
        if (!this.proc) return
        this.proc.removeAllListeners()
        this.proc.kill("SIGTERM")
        this.proc = null
    }

    private cleanupSocket(): void {
        if (this.socket) {
            this.socket.destroy()
            this.socket = null
        }
    }

    private scheduleRestart(): void {
        if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) return
        this.restartAttempts++

        const delay = (this.restartAttempts * RESTART_BASE_DELAY_MS) + (Math.random() * 500)

        setTimeout(() => {
            if (!this.isIntentionallyStopped) {
                this.killProcess()
                this.spawnProcess()
            }
        }, delay)
    }

    private resolveBinaryPath(): string {
        const name = process.platform === "win32" ? "audio-capture.exe" : "audio-capture"
        const devPath = path.join(__dirname, "../../../resources/audio", name)
        const prodPath = path.join(process.resourcesPath, "audio", name)
        const finalPath = app.isPackaged ? prodPath : devPath

        if (!fs.existsSync(finalPath)) {
            console.error("[AudioService] ❌ Binary NOT FOUND at:", finalPath)
        } else {
            this.log("✅ Binary found at:", finalPath)
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
