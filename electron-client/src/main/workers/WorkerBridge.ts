import { Worker } from "worker_threads"
import type { AIResult, AIIntent } from "../services/llm/types"
import type { STTMode } from "../services/stt/DeepgramService"

const DEBUG = process.env.DEBUG === "true"
const DEBUG_AUDIO = process.env.DEBUG_AUDIO === "true"

// Batch audio before sending to worker (reduces message spam)
const FLUSH_INTERVAL_MS = 20  // was 50ms — 50x/sec instead of 20x/sec
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024 // 2MB safety cap

const RESTART_DELAY_MS = 1000

export type WorkerRequest =
    | { type: "audio-chunk"; payload: ArrayBuffer }
    | { type: "start"; mode?: STTMode }
    | { type: "stop" }
    | { type: "set-mode"; mode: STTMode }

export type WorkerResponse =
    | { type: "result"; payload: AIResult }
    | { type: "result-chunk"; payload: { chunk: string; accumulated: string } }
    | { type: "intent"; payload: AIIntent }
    | { type: "summary"; payload: string }
    | { type: "error"; payload: string }
    | { type: "log"; payload: string }
    | { type: "transcript-partial"; payload: string }
    | { type: "transcript-final"; payload: string }
    | { type: "transcript-clear" }

type ResultCallback = (data: AIResult) => void
type ResultChunkCallback = (data: { chunk: string; accumulated: string }) => void
type IntentCallback = (data: AIIntent) => void
type SummaryCallback = (text: string) => void
type ErrorCallback = (err: string) => void
type LogCallback = (msg: string) => void
type TranscriptPartialCallback = (text: string) => void
type TranscriptFinalCallback = (text: string) => void
type TranscriptClearCallback = () => void

export class WorkerBridge {
    private worker: Worker | null = null
    private isTerminated = false

    private onResultCb?: ResultCallback
    private onResultChunkCb?: ResultChunkCallback
    private onIntentCb?: IntentCallback
    private onSummaryCb?: SummaryCallback
    private onErrorCb?: ErrorCallback
    private onLogCb?: LogCallback
    private onTranscriptPartialCb?: TranscriptPartialCallback
    private onTranscriptFinalCb?: TranscriptFinalCallback
    private onTranscriptClearCb?: TranscriptClearCallback

    // --- batching state ---
    private audioParts: Buffer[] = []
    private audioBytes = 0
    private flushTimer: NodeJS.Timeout | null = null

    private droppedBytes = 0
    private lastDropLogAt = 0

    constructor(private factory: () => Worker) {
        this.initWorker()
        this.startFlusher()
    }

    private initWorker() {
        if (this.worker) {
            this.worker.removeAllListeners()
            this.worker.terminate()
        }
        this.worker = this.factory()
        this.attach()
    }

    private attach() {
        if (!this.worker) return

        this.worker.on("message", (msg: WorkerResponse) => {
            if (msg.type === "result") this.onResultCb?.(msg.payload)
            if (msg.type === "result-chunk") this.onResultChunkCb?.(msg.payload)
            if (msg.type === "intent") this.onIntentCb?.(msg.payload)
            if (msg.type === "summary") this.onSummaryCb?.(msg.payload)
            if (msg.type === "error") this.onErrorCb?.(msg.payload)
            if (msg.type === "log") this.onLogCb?.(msg.payload)
            if (msg.type === "transcript-partial") this.onTranscriptPartialCb?.(msg.payload)
            if (msg.type === "transcript-final") this.onTranscriptFinalCb?.(msg.payload)
            if (msg.type === "transcript-clear") this.onTranscriptClearCb?.()
        })

        this.worker.on("exit", (code) => {
            if (code !== 0 && !this.isTerminated) {
                this.log(`Worker crashed (code ${code}), restarting...`)
                setTimeout(() => this.initWorker(), RESTART_DELAY_MS)
            }
        })

        this.worker.on("error", (err) => {
            this.error("Worker error:", err)
            this.onErrorCb?.(err.message)
        })
    }

    /**
     * Public API: push audio into buffer. We'll batch + post on timer.
     */
    sendAudioChunk(chunk: Buffer) {
        const worker = this.worker
        if (!worker || this.isTerminated) return

        this.audioParts.push(chunk)
        this.audioBytes += chunk.length

        // Hard cap memory; drop oldest if needed (throttled logging)
        if (this.audioBytes > MAX_BUFFERED_BYTES) {
            while (this.audioBytes > MAX_BUFFERED_BYTES && this.audioParts.length > 0) {
                const dropped = this.audioParts.shift()!
                this.audioBytes -= dropped.length
                this.droppedBytes += dropped.length
            }

            const now = Date.now()
            if (now - this.lastDropLogAt > 2000) {
                this.lastDropLogAt = now
                this.error(
                    `Audio buffer overflow: dropped ${this.droppedBytes} bytes total (increase MAX_BUFFERED_BYTES or lower FLUSH_INTERVAL_MS)`
                )
            }
        }
    }

    /**
     * Flush batched audio to worker as ONE message.
     */
    private flushAudioToWorker() {
        const worker = this.worker
        if (!worker || this.isTerminated) return
        if (this.audioBytes === 0) return

        const merged = Buffer.concat(this.audioParts, this.audioBytes)
        this.audioParts = []
        this.audioBytes = 0

        const payload = toTransferableArrayBuffer(merged)

        try {
            worker.postMessage({ type: "audio-chunk", payload }, [payload])
            if (DEBUG_AUDIO) this.log(`Posted audio batch to worker: ${merged.length} bytes`)
        } catch (err) {
            this.error("postMessage(audio-chunk) failed:", err)
            // If this happens, just drop—otherwise you'll loop and blow memory.
        }
    }

    private startFlusher() {
        if (this.flushTimer) return
        this.flushTimer = setInterval(() => this.flushAudioToWorker(), FLUSH_INTERVAL_MS)
        this.flushTimer.unref?.()
    }

    start(mode?: STTMode) {
        this.worker?.postMessage({ type: "start", mode })
    }

    setMode(mode: STTMode) {
        this.worker?.postMessage({ type: "set-mode", mode })
    }

    stop() {
        // ✅ important: send any buffered audio before telling worker to stop
        this.flushAudioToWorker()
        this.worker?.postMessage({ type: "stop" })
    }

    onResult(cb: ResultCallback) { this.onResultCb = cb }
    onResultChunk(cb: ResultChunkCallback) { this.onResultChunkCb = cb }
    onIntent(cb: IntentCallback) { this.onIntentCb = cb }
    onSummary(cb: SummaryCallback) { this.onSummaryCb = cb }
    onError(cb: ErrorCallback) {
        this.onErrorCb = cb
    }
    onLog(cb: LogCallback) {
        this.onLogCb = cb
    }
    onTranscriptPartial(cb: TranscriptPartialCallback) {
        this.onTranscriptPartialCb = cb
    }
    onTranscriptFinal(cb: TranscriptFinalCallback) {
        this.onTranscriptFinalCb = cb
    }
    onTranscriptClear(cb: TranscriptClearCallback) {
        this.onTranscriptClearCb = cb
    }

    terminate() {
        this.isTerminated = true

        if (this.flushTimer) {
            clearInterval(this.flushTimer)
            this.flushTimer = null
        }

        // flush attempt (optional)
        try {
            this.flushAudioToWorker()
        } catch {
            // ignore
        }

        if (this.worker) {
            this.worker.removeAllListeners()
            this.worker.terminate()
            this.worker = null
        }
    }

    private log(...args: any[]) {
        if (DEBUG) console.log("[WorkerBridge]", ...args)
    }
    private error(...args: any[]) {
        console.error("[WorkerBridge]", ...args)
    }
}

/**
 * Create a true transferable ArrayBuffer.
 * Handles Node’s typing where Buffer.buffer can be ArrayBuffer | SharedArrayBuffer.
 */
function toTransferableArrayBuffer(buf: Buffer): ArrayBuffer {
    const backing = buf.buffer
    if (backing instanceof ArrayBuffer) {
        return backing.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }

    // SharedArrayBuffer: not transferable -> copy into ArrayBuffer
    const ab = new ArrayBuffer(buf.byteLength)
    new Uint8Array(ab).set(buf)
    return ab
}