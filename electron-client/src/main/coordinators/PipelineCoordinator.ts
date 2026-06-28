import { WorkerBridge } from "../workers/WorkerBridge"
import { MeetingDetector } from "../services/MeetingDetector"
import { IAudioBackend } from "../services/audio/IAudioBackend"
import { STTMode } from "../services/stt/DeepgramService"

const DEBUG = process.env.DEBUG === "true"

export class PipelineCoordinator {
    private detector = new MeetingDetector({ endAfterMs: 300_000 })
    private isRunning = false
    private currentMode: STTMode = "general"

    // ── IAudioBackend replaces concrete AudioEngine ──
    constructor(
        private audio: IAudioBackend,
        private bridge: WorkerBridge
    ) { }

    start() {
        this.log("Starting coordinator")

        this.detector.onMeetingStart(() => {
            this.log("Meeting detected → starting pipeline")
            this.startPipeline()
        })

        this.detector.onMeetingEnd(() => {
            this.log("Meeting ended → stopping pipeline")
            this.stopPipeline()
        })

        this.detector.start()
    }

    stop() {
        this.stopPipeline()
        this.detector.stop()
    }

    // ── Called by IPC when user manually starts/stops ──────────

    async startPipeline() {
        if (this.isRunning) return
        this.isRunning = true
        this.bridge.start(this.currentMode)

        // System audio capture — backend is IAudioBackend (NativeAudioBackend)
        try {
            this.audio.startSystemAudioCapture((chunk) =>
                this.bridge.sendAudioChunk(chunk)
            )
            this.log("System audio capture active")
        } catch (err: any) {
            console.error(
                "[PipelineCoordinator] Failed to start system audio:",
                err.message
            )
            this.bridge.stop()
            this.isRunning = false
            return
        }

        // Mic capture — runs alongside system audio; both streams feed Deepgram
        try {
            this.audio.startMicCapture?.((chunk) =>
                this.bridge.sendAudioChunk(chunk)
            )
            this.log("Microphone capture active")
        } catch (err: any) {
            console.error("[PipelineCoordinator] Failed to start mic audio:", err.message)
        }
    }

    setMode(mode: STTMode) {
        this.log(`Setting STT mode to: ${mode}`)
        this.currentMode = mode
        this.bridge.setMode(mode)
    }

    stopPipeline() {
        if (!this.isRunning) return
        this.isRunning = false
        this.audio.stopAll()
        this.bridge.stop()
        this.log("Pipeline stopped")
    }

    get running() {
        return this.isRunning
    }

    private log(...args: any[]) {
        if (DEBUG) console.log("[PipelineCoordinator]", ...args)
    }
}
