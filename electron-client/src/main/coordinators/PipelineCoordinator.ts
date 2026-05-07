import { AudioService } from "../services/AudioService"
import { WorkerBridge } from "../workers/WorkerBridge"
import { MeetingDetector } from "../services/MeetingDetector"
import { MicService } from "../services/MicService"
import { STTMode } from "../services/stt/DeepgramService"

const DEBUG = process.env.DEBUG === "true"

export class PipelineCoordinator {
    private detector = new MeetingDetector({ endAfterMs: 300_000 })
    private isRunning = false
    private currentMode: STTMode = "general"

    // ── Accept services from outside — no new instances here ──
    constructor(
        private audio: AudioService,
        private mic: MicService,
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
    startPipeline() {
        if (this.isRunning) return
        this.isRunning = true
        this.bridge.start(this.currentMode)
        // System audio
        this.audio.startCapture((chunk) => this.bridge.sendAudioChunk(chunk))
        // Mic audio
        // this.mic.start((chunk) => this.bridge.sendAudioChunk(chunk))
    }

    setMode(mode: STTMode) {
        this.log(`Setting STT mode to: ${mode}`)
        this.currentMode = mode
        this.bridge.setMode(mode)
    }

    stopPipeline() {
        if (!this.isRunning) return
        this.isRunning = false
        this.audio.stopCapture()
        this.mic.stop()
        this.bridge.stop()
    }

    get running() { return this.isRunning }

    private log(...args: any[]) {
        if (DEBUG) console.log("[PipelineCoordinator]", ...args)
    }
}