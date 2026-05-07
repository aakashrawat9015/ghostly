// src/main/services/MeetingDetector.ts
const DEBUG = process.env.DEBUG === "true"

type Callback = () => void

export class MeetingDetector {
    private onStartCb?: Callback
    private onEndCb?: Callback

    private startTimer?: NodeJS.Timeout
    private endTimer?: NodeJS.Timeout
    private running = false

    constructor(
        private options: { startAfterMs?: number; endAfterMs?: number } = {}
    ) { }

    start() {
        if (this.running) return
        this.running = true

        const startAfterMs = this.options.startAfterMs ?? 2000
        const endAfterMs = this.options.endAfterMs ?? 30000

        this.log("MVP MeetingDetector started")

        this.startTimer = setTimeout(() => {
            if (!this.running) return
            this.log("Simulated: Meeting START")
            this.onStartCb?.()
        }, startAfterMs)

        this.endTimer = setTimeout(() => {
            if (!this.running) return
            this.log("Simulated: Meeting END")
            this.onEndCb?.()
        }, endAfterMs)
    }

    stop() {
        this.running = false
        if (this.startTimer) clearTimeout(this.startTimer)
        if (this.endTimer) clearTimeout(this.endTimer)
        this.startTimer = undefined
        this.endTimer = undefined
    }

    onMeetingStart(cb: Callback) {
        this.onStartCb = cb
    }

    onMeetingEnd(cb: Callback) {
        this.onEndCb = cb
    }

    private log(...args: any[]) {
        if (DEBUG) console.log("[MeetingDetector]", ...args)
    }
}