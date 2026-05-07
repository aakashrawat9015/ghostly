// src/main/services/stt/DeepgramService.ts
import WebSocket from "ws"

const DEBUG = process.env.DEBUG_DG_RAW === "true"

export type STTMode = "technical" | "general" | "meeting"

const KEEPALIVE_INTERVAL = 5000
const RECONNECT_DELAY = 2000
const MAX_QUEUE_SIZE = 100
const MIN_CONFIDENCE_PARTIAL = 0.7 // 70% se kam confidence wale partial ignore
const MIN_AUDIO_CHUNK_SIZE = 3200 // 100ms @ 16kHz - chhote chunks skip

// ✅ MASTER KEYWORD LIST - 20 words max, high impact wale
const TECHNICAL_KEYWORDS = [
    "ChatGPT:10", "Claude:10", "Groq:10", "MCP:10", "Model Context Protocol:10",
    "JavaScript:10", "TypeScript:10", "React:10", "Electron:10", "Node.js:8",
    "async:10", "await:10", "Promise:10", "callback:8", "API:8",
    "single-threaded:10", "multithreaded:10", "event loop:10", "WebSocket:8", "JSON:8"
]

const MEETING_KEYWORDS = [
    "agenda:8", "action items:8", "stakeholders:8", "deliverables:8",
    "timeline:8", "roadmap:8", "Q1:8", "Q2:8", "Q3:8", "Q4:8"
]

export class DeepgramService {
    private ws: WebSocket | null = null
    private connected = false
    private isConnecting = false
    private isStopped = false
    private currentMode: STTMode = "general"

    private keepaliveTimer?: NodeJS.Timeout
    private reconnectTimer?: NodeJS.Timeout

    private queue: Buffer[] = []
    private onTranscriptCb?: (text: string, isFinal: boolean) => void

    private audioBytesSent = 0
    private dynamicKeywords: string[] = [] // Runtime me add karne ke liye

    constructor(private apiKey: string) { }

    start(onTranscript: (text: string, isFinal: boolean) => void, mode: STTMode = "general") {
        if (this.connected || this.isConnecting) return
        this.isStopped = false
        this.onTranscriptCb = onTranscript
        this.currentMode = mode
        this.connect()
    }

    // ✅ Dynamic keywords - meeting context ke hisaab se
    setMeetingKeywords(words: string[]) {
        this.dynamicKeywords = words.slice(0, 10).map(w => `${w}:8`) // Max 10
        this.log(`Dynamic keywords set:`, this.dynamicKeywords)
    }

    private generateUrl(mode: STTMode): string {
        const baseUrl = "wss://api.deepgram.com/v1/listen"
        const params = new URLSearchParams({
            model: "nova-3",
            language: "en-US",
            encoding: "linear16",
            sample_rate: "16000",
            channels: "1",
            interim_results: "true",
            punctuate: "true",
            smart_format: "true",
            vad_events: "true",
            endpointing: "300", // 300ms silence = final
            utterance_end_ms: "1000", // ✅ 1s pause = new utterance
            profanity_filter: "false", // ✅ "async" block na ho
            diarize: "false", // Single speaker
        })

        // ✅ Mode-specific config
        if (mode === "technical") {
            params.set("prompt", "Technical software engineering discussion about JavaScript, TypeScript, React, MCP, Claude, Electron, async await, promises, event loop, API, WebSocket, Node.js.")

            // Base keywords + dynamic keywords
            const allKeywords = [...TECHNICAL_KEYWORDS, ...this.dynamicKeywords]
            allKeywords.forEach(kw => {
                params.append("keywords", kw)
            })

        } else if (mode === "meeting") {
            params.set("prompt", "Formal business meeting discussing project timelines, action items, agendas, and stakeholder updates.")

            MEETING_KEYWORDS.forEach(kw => {
                params.append("keywords", kw)
            })
        }

        return `${baseUrl}?${params.toString()}`
    }

    private connect() {
        if (this.isStopped) return
        this.isConnecting = true

        const url = this.generateUrl(this.currentMode)
        this.log(`Connecting to Deepgram (${this.currentMode} mode)...`)
        if (DEBUG) this.log(`URL: ${url}`)

        this.ws = new WebSocket(url, {
            headers: { Authorization: `Token ${this.apiKey}` },
        })

        this.ws.on("open", () => {
            this.connected = true
            this.isConnecting = false
            this.log("✅ Connected to Deepgram")
            this.startKeepalive()
            this.flushQueue()
        })

        this.ws.on("message", (data) => {
            const raw = Buffer.isBuffer(data) ? data.toString("utf-8") : data.toString()
            if (DEBUG) console.log("[DG RAW]:", raw)

            try {
                const msg = JSON.parse(raw)

                // Skip metadata events
                if (msg.type === "Metadata" || msg.type === "UtteranceEnd" || msg.type === "SpeechStarted") {
                    if (DEBUG) this.log(`Event: ${msg.type}`)
                    return
                }

                const alt = msg.channel?.alternatives?.[0]
                const text = alt?.transcript?.trim() || ""
                const isFinal = msg.is_final === true
                const confidence = alt?.confidence || 0

                if (!text) return

                // ✅ FIX 1: Low confidence partial ignore karo
                if (!isFinal && confidence < MIN_CONFIDENCE_PARTIAL) {
                    if (DEBUG) this.log(`Skipping low conf partial: ${confidence.toFixed(2)} | "${text}"`)
                    return
                }

                // ✅ FIX 2: Confidence log karo final ke liye
                if (isFinal && DEBUG) {
                    this.log(`Final: ${confidence.toFixed(2)} | "${text}"`)
                }

                this.onTranscriptCb?.(text, isFinal)

            } catch (err) {
                if (DEBUG) this.error("Parse error:", err)
            }
        })

        this.ws.on("error", (err) => {
            this.error("WebSocket error:", err)
        })

        this.ws.on("close", (code, reason) => {
            this.connected = false
            this.isConnecting = false
            this.stopKeepalive()

            this.log(`Disconnected (code ${code}) reason: ${reason.toString()}`)

            if (!this.isStopped) {
                this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY)
            }
        })

        this.ws.on("pong", () => {
            if (DEBUG) this.log("Pong received")
        })
    }

    private startKeepalive() {
        this.stopKeepalive()
        this.keepaliveTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
            this.ws.ping()
            if (DEBUG) this.log("Keepalive ping")
        }, KEEPALIVE_INTERVAL)
    }

    private stopKeepalive() {
        if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
        this.keepaliveTimer = undefined
    }

    sendAudio(chunk: Buffer) {
        // ✅ FIX 3: Chhote chunks skip karo - hallucination kam hota
        if (chunk.length < MIN_AUDIO_CHUNK_SIZE) {
            if (DEBUG) this.log(`Audio chunk too small: ${chunk.length} bytes, skipping`)
            return
        }

        if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(chunk, { binary: true })
            this.audioBytesSent += chunk.length
            return
        }

        this.queue.push(chunk)
        if (this.queue.length > MAX_QUEUE_SIZE) {
            this.queue.shift()
            if (DEBUG) this.log("Queue full, dropping oldest chunk")
        }
    }

    private flushQueue() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
        const count = this.queue.length
        while (this.queue.length) {
            const b = this.queue.shift()
            if (b) this.ws.send(b, { binary: true })
        }
        if (count > 0) this.log(`Flushed ${count} queued chunks`)
    }

    async finish(timeoutMs = 1200): Promise<void> {
        this.isStopped = true

        if (!this.ws) return

        const ws = this.ws

        if (ws.readyState !== WebSocket.OPEN) {
            this.stop()
            return
        }

        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => resolve(), timeoutMs)

            ws.once("close", () => {
                clearTimeout(timer)
                resolve()
            })

            try {
                ws.send(JSON.stringify({ type: "CloseStream" }))
            } catch { }

            try {
                ws.close(1000, "finish")
            } catch { }
        })

        this.stop()
    }

    stop() {
        this.log("Stopping Deepgram service")
        this.log("Total audio sent in session:", this.audioBytesSent, "bytes")

        this.isStopped = true
        this.connected = false
        this.isConnecting = false
        this.queue = []
        this.dynamicKeywords = []

        this.stopKeepalive()
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

        this.ws?.removeAllListeners()
        try {
            this.ws?.close()
        } catch { }
        this.ws = null
    }

    private log(...args: unknown[]) {
        if (DEBUG) console.log("[Deepgram]", ...args)
    }

    private error(...args: unknown[]) {
        console.error("[Deepgram]", ...args)
    }
}