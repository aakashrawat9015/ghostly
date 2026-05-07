// audio.worker.ts
import { parentPort } from "worker_threads"
import { DeepgramService, STTMode } from "../../services/stt/DeepgramService"
import { GroqService } from "../../services/llm/GroqService"
import { MeetingAssistant } from "../../services/llm/MeetingAssistant"
import { cleanTranscript, isMeaningful, prepareForProcessing } from "../../utils/transcript"

const DEBUG_AUDIO = process.env.DEBUG_AUDIO === "true"
const DEBUG_LLM = process.env.DEBUG_LLM === "true"

// const TARGET_CHUNK_SIZE = 17640
const TARGET_CHUNK_SIZE = 6400

const FLUSH_AFTER_MS = 500
const PARTIAL_THROTTLE_MS = 200

const DEBOUNCE_MS = 600

let started = false
let dg: DeepgramService | null = null
let assistant: MeetingAssistant | null = null

let lastUpdate = Date.now()
let llmRunning = false

let lastPartial = ""
let lastFinal = ""
let lastPartialSentAt = 0
let hasNewFinal = false

let q: Buffer[] = []
let qBytes = 0
let lastAudioAt = 0

let flushTimer: NodeJS.Timeout | null = null
let statsTimer: NodeJS.Timeout | null = null
let llmTimer: NodeJS.Timeout | null = null

let bytesIn = 0
let framesOut = 0

function resetSessionState() {
    lastUpdate = Date.now()
    llmRunning = false

    lastPartial = ""
    lastFinal = ""
    lastPartialSentAt = 0
    hasNewFinal = false

    q = []
    qBytes = 0
    lastAudioAt = 0

    bytesIn = 0
    framesOut = 0

    assistant?.reset()
    parentPort?.postMessage({ type: "transcript-clear" })
}

function startAssistant() {
    if (assistant) return
    const key = process.env.GROQ_API_KEY
    if (!key) throw new Error("Missing GROQ_API_KEY")
    assistant = new MeetingAssistant(new GroqService(key), {
        enableRefinement: true
    })
}

// ✅ UPDATED: Two-stage processing with original preservation
async function tryLLM() {
    if (!started || !assistant) return
    if (llmRunning) return
    if (!hasNewFinal) return
    if (!lastFinal) return

    const now = Date.now()
    const msSinceUpdate = now - lastUpdate

    if (msSinceUpdate < DEBOUNCE_MS) return

    // Save current final before clearing flag
    const currentFinal = lastFinal

    // Clear flag to prevent reprocessing
    hasNewFinal = false
    llmRunning = true

    try {
        // ✅ NEW: Two-stage processing
        const { original, cleaned, shouldProcess } = prepareForProcessing(currentFinal)

        if (!shouldProcess) {
            if (DEBUG_LLM) {
                console.log(`[Worker] ⏭️ Not meaningful: "${original}"`)
            }
            llmRunning = false
            return
        }

        if (DEBUG_LLM) {
            console.log(`\n[Worker] 📝 ORIGINAL: "${original}"`)
            if (cleaned !== original) {
                console.log(`[Worker] 🧹 CLEANED:  "${cleaned}"`)
            }
            console.log(`[Worker] 🎯 Processing: "${cleaned}"`)
        }

        // MeetingAssistant now handles:
        // 1. Classification (via InputClassifier)
        // 2. Decision making (via DecisionEngine)  
        // 3. Response generation (via ResponseGenerator)
        // ✅ Use cleaned version for processing
        const result = await assistant.maybeAnswer(cleaned)

        if (result) {
            if (DEBUG_LLM) {
                console.log(`[Worker] ✅ Answer generated`)
                console.log(`  Intent: ${result.intent}`)
                console.log(`  Confidence: ${result.confidence}`)
                console.log(`  Text: "${result.text.substring(0, 100)}..."`)
            }

            // Send intent for UI status
            parentPort?.postMessage({
                type: "intent",
                payload: { intent: result.intent }
            })

            // Send answer
            parentPort?.postMessage({
                type: "result",
                payload: result
            })
        } else {
            if (DEBUG_LLM) {
                console.log(`[Worker] ⏭️ No response needed: "${cleaned.substring(0, 50)}..."`)
            }
        }
    } catch (e: any) {
        console.error(`[Worker] ❌ Error processing "${currentFinal}":`, e)
        parentPort?.postMessage({
            type: "error",
            payload: `Error: ${e?.message ?? e}`
        })
    } finally {
        llmRunning = false
    }
}

function startDeepgram(mode: STTMode = "general") {
    if (dg) return
    const apiKey = process.env.DEEPGRAM_API_KEY
    if (!apiKey) throw new Error("Missing DEEPGRAM_API_KEY")

    dg = new DeepgramService(apiKey)

    dg.start((text: string, isFinal: boolean) => {
        // ✅ Clean transcript immediately
        const cleaned = cleanTranscript(text)
        if (!cleaned) return

        if (isFinal) {
            // Skip duplicate finals
            if (cleaned === lastFinal) return

            lastFinal = cleaned
            lastPartial = ""
            lastUpdate = Date.now()

            // Add to conversation history
            assistant?.addFinalTranscript(cleaned)

            // Mark as ready for LLM processing
            hasNewFinal = true

            if (DEBUG_LLM) {
                console.log(`[STT FINAL] ${cleaned}`)
            }

            // Send to UI
            parentPort?.postMessage({
                type: "transcript-final",
                payload: cleaned
            })
            return
        }

        // PARTIAL TRANSCRIPT HANDLING

        // Skip duplicate partials
        if (cleaned === lastPartial) return

        lastPartial = cleaned

        // ✅ Filter out meaningless partials (not requiring question format)
        if (!isMeaningful(cleaned, false)) return

        // Throttle partial updates
        const now = Date.now()
        if (now - lastPartialSentAt < PARTIAL_THROTTLE_MS) return
        lastPartialSentAt = now

        // Send to UI
        parentPort?.postMessage({
            type: "transcript-partial",
            payload: cleaned
        })
    })
}

async function stopDeepgram() {
    if (!dg) return
    try {
        await dg.finish(1500)
    } finally {
        dg = null
    }
}

function qPush(b: Buffer) {
    q.push(b)
    qBytes += b.length
}

function qDrainExact(n: number): Buffer | null {
    if (qBytes < n) return null
    const out = Buffer.allocUnsafe(n)
    let off = 0
    while (off < n) {
        const head = q[0]!
        const take = Math.min(head.length, n - off)
        head.copy(out, off, 0, take)
        off += take
        if (take === head.length) q.shift()
        else q[0] = head.subarray(take)
        qBytes -= take
    }
    return out
}

function flushRemainder(reason: "timeout" | "stop") {
    if (!dg || qBytes === 0) return
    const merged = Buffer.concat(q, qBytes)
    q = []
    qBytes = 0
    dg.sendAudio(merged)
    if (DEBUG_AUDIO) {
        console.log(`[Worker] Sent audio remainder (${reason}): ${merged.length} bytes`)
    }
}

function startTimers() {
    if (!flushTimer) {
        flushTimer = setInterval(() => {
            if (!started || !dg || qBytes === 0) return
            if (Date.now() - lastAudioAt < FLUSH_AFTER_MS) return
            flushRemainder("timeout")
        }, 100)
        flushTimer.unref?.()
    }

    if (!llmTimer) {
        llmTimer = setInterval(tryLLM, 150)
        llmTimer.unref?.()
    }

    if (DEBUG_AUDIO && !statsTimer) {
        statsTimer = setInterval(() => {
            console.log(`[AudioStats] in=${bytesIn}/s framesOut=${framesOut}/s buffered=${qBytes}`)
            bytesIn = 0
            framesOut = 0
        }, 1000)
        statsTimer.unref?.()
    }
}

function stopTimers() {
    if (flushTimer) clearInterval(flushTimer)
    if (llmTimer) clearInterval(llmTimer)
    if (statsTimer) clearInterval(statsTimer)
    flushTimer = llmTimer = statsTimer = null
}

// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════

parentPort?.on("message", async (msg) => {
    if (msg.type === "start") {
        if (started) return
        started = true
        resetSessionState()
        startAssistant()
        startDeepgram(msg.mode)
        startTimers()
        console.log(`[Worker] ✅ Started (mode: ${msg.mode || "general"})`)
        return
    }

    if (msg.type === "set-mode") {
        console.log(`[Worker] 🔄 Switching to mode: ${msg.mode}`)
        if (started) {
            flushRemainder("stop")
            await stopDeepgram()
            startDeepgram(msg.mode)
        }
        return
    }

    if (msg.type === "audio-chunk") {
        if (!started || !dg) return

        const u8 = new Uint8Array(msg.payload)
        const b = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)

        lastAudioAt = Date.now()
        qPush(b)
        if (DEBUG_AUDIO) bytesIn += b.length

        while (qBytes >= TARGET_CHUNK_SIZE) {
            const frame = qDrainExact(TARGET_CHUNK_SIZE)!
            dg.sendAudio(frame)
            if (DEBUG_AUDIO) framesOut++
        }
        return
    }

    if (msg.type === "stop") {
        if (!started) return
        started = false

        flushRemainder("stop")
        await stopDeepgram()
        stopTimers()
        resetSessionState()

        assistant = null
        console.log("[Worker] ⏹️ Stopped")
    }
})