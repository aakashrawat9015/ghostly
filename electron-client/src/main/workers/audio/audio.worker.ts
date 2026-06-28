// audio.worker.ts
import { parentPort } from "worker_threads"
import { DeepgramService, STTMode } from "../../services/stt/DeepgramService"
import { GroqService } from "../../services/llm/GroqService"
import { MeetingAssistant } from "../../services/llm/MeetingAssistant"
import { CorrectionAgent } from "../../services/llm/CorrectionAgent"
import { ProjectIndexer } from "../../utils/ProjectIndexer"
import { cleanTranscript, isMeaningful, prepareForProcessing } from "../../utils/transcript"

const DEBUG_AUDIO = process.env.DEBUG_AUDIO === "true"
const DEBUG_LLM   = process.env.DEBUG_LLM   === "true"

const TARGET_CHUNK_SIZE   = 3200   // 100ms @ 16kHz
const FLUSH_AFTER_MS      = 50     // drain to Deepgram after 50ms silence (was 150ms)
const PARTIAL_THROTTLE_MS = 50     // partial UI update throttle (was 80ms)
const DEBOUNCE_MS         = 50     // final transcript debounce (was 150ms)

const SUMMARY_IDLE_MS  = 30_000
const SUMMARY_MIN_FINALS = 5

// Early-trigger: fire Groq on a partial that already looks like a complete question.
// If the final arrives within this window for the same question, skip it.
const EARLY_TRIGGER_WINDOW_MS = 8000

// ── State ─────────────────────────────────────────────────────
let started    = false
let dg: DeepgramService | null = null
let assistant: MeetingAssistant | null = null
let groq: GroqService | null = null
let correctionAgent: CorrectionAgent | null = null
let projectIndexer: ProjectIndexer | null = null
let activeFilePath = ""

let lastUpdate  = Date.now()
let llmRunning  = false
let lastQAAt    = 0
let summaryRunning = false
let summaryBuffer: string[] = []

let lastPartial      = ""
let lastFinal        = ""
let lastPartialSentAt = 0
let hasNewFinal      = false

// Track early-trigger so the final doesn't double-fire
let earlyTriggerText = ""
let earlyTriggerAt   = 0

let q: Buffer[] = []
let qBytes = 0
let lastAudioAt = 0

let flushTimer:   NodeJS.Timeout | null = null
let llmTimer:     NodeJS.Timeout | null = null
let summaryTimer: NodeJS.Timeout | null = null
let statsTimer:   NodeJS.Timeout | null = null

let bytesIn  = 0
let framesOut = 0

// ── Helpers ───────────────────────────────────────────────────

function resetSessionState() {
    lastUpdate  = Date.now()
    llmRunning  = false
    lastQAAt    = 0
    summaryRunning = false
    summaryBuffer  = []

    lastPartial       = ""
    lastFinal         = ""
    lastPartialSentAt = 0
    hasNewFinal       = false
    earlyTriggerText  = ""
    earlyTriggerAt    = 0

    q      = []
    qBytes = 0
    lastAudioAt = 0
    bytesIn  = 0
    framesOut = 0

    assistant?.reset()
    parentPort?.postMessage({ type: "transcript-clear" })
}

function startAssistant() {
    if (assistant) return
    const key = process.env.GROQ_API_KEY
    if (!key) throw new Error("Missing GROQ_API_KEY")
    groq = new GroqService(key)
    assistant = new MeetingAssistant(groq, { enableRefinement: false })
    // ProjectIndexer is created here; symbols are populated via set-project-symbols message
    projectIndexer = new ProjectIndexer()
    correctionAgent = new CorrectionAgent(projectIndexer)
}

/**
 * Returns true if the partial already looks like a complete question —
 * strong enough signal to fire Groq before Deepgram finalises.
 */
function looksLikeCompleteQuestion(text: string): boolean {
    const t = text.trim()
    if (!t.endsWith("?")) return false
    if (t.split(/\s+/).length < 4) return false
    const lower = t.toLowerCase()
    // Block social / rhetorical tails
    if (/^(hey|hi|hello|how are|how have|how's|what's up)\b/.test(lower)) return false
    if (/^(right|ok|okay|yeah|correct|huh|really)\?$/.test(lower)) return false
    return true
}

/** Jaccard word-overlap similarity (0–1) */
function stringSimilarity(a: string, b: string): number {
    const wa = new Set(a.toLowerCase().split(/\s+/))
    const wb = new Set(b.toLowerCase().split(/\s+/))
    const inter = [...wa].filter(w => wb.has(w)).length
    const union = new Set([...wa, ...wb]).size
    return union === 0 ? 0 : inter / union
}

// ── Core LLM runner ───────────────────────────────────────────

async function tryLLMWithText(text: string, source: "partial" | "final") {
    if (!started || !assistant) return
    if (llmRunning) return

    const { cleaned, shouldProcess } = prepareForProcessing(text)
    if (!shouldProcess) return

    llmRunning = true
    if (DEBUG_LLM) console.log(`[Worker] ⚡ ${source.toUpperCase()}: "${cleaned.slice(0, 70)}..."`)

    try {
        const result = await assistant.maybeAnswer(cleaned)

        if (result) {
            if (DEBUG_LLM) console.log(`[Worker] ✅ Answer (${source}): "${result.text.slice(0, 80)}..."`)

            lastQAAt = Date.now()
            summaryBuffer = []

            if (source === "partial") {
                earlyTriggerText = cleaned
                earlyTriggerAt   = Date.now()
            }

            parentPort?.postMessage({ type: "intent",  payload: { intent: result.intent } })
            parentPort?.postMessage({ type: "result",  payload: result })
        } else {
            if (DEBUG_LLM) console.log(`[Worker] ⏭️ No response (${source}): "${cleaned.slice(0, 50)}..."`)
        }
    } catch (e: any) {
        console.error(`[Worker] ❌ LLM error (${source}):`, e?.message)
        parentPort?.postMessage({ type: "error", payload: `Error: ${e?.message ?? e}` })
    } finally {
        llmRunning = false
    }
}

async function tryLLM() {
    if (!started || !assistant) return
    if (llmRunning) return
    if (!hasNewFinal || !lastFinal) return
    if (Date.now() - lastUpdate < DEBOUNCE_MS) return

    const currentFinal = lastFinal
    hasNewFinal = false

    // Skip if we already answered this via early partial trigger
    if (earlyTriggerText && (Date.now() - earlyTriggerAt) < EARLY_TRIGGER_WINDOW_MS) {
        const { cleaned } = prepareForProcessing(currentFinal)
        if (cleaned && (
            cleaned.includes(earlyTriggerText) ||
            earlyTriggerText.includes(cleaned)  ||
            stringSimilarity(cleaned, earlyTriggerText) > 0.8
        )) {
            if (DEBUG_LLM) console.log(`[Worker] ⏭️ Final skipped — already answered via early trigger`)
            return
        }
    }

    await tryLLMWithText(currentFinal, "final")
}

// ── Summary ───────────────────────────────────────────────────

async function trySummary() {
    if (!started || !groq) return
    if (summaryRunning || llmRunning) return
    if (summaryBuffer.length < SUMMARY_MIN_FINALS) return

    const now = Date.now()
    const idleSinceQA = now - (lastQAAt || now - SUMMARY_IDLE_MS - 1)
    if (idleSinceQA < SUMMARY_IDLE_MS) return

    summaryRunning = true
    const text = summaryBuffer.join(" ")
    summaryBuffer = []
    lastQAAt = now

    if (DEBUG_LLM) console.log(`[Worker] 📋 Summary: "${text.slice(0, 80)}..."`)

    try {
        const summary = await groq.generateAnswer({
            transcript: text,
            systemPrompt: `Live meeting assistant. Summarize in 2-3 tight bullet points.
- Each bullet max 12 words. Start with •. No intro text.`,
            userPrompt: `Summarize:\n"${text}"`,
            temperature: 0.2,
            maxTokens: 120,
        })
        if (summary && summary !== "No answer generated.") {
            parentPort?.postMessage({ type: "summary", payload: summary })
        }
    } catch (e: any) {
        console.error("[Worker] Summary error:", e?.message)
    } finally {
        summaryRunning = false
    }
}

// ── Deepgram ──────────────────────────────────────────────────

function startDeepgram(mode: STTMode = "general") {
    if (dg) return
    const apiKey = process.env.DEEPGRAM_API_KEY
    if (!apiKey) throw new Error("Missing DEEPGRAM_API_KEY")

    dg = new DeepgramService(apiKey)

    dg.start((text: string, isFinal: boolean) => {
        const cleaned = cleanTranscript(text)
        if (!cleaned) return

        if (isFinal) {
            if (cleaned === lastFinal) return

            lastFinal   = cleaned
            lastPartial = ""
            lastUpdate  = Date.now()

            assistant?.addFinalTranscript(cleaned)
            summaryBuffer.push(cleaned)
            hasNewFinal = true

            if (DEBUG_LLM) console.log(`[STT FINAL] ${cleaned}`)

            parentPort?.postMessage({ type: "transcript-final", payload: cleaned })
            setTimeout(tryLLM, DEBOUNCE_MS)

            // Async correction — non-blocking
            if (correctionAgent) {
                correctionAgent.correct(cleaned, activeFilePath)
                    .then(({ corrected, latencyMs, usedFallback }) => {
                        if (!usedFallback && corrected !== cleaned) {
                            if (DEBUG_LLM) console.log(`[Correction] ${latencyMs}ms | "${cleaned}" → "${corrected}"`)
                            lastFinal = corrected
                            assistant?.addFinalTranscript(corrected)
                            parentPort?.postMessage({ type: "transcript-final-corrected", payload: corrected })
                        }
                    })
                    .catch(e => { if (DEBUG_LLM) console.error("[Correction] Error:", e?.message) })
            }
            return
        }

        // ── PARTIAL ──────────────────────────────────────────
        if (cleaned === lastPartial) return
        lastPartial = cleaned

        if (!isMeaningful(cleaned, false)) return

        const now = Date.now()
        if (now - lastPartialSentAt < PARTIAL_THROTTLE_MS) return
        lastPartialSentAt = now

        parentPort?.postMessage({ type: "transcript-partial", payload: cleaned })

        // ⚡ EARLY TRIGGER — fire Groq while speaker is still talking
        if (!llmRunning && looksLikeCompleteQuestion(cleaned)) {
            if (DEBUG_LLM) console.log(`[Worker] ⚡ Early trigger on partial: "${cleaned.slice(0, 60)}..."`)
            tryLLMWithText(cleaned, "partial")
        }
    }, mode)
}

async function stopDeepgram() {
    if (!dg) return
    try { await dg.finish(1500) } finally { dg = null }
}

// ── Audio queue ───────────────────────────────────────────────

function qPush(b: Buffer) { q.push(b); qBytes += b.length }

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
    q = []; qBytes = 0
    dg.sendAudio(merged)
    if (DEBUG_AUDIO) console.log(`[Worker] Flush (${reason}): ${merged.length} bytes`)
}

// ── Timers ────────────────────────────────────────────────────

function startTimers() {
    if (!flushTimer) {
        flushTimer = setInterval(() => {
            if (!started || !dg || qBytes === 0) return
            if (Date.now() - lastAudioAt < FLUSH_AFTER_MS) return
            flushRemainder("timeout")
        }, 50)
        flushTimer.unref?.()
    }
    if (!llmTimer) {
        llmTimer = setInterval(tryLLM, 500)  // safety net
        llmTimer.unref?.()
    }
    if (!summaryTimer) {
        summaryTimer = setInterval(trySummary, 5000)
        summaryTimer.unref?.()
    }
    if (DEBUG_AUDIO && !statsTimer) {
        statsTimer = setInterval(() => {
            console.log(`[AudioStats] in=${bytesIn}/s out=${framesOut}/s buf=${qBytes}`)
            bytesIn = framesOut = 0
        }, 1000)
        statsTimer.unref?.()
    }
}

function stopTimers() {
    if (flushTimer)   clearInterval(flushTimer)
    if (llmTimer)     clearInterval(llmTimer)
    if (summaryTimer) clearInterval(summaryTimer)
    if (statsTimer)   clearInterval(statsTimer)
    flushTimer = llmTimer = summaryTimer = statsTimer = null
}

// ── Message handler ───────────────────────────────────────────

parentPort?.on("message", async (msg) => {
    if (msg.type === "start") {
        if (started) return
        started = true
        resetSessionState()
        try {
            startAssistant()
            startDeepgram(msg.mode)
        } catch (err: any) {
            console.error("[Worker] Start failed:", err)
            parentPort?.postMessage({ type: "error", payload: err?.message ?? "Failed to start pipeline" })
            started = false
            return
        }
        startTimers()
        console.log(`[Worker] ✅ Started (mode: ${msg.mode || "general"})`)
        return
    }

    if (msg.type === "set-active-file") {
        activeFilePath = msg.payload ?? ""
        if (DEBUG_LLM) console.log(`[Worker] 📄 Active file: ${activeFilePath}`)
        return
    }

    if (msg.type === "set-project-symbols") {
        // Main process sends the full symbol list after indexing completes.
        // We inject it into the worker's ProjectIndexer via a lightweight method.
        if (projectIndexer && Array.isArray(msg.payload)) {
            projectIndexer.injectSymbols(msg.payload as string[])
            if (DEBUG_LLM) console.log(`[Worker] 📦 Received ${msg.payload.length} project symbols`)
        }
        return
    }

    if (msg.type === "set-mode") {
        console.log(`[Worker] 🔄 Mode: ${msg.mode}`)
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
        const b  = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)
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
        assistant = correctionAgent = projectIndexer = groq = null
        activeFilePath = ""
        console.log("[Worker] ⏹️ Stopped")
    }
})
