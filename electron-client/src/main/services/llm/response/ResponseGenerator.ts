import type { GroqService } from "../GroqService"
import type { ResponseContext, GeneratedResponse } from "./types"
import { ResponseDeduplicator } from "./dedup"
import { checkResponseQuality } from "./quality"
import { cleanText } from "../filters"
import { PROMPTS, buildUserPrompt } from "../prompts"
import { parentPort } from "worker_threads"

const DEBUG = process.env.DEBUG_LLM === "true"

export class ResponseGenerator {
    private deduplicator = new ResponseDeduplicator()

    constructor(private groq: GroqService) { }

    async generate(context: ResponseContext): Promise<GeneratedResponse | null> {
        const { input, inputType, intent, conversationHistory, previousQA } = context

        // Build prompt
        const intentKey = (intent === "none" ? "question" : intent) as Exclude<typeof intent, "none">
        const systemPrompt = PROMPTS[intentKey]

        const userPrompt = inputType === "followup" && previousQA
            ? this.buildFollowUpPrompt(input, conversationHistory, previousQA)
            : buildUserPrompt(conversationHistory, input, intentKey)

        if (DEBUG) {
            console.log(`\n[ResponseGenerator] 🤖 Generating response (streaming)...`)
            console.log(`  Intent: ${intent}`)
            console.log(`  Type: ${inputType}`)
            console.log(`  Input: "${input}"`)
        }

        // ✅ Stream tokens to overlay as they arrive
        const raw = await this.groq.generateAnswerStream({
            transcript: conversationHistory,
            systemPrompt,
            userPrompt,
            maxTokens: 150,      // was 350 — shorter answers, much faster first token
            temperature: 0.15,   // slightly lower = less sampling overhead
            onChunk: (_chunk, accumulated) => {
                try {
                    parentPort?.postMessage({
                        type: "result-chunk",
                        payload: { chunk: _chunk, accumulated }
                    })
                } catch {
                    // worker may be shutting down
                }
            }
        })

        const cleaned = cleanText(raw)
        if (!cleaned) {
            if (DEBUG) console.log(`[ResponseGenerator] ❌ Empty response`)
            return null
        }

        // Quality check
        const qualityCheck = checkResponseQuality(cleaned)
        if (!qualityCheck.isValid) {
            if (DEBUG) console.log(`[ResponseGenerator] ❌ ${qualityCheck.reason}`)
            return null
        }

        // Deduplication check
        const now = Date.now()
        if (this.deduplicator.isDuplicate(cleaned, now)) {
            if (DEBUG) console.log(`[ResponseGenerator] ❌ Duplicate answer`)
            return null
        }

        this.deduplicator.recordAnswer(cleaned, now)

        const confidence = qualityCheck.isContextWarning ? 0.5 : 0.85

        if (DEBUG) {
            console.log(`[ResponseGenerator] ✅ Generated (${cleaned.length} chars, conf: ${confidence})`)
        }

        return {
            text: cleaned,
            confidence,
        }
    }

    // ✅ Separate function for follow-ups
    private buildFollowUpPrompt(
        input: string,
        conversationHistory: string,
        previousQA: { question: string; answer: string }
    ): string {
        const ctx = conversationHistory.slice(-300)
        return `Prev Q: "${previousQA.question}"\nPrev A: "${previousQA.answer}"\nFollow-up: "${input}"\n${ctx ? `Context: ${ctx}` : ""}\nAdd detail, don't repeat. Max 3 bullets.`
    }

    reset() {
        this.deduplicator.reset()
    }
}