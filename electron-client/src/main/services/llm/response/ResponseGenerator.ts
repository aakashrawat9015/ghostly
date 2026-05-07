import type { GroqService } from "../GroqService"
import type { ResponseContext, GeneratedResponse } from "./types"
import { ResponseDeduplicator } from "./dedup"
import { checkResponseQuality } from "./quality"
import { cleanText } from "../filters"
import { PROMPTS, buildUserPrompt } from "../prompts"  // ✅ Import the good one!

const DEBUG = process.env.DEBUG_LLM === "true"

export class ResponseGenerator {
    private deduplicator = new ResponseDeduplicator()

    constructor(private groq: GroqService) { }

    async generate(context: ResponseContext): Promise<GeneratedResponse | null> {
        const { input, inputType, intent, conversationHistory, previousQA } = context

        // Build prompt
        const intentKey = (intent === "none" ? "question" : intent) as Exclude<typeof intent, "none">
        const systemPrompt = PROMPTS[intentKey]

        // ✅ FIX: Use the imported function, not local one
        const userPrompt = inputType === "followup" && previousQA
            ? this.buildFollowUpPrompt(input, conversationHistory, previousQA)
            : buildUserPrompt(conversationHistory, input, intentKey)  // ✅ From prompts.ts

        if (DEBUG) {
            console.log(`\n[ResponseGenerator] 🤖 Generating response...`)
            console.log(`  Intent: ${intent}`)
            console.log(`  Type: ${inputType}`)
            console.log(`  Input: "${input}"`)
            console.log(`\n[ResponseGenerator] 📨 User Prompt:`)
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            console.log(userPrompt)
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
        }

        // Call LLM
        const raw = await this.groq.generateAnswer({
            transcript: conversationHistory,
            systemPrompt,
            userPrompt,
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

        // Record and return
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
        return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOLLOW-UP QUESTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Previous Question:
"${previousQA.question}"

Previous Answer:
"${previousQA.answer}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT FOLLOW-UP:
"${input}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Provide MORE DETAILS, examples, or deeper explanation.
- Build on the previous answer
- Add technical specifics
- DO NOT repeat what was already said
- Max 3-4 lines

Context:
${conversationHistory}`
    }

    reset() {
        this.deduplicator.reset()
    }
}