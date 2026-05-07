// decision/DecisionEngine.ts

import type { DecisionContext, DecisionResult } from "./types"
import type { InputType } from "../classifier/types"

const DEBUG = process.env.DEBUG_LLM === "true"

export class DecisionEngine {
    private lastResponseTime: number = 0
    private responseCount: number = 0
    private sessionStartTime: number = Date.now()

    // ✅ AGGRESSIVE: Fast response for questions
    private readonly RATE_LIMITS: Record<InputType, number> = {
        new: 500,        // ✅ 0.5s for new questions
        followup: 300,   // ✅ 0.3s for follow-ups
        context: 2000,   // 2s for context
        ignore: 0,
    }

    private readonly MAX_RESPONSES_PER_MINUTE = 30  // ✅ Allow 30/min

    decide(context: DecisionContext): DecisionResult {
        const { classification, conversationContext, currentTime } = context

        // ═══════════════════════════════════════════════════════
        // 🛑 HARD BLOCKS (MINIMAL)
        // ═══════════════════════════════════════════════════════

        // 1. Ignore type only
        if (classification.type === "ignore") {
            return this.reject("Input type is ignore", 0.95)
        }

        // 2. Very low confidence (allow down to 0.3 for questions)
        const minConfidence = classification.intent === "question" ? 0.3 : 0.5

        if (classification.confidence < minConfidence) {
            return this.reject(`Low confidence: ${classification.confidence}`, 0.8)
        }

        // ═══════════════════════════════════════════════════════
        // ⏱️ RATE LIMITING (BYPASS FOR QUESTIONS)
        // ═══════════════════════════════════════════════════════

        const isQuestion = classification.intent === "question"
        const isProblem = classification.intent === "problem"

        // ✅ SKIP rate limit entirely for questions/problems
        if (!isQuestion && !isProblem) {
            const timeSinceLastResponse = currentTime - this.lastResponseTime
            const requiredDelay = this.RATE_LIMITS[classification.type]

            if (timeSinceLastResponse < requiredDelay) {
                const waitTime = requiredDelay - timeSinceLastResponse

                if (DEBUG) {
                    console.log(`[DecisionEngine] ⏱️ Rate limited (${timeSinceLastResponse}ms / ${requiredDelay}ms)`)
                }

                return this.reject(
                    `Rate limited: ${classification.type} needs ${requiredDelay}ms`,
                    0.9,
                    waitTime
                )
            }
        }

        // ═══════════════════════════════════════════════════════
        // 📊 CONTEXT CHECKS (RELAXED FOR QUESTIONS)
        // ═══════════════════════════════════════════════════════

        // ✅ ALLOW new questions even with NO context
        if (classification.type === "new" && isQuestion) {
            if (DEBUG) {
                console.log(`[DecisionEngine] ✅ New question - allowing regardless of context`)
            }
        }

        // For follow-ups, check if we have a recent answer
        if (classification.type === "followup") {
            const timeSinceLastAnswer = conversationContext.lastAnswerTime
                ? currentTime - conversationContext.lastAnswerTime
                : Infinity

            // ✅ Allow follow-ups within 2 minutes
            if (timeSinceLastAnswer > 120000 && !conversationContext.lastAnswer) {
                return this.reject(
                    `Follow-up without recent context (${Math.floor(timeSinceLastAnswer / 1000)}s old)`,
                    0.7
                )
            }
        }

        // ═══════════════════════════════════════════════════════
        // ✅ APPROVE
        // ═══════════════════════════════════════════════════════

        this.lastResponseTime = currentTime
        this.responseCount++

        if (DEBUG) {
            console.log(`[DecisionEngine] ✅ APPROVED`)
            console.log(`  Type: ${classification.type}`)
            console.log(`  Intent: ${classification.intent}`)
            console.log(`  Confidence: ${classification.confidence}`)
            console.log(`  Response #${this.responseCount}`)
        }

        return {
            shouldRespond: true,
            reason: `Approved ${classification.type} with intent ${classification.intent}`,
            confidence: classification.confidence,
        }
    }

    private reject(reason: string, confidence: number, suggestedDelay?: number): DecisionResult {
        if (DEBUG) {
            console.log(`[DecisionEngine] ❌ REJECTED: ${reason}`)
        }

        return {
            shouldRespond: false,
            reason,
            confidence,
            suggestedDelay,
        }
    }

    reset() {
        this.lastResponseTime = 0
        this.responseCount = 0
        this.sessionStartTime = Date.now()
    }
}