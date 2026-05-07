//location electron-client/src/main/services/llm/classifier/InputClassifier.ts
import { RuleClassifier } from "./RuleClassifier"
import type { ClassificationResult, ConversationContext } from "./types"

const DEBUG = process.env.DEBUG_LLM === "true"

export class InputClassifier {
    private ruleClassifier: RuleClassifier

    // Anti-spam
    private lastClassified: string = ""
    private lastClassifiedAt: number = 0
    private classificationCache = new Map<string, { result: ClassificationResult; timestamp: number }>()

    private readonly CACHE_TTL = 5000 // 5 seconds
    private readonly MIN_CLASSIFY_INTERVAL = 500 // 500ms between classifications

    constructor() {
        this.ruleClassifier = new RuleClassifier()
    }

    async classify(
        text: string,
        context: ConversationContext
    ): Promise<ClassificationResult> {
        const cleaned = text.trim()

        // ═══════════════════════════════════════════════════════
        // 🛡️ ANTI-SPAM / DEDUP
        // ═══════════════════════════════════════════════════════

        const now = Date.now()

        // Rate limiting
        if (now - this.lastClassifiedAt < this.MIN_CLASSIFY_INTERVAL) {
            if (DEBUG) console.log(`[InputClassifier] ⏸️ Rate limited`)
            return {
                type: "ignore",
                intent: "none",
                confidence: 0.95,
                shouldRespond: false,
                reason: "rate limited"
            }
        }

        // Dedup identical inputs
        if (cleaned === this.lastClassified && now - this.lastClassifiedAt < 3000) {
            if (DEBUG) console.log(`[InputClassifier] 🔁 Duplicate input`)
            return {
                type: "ignore",
                intent: "none",
                confidence: 0.95,
                shouldRespond: false,
                reason: "duplicate"
            }
        }

        // Cache check
        const cached = this.classificationCache.get(cleaned)
        if (cached && now - cached.timestamp < this.CACHE_TTL) {
            if (DEBUG) console.log(`[InputClassifier] 📦 Cache hit`)
            return cached.result
        }

        // ═══════════════════════════════════════════════════════
        // ⚡ FAST PATH: Rule-based classification
        // ═══════════════════════════════════════════════════════

        const ruleResult = this.ruleClassifier.classify(cleaned)

        if (ruleResult) {
            // High confidence from rules → use it
            if (ruleResult.confidence >= 0.7) {
                if (DEBUG) {
                    console.log(`[InputClassifier] ⚡ FAST PATH: ${ruleResult.type} (${ruleResult.confidence})`)
                }

                this.updateState(cleaned, now, ruleResult)
                return ruleResult
            }
        }

        // ═══════════════════════════════════════════════════════
        // ✅ FIX: FALLBACK - IGNORE INSTEAD OF CONTEXT
        // ═══════════════════════════════════════════════════════

        const fallback: ClassificationResult = {
            type: "ignore", // context mat rakh - ye DecisionEngine ko confuse karta tha
            intent: "none",
            confidence: 0.6,
            shouldRespond: false,
            reason: "no clear rule match"
        }

        this.updateState(cleaned, now, fallback)
        return fallback
    }

    private updateState(text: string, now: number, result: ClassificationResult) {
        this.lastClassified = text
        this.lastClassifiedAt = now
        this.classificationCache.set(text, { result, timestamp: now })

        // Clean old cache entries
        if (this.classificationCache.size > 50) {
            const oldest = Array.from(this.classificationCache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, 25)

            oldest.forEach(([key]) => this.classificationCache.delete(key))
        }
    }

    reset() {
        this.lastClassified = ""
        this.lastClassifiedAt = 0
        this.classificationCache.clear()
    }
}