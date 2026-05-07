// RuleClassifier.ts
import type { ClassificationResult, InputType, IntentType } from "./types"

const DEBUG = process.env.DEBUG_LLM === "true"

export class RuleClassifier {
    /**
     * Fast rule-based classification with AGGRESSIVE question detection
     */
    classify(text: string): ClassificationResult | null {
        const t = text.trim().toLowerCase()
        const originalText = text.trim()

        // ═══════════════════════════════════════════════════════
        // ✅ PRIORITY 1: DETECT QUESTIONS FIRST (BEFORE IGNORING)
        // ═══════════════════════════════════════════════════════

        // Question with "?"
        if (t.includes("?")) {
            return this.result("new", "question", 0.95, true, "question mark detected")
        }

        // ✅ FIX 1: "Do/Does/Did you..." questions
        const doYouPattern = /^(do|does|did)\s+you\s+(know|understand|think|have|remember|get)/i
        if (doYouPattern.test(t)) {
            return this.result("new", "question", 0.95, true, "do-you question")
        }

        // WH-Questions (what, why, how, etc.)
        const whQuestions = /^(what|why|how|when|where|who|which|whose)\s+(is|are|was|were|do|does|did|can|could|would|should|will|shall)/i
        if (whQuestions.test(t)) {
            return this.result("new", "question", 0.95, true, "WH-question pattern")
        }

        // Short factual questions (optimized for "what is X?")
        const shortFactual = /^(what|who|when|where|which|whose)\s+(['"]?\w+['"]?|\w+\s+\w+)$/i
        if (shortFactual.test(t)) {
            return this.result("new", "question", 0.98, true, "short factual question")
        }

        // ✅ FIX 2: "know how/what/why" patterns
        const knowHowPattern = /\b(know|explain|tell me|show me)\s+(how|what|why|when|where)\b/i
        if (knowHowPattern.test(t)) {
            return this.result("new", "question", 0.92, true, "know-how pattern")
        }

        // Definition requests
        const definitionPatterns = [
            /^(define|explain|describe|tell me about|what does)\s+/i,
            /\b(definition of|meaning of)\b/i
        ]
        if (definitionPatterns.some(p => p.test(t))) {
            return this.result("new", "question", 0.92, true, "definition request")
        }

        // "Can you..." questions
        const canYouPattern = /^(can|could|would|will)\s+you\s+(explain|tell|describe|show|help)/i
        if (canYouPattern.test(t)) {
            return this.result("new", "question", 0.9, true, "polite question")
        }

        // ═══════════════════════════════════════════════════════
        // IGNORE PATTERNS (ONLY AFTER QUESTION CHECK)
        // ═══════════════════════════════════════════════════════

        if (t.length < 3) {
            return this.result("ignore", "none", 0.95, false, "too short")
        }

        // Filler words (EXACT match only)
        const fillers = /^(okay|ok|yeah|yep|right|hmm|uh|so|fine|got it|sure|alright|mhm)\.?$/i
        if (fillers.test(t)) {
            return this.result("ignore", "none", 0.95, false, "filler word")
        }

        // Simple acknowledgments (EXACT match only)
        const acks = /^(yes|no|maybe|i see|i understand|makes sense)\.?$/i
        if (acks.test(t)) {
            return this.result("ignore", "none", 0.9, false, "simple acknowledgment")
        }

        // ═══════════════════════════════════════════════════════
        // FOLLOW-UP PATTERNS
        // ═══════════════════════════════════════════════════════

        const strongFollowUps = [
            /^(explain|tell|say)\s+(more|again|further)/i,
            /^(more|give me more)\s+(about|on|detail)/i,
            /^(elaborate|expand|continue|go deeper)/i,
            /^can you (explain|elaborate|expand)/i,
            /^(what|how)\s+about\s+(that|it|this)/i,
            /^tell me more$/i,
            /^(more|elaborate|expand|continue)\.?$/i,
        ]

        if (strongFollowUps.some(p => p.test(t))) {
            return this.result("followup", "question", 0.85, true, "strong follow-up pattern")
        }

        // Pronoun references (likely follow-up)
        const pronounRefs = /^(that|it|this|those|these)\s+(is|are|was|were|means|works)/i
        if (pronounRefs.test(t)) {
            return this.result("followup", "question", 0.75, true, "pronoun reference")
        }

        // ═══════════════════════════════════════════════════════
        // PROBLEM PATTERNS
        // ═══════════════════════════════════════════════════════

        const problemPatterns = [
            /\b(error|issue|problem|bug|broken|failed|not working|doesn't work|won't work)\b/i,
            /\b(help|fix|solve|debug|troubleshoot)\b/i,
        ]
        if (problemPatterns.some(p => p.test(t))) {
            return this.result("new", "problem", 0.85, true, "problem indicator")
        }

        // ═══════════════════════════════════════════════════════
        // DECISION PATTERNS
        // ═══════════════════════════════════════════════════════

        const decisionPatterns = [
            /\b(should i|which one|better option|recommend|suggest|choose|prefer)\b/i,
            /\b(or|versus|vs\.?)\b/i,
        ]
        if (decisionPatterns.some(p => p.test(t))) {
            return this.result("new", "decision", 0.75, true, "decision pattern")
        }

        // ═══════════════════════════════════════════════════════
        // CONTEXT PATTERNS (LESS AGGRESSIVE)
        // ═══════════════════════════════════════════════════════

        // Only mark as context if it's clearly a statement (long AND no question words)
        const hasQuestionWords = /\b(what|why|how|when|where|who|which|explain|tell|describe|know|do you)\b/i.test(t)

        if (t.length > 30 && !hasQuestionWords && !t.includes("?")) {
            return this.result("context", "context", 0.7, false, "likely statement")
        }

        // ═══════════════════════════════════════════════════════
        // ✅ FIX 3: DEFAULT - BIAS TOWARD QUESTIONS INSTEAD OF NULL
        // ═══════════════════════════════════════════════════════

        // If it's short and not a filler, assume question
        if (t.length >= 3 && t.length <= 50) {
            const words = t.split(/\s+/)

            // If it has 2-6 words and isn't clearly a filler, treat as potential question
            if (words.length >= 2 && words.length <= 6) {
                if (DEBUG) {
                    console.log(`[RuleClassifier] 🤔 Short input, biasing toward question: "${text}"`)
                }
                return this.result("new", "question", 0.75, true, "short input question bias")
            }
        }

        if (DEBUG) {
            console.log(`[RuleClassifier] ❓ Uncertain about: "${text}"`)
        }

        return null // Only if really uncertain
    }

    private result(
        type: InputType,
        intent: IntentType,
        confidence: number,
        shouldRespond: boolean,
        reason?: string
    ): ClassificationResult {
        if (DEBUG) {
            const emoji = type === "new" ? "🆕" : type === "followup" ? "🔗" : type === "ignore" ? "⏭️" : "📝"
            console.log(`[RuleClassifier] ${emoji} ${type.toUpperCase()} | ${intent} | conf: ${confidence} | reason: ${reason}`)
        }

        return { type, intent, confidence, shouldRespond, reason }
    }
}