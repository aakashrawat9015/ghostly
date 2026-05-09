// RuleClassifier.ts
import type { ClassificationResult, InputType, IntentType } from "./types"

const DEBUG = process.env.DEBUG_LLM === "true"

// Conversational filler phrases that precede question words but are NOT real questions.
// e.g. "you know, what is..." / "I mean, how does..." / "I will talk about what..."
const CONVERSATIONAL_PREFIXES = /^(you know[,\s]|i mean[,\s]|i think[,\s]|i will|i'll|we will|we'll|let me|let's|i want to|we want to|i'm going to|we're going to|i was|we were|it will|this will|that will)/i

export class RuleClassifier {
    classify(text: string): ClassificationResult | null {
        const t = text.trim().toLowerCase()

        // ═══════════════════════════════════════════════════════
        // GATE: strip transcripts that start with conversational
        // filler — "you know, what is X" is NOT a question for us
        // ═══════════════════════════════════════════════════════
        if (CONVERSATIONAL_PREFIXES.test(t)) {
            if (DEBUG) console.log(`[RuleClassifier] ⏭️ Conversational prefix, ignoring: "${text}"`)
            return this.result("ignore", "none", 0.9, false, "conversational prefix")
        }

        // ═══════════════════════════════════════════════════════
        // PRIORITY 1: EXPLICIT QUESTION SIGNALS
        // ═══════════════════════════════════════════════════════

        // Hard rule: "?" always means a real question
        // BUT skip rhetorical tags: "Right?", "OK?", "Yeah?", "Got it?", "Correct?"
        // and confirmation phrases: "isn't it?", "doesn't it?", "right?"
        if (t.includes("?")) {
            const rhetoricalTags = /^(right|ok|okay|yeah|correct|got it|sure|alright|no|yes|huh|really|seriously|true|fair enough|makes sense|you know|isn't it|doesn't it|don't you think|wouldn't you say|can you believe|know what i mean)\??\.?$/i
            // Also catch short trailing tags: "...right?" / "...ok?" at end of longer sentence
            const trailingTag = /[,.]\s*(right|ok|okay|yeah|correct|huh|no|yes|isn't it|doesn't it|you know)\s*\?\.?$/i

            if (rhetoricalTags.test(t.replace(/[^a-z0-9\s?]/gi, "").trim())) {
                return this.result("ignore", "none", 0.9, false, "rhetorical tag question")
            }
            if (trailingTag.test(t)) {
                return this.result("ignore", "none", 0.9, false, "trailing confirmation tag")
            }
            return this.result("new", "question", 0.95, true, "question mark")
        }

        // "Do/Does/Did you..." — must start the sentence
        if (/^(do|does|did)\s+you\s+(know|understand|think|have|remember|get)/i.test(t)) {
            return this.result("new", "question", 0.95, true, "do-you question")
        }

        // WH-question at sentence start: "What is X", "How does Y work"
        if (/^(what|why|how|when|where|who|which|whose)\s+(is|are|was|were|do|does|did|can|could|would|should|will|shall)\b/i.test(t)) {
            return this.result("new", "question", 0.95, true, "WH-question")
        }

        // Short standalone factual: "what is RAG" (no verb needed, 2-4 words)
        if (/^(what|who|when|where|which)\s+\w+(\s+\w+)?$/i.test(t)) {
            return this.result("new", "question", 0.98, true, "short factual")
        }

        // "explain X" / "tell me about X" / "describe X" — imperative directed at AI
        if (/^(define|explain|describe|tell me about|what does|what do)\s+\S/i.test(t)) {
            return this.result("new", "question", 0.92, true, "definition request")
        }

        // "Can you explain..." / "Could you tell me..."
        if (/^(can|could|would|will)\s+you\s+(explain|tell|describe|show|help)/i.test(t)) {
            return this.result("new", "question", 0.9, true, "polite question")
        }

        // "explain/show me HOW/WHAT/WHY" — only when it starts the sentence
        // NOT mid-sentence "you know, explain what..." (already blocked by prefix gate)
        if (/^(explain|show me|tell me)\s+(how|what|why|when|where)\b/i.test(t)) {
            return this.result("new", "question", 0.9, true, "imperative question")
        }

        // "definition of X" / "meaning of X" — anywhere in sentence is fine, very specific
        if (/\b(definition of|meaning of)\b/i.test(t)) {
            return this.result("new", "question", 0.92, true, "definition phrase")
        }

        // ═══════════════════════════════════════════════════════
        // IGNORE PATTERNS
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
            /\b(versus|vs\.?)\b/i,  // removed bare "or" — too broad, fires on everything
        ]
        if (decisionPatterns.some(p => p.test(t))) {
            return this.result("new", "decision", 0.75, true, "decision pattern")
        }

        // ═══════════════════════════════════════════════════════
        // CONTEXT PATTERNS — DO NOT RESPOND to plain statements
        // ═══════════════════════════════════════════════════════

        const hasQuestionWords = /\b(what|why|how|when|where|who|which|explain|tell|describe|know|do you)\b/i.test(t)

        // Plain statements (long, no question words) → ignore, just store context
        if (t.length > 30 && !hasQuestionWords && !t.includes("?")) {
            return this.result("ignore", "none", 0.8, false, "plain statement — no response needed")
        }

        // ═══════════════════════════════════════════════════════
        // DEFAULT — short inputs that aren't clearly questions → ignore
        // ═══════════════════════════════════════════════════════

        // Removed "short input question bias" — it was firing on fragments like
        // "Thank you. This is a simple definition" and "related to R"
        if (DEBUG) {
            console.log(`[RuleClassifier] ❓ Uncertain, ignoring: "${text}"`)
        }

        return this.result("ignore", "none", 0.7, false, "uncertain input")
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