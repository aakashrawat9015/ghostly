// RuleClassifier.ts
import type { ClassificationResult, InputType, IntentType, ConversationContext } from "./types"

const DEBUG = process.env.DEBUG_LLM === "true"

// Conversational filler phrases — NOT questions directed at the AI
const CONVERSATIONAL_PREFIXES = /^(you know[,\s]|i mean[,\s]|i think[,\s]|i will|i'll|we will|we'll|let me|let's|i want to|we want to|i'm going to|we're going to|i was|we were|it will|this will|that will)/i

// Social/greeting questions — two people talking to each other, not asking the AI
const SOCIAL_PATTERNS = [
    /^(hey|hi|hello|howdy)[.!,\s]/i,
    /^how (have you|are you|have you been|are you doing|is it going|was your|was the|did it go)/i,
    /^(how's|how are|how have|how was|how were|how did)\b/i,
    /^(what's new|what have you been|what are you up to|what did you do|what's going on|what's up)\b/i,
    /^(how's it|how's everything|how's life|how's work|how's the)\b/i,
    /^(are you|were you|have you been|did you|do you have)\s+(okay|good|well|alright|fine|busy|free|available)/i,
    /^(nice to|good to|great to)\s+(meet|see|hear)/i,
    /^(long time|it's been a while|been a while|haven't (seen|talked|spoken|heard))/i,
    /^(congrats|congratulations|well done|good job|great job)\b/i,
    /^(sorry|excuse me|pardon)[,.\s]/i,
    /^(thanks|thank you|cheers|appreciate)\b/i,
    /^hello\??\\.?$/i,
    /^(hi|hey)\??\\.?$/i,
    /^(i'm doing|i am doing|doing well|doing good|doing fine)\b/i,
    /^(that's great|that's good|that's nice|that's awesome|that's cool|that sounds)\b/i,
    /^(oh nice|oh cool|oh great|oh wow|oh interesting)\b/i,
    /^(got it|i see|i understand|makes sense|fair enough|sounds good)\b/i,
]

// ── CORRECTION / NEGATION PATTERNS ──
// "No. I am saying what is MCP." / "No, I mean X" / "I said X not Y"
const CORRECTION_PATTERNS = [
    /^no[.,!\s]+(i('m| am) (saying|asking|talking about)|i (mean|meant|said))\b/i,
    /^(i('m| am) (saying|asking)|i (mean|meant|said))\s+(what|how|why|who|which|where|when)\b/i,
    /^(not|no)[.,!\s]+.{3,}(i('m| am) (saying|asking)|i (mean|meant))\b/i,
    /^(what i (mean|said|asked)|i was asking)\b/i,
    /^no[.,!\s]+(it's|it is|that's|that is)\s+/i,
    /^no[.,!\s]+(i('m| am) asking about|tell me about|what about)\b/i,
    /^(i('m| am) not asking about|i didn't (ask|mean|say))\b/i,
]

// ── DEFINITION STATEMENT PATTERNS ──
// "MCP means model context protocol" / "X stands for Y"
const DEFINITION_PATTERNS = [
    /\b\w+\s+(means|stands for|refers to|is short for|is called|is basically|is essentially)\s+/i,
    /\b(it means|that means|which means|meaning)\s+/i,
    /\b(also known as|aka|i\.e\.|i\.e)\b/i,
]

// How long after a response to consider inputs as potential follow-ups
const POST_ANSWER_WINDOW_MS = 30_000  // 30 seconds

export class RuleClassifier {
    classify(text: string, context?: ConversationContext): ClassificationResult | null {
        const t = text.trim().toLowerCase()

        // ── GATE 1: Conversational prefix ────────────────────
        if (CONVERSATIONAL_PREFIXES.test(t)) {
            if (DEBUG) console.log(`[RuleClassifier] ⏭️ Conversational prefix: "${text}"`)
            return this.result("ignore", "none", 0.9, false, "conversational prefix")
        }

        // ── GATE 2: Social/greeting — person-to-person, not for AI ──
        if (SOCIAL_PATTERNS.some(p => p.test(t))) {
            if (DEBUG) console.log(`[RuleClassifier] ⏭️ Social: "${text}"`)
            return this.result("ignore", "none", 0.92, false, "social question")
        }

        // ═══════════════════════════════════════════════════════
        // PRIORITY 0: CORRECTIONS / NEGATIONS (before question signals)
        // "No. I am saying what is MCP." → followup question
        // ═══════════════════════════════════════════════════════

        if (CORRECTION_PATTERNS.some(p => p.test(t))) {
            if (DEBUG) console.log(`[RuleClassifier] 🔄 Correction detected: "${text}"`)
            return this.result("followup", "question", 0.9, true, "correction/negation")
        }

        // ═══════════════════════════════════════════════════════
        // PRIORITY 1: EXPLICIT QUESTION SIGNALS
        // ═══════════════════════════════════════════════════════

        if (t.includes("?")) {
            // Rhetorical tags: "Right?", "OK?", "Yeah?"
            const rhetoricalTag = /^(right|ok|okay|yeah|correct|got it|sure|alright|no|yes|huh|really|seriously|true|fair enough|makes sense|you know|isn't it|doesn't it|don't you think|wouldn't you say|know what i mean)\??\\.?$/i
            const trailingTag = /[,.]\s*(right|ok|okay|yeah|correct|huh|no|yes|isn't it|doesn't it|you know)\s*\?\\.?$/i

            if (rhetoricalTag.test(t.replace(/[^a-z0-9\s?]/gi, "").trim())) {
                return this.result("ignore", "none", 0.9, false, "rhetorical tag")
            }
            if (trailingTag.test(t)) {
                return this.result("ignore", "none", 0.9, false, "trailing tag")
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

        // Short standalone factual: "what is RAG" (2-4 words)
        if (/^(what|who|when|where|which)\s+\w+(\s+\w+)?$/i.test(t)) {
            return this.result("new", "question", 0.98, true, "short factual")
        }

        // Imperative directed at AI: "define X", "explain X", "describe X", "can you define X"
        if (/^(define|explain|describe|tell me about|what does|what do)\s+\S/i.test(t)) {
            return this.result("new", "question", 0.92, true, "definition request")
        }

        // "Can you explain/define/tell/describe/show/help..."
        if (/^(can|could|would|will)\s+you\s+(explain|tell|describe|show|help|define|clarify|elaborate)/i.test(t)) {
            return this.result("new", "question", 0.9, true, "polite question")
        }

        // "explain/show me/tell me HOW/WHAT/WHY" — sentence start only
        if (/^(explain|show me|tell me)\s+(how|what|why|when|where)\b/i.test(t)) {
            return this.result("new", "question", 0.9, true, "imperative question")
        }

        // "can you define what is X" — define + what is pattern
        if (/^(can you |could you )?(define|explain)\s+(what|how|why|when|where)\s+(is|are|was|were|does|do)\b/i.test(t)) {
            return this.result("new", "question", 0.92, true, "define-what pattern")
        }

        // "definition of X" / "meaning of X"
        if (/\b(definition of|meaning of)\b/i.test(t)) {
            return this.result("new", "question", 0.92, true, "definition phrase")
        }

        // ═══════════════════════════════════════════════════════
        // DEFINITION STATEMENTS — "X means Y" / "X stands for Y"
        // These are often corrections or clarifications
        // ═══════════════════════════════════════════════════════

        if (DEFINITION_PATTERNS.some(p => p.test(t))) {
            if (DEBUG) console.log(`[RuleClassifier] 📖 Definition statement: "${text}"`)
            return this.result("followup", "question", 0.85, true, "definition statement")
        }

        // ═══════════════════════════════════════════════════════
        // IGNORE PATTERNS
        // ═══════════════════════════════════════════════════════

        if (t.length < 3) {
            return this.result("ignore", "none", 0.95, false, "too short")
        }

        const fillers = /^(okay|ok|yeah|yep|right|hmm|uh|so|fine|got it|sure|alright|mhm|nice|cool|great|awesome|perfect|absolutely|exactly|indeed|agreed|understood|noted)\.?$/i
        if (fillers.test(t)) {
            return this.result("ignore", "none", 0.95, false, "filler")
        }

        const acks = /^(yes|no|maybe|i see|i understand|makes sense|that makes sense|that's right|that's correct|fair enough|sounds good|sounds right)\.?$/i
        if (acks.test(t)) {
            return this.result("ignore", "none", 0.9, false, "acknowledgment")
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
            return this.result("followup", "question", 0.85, true, "follow-up")
        }

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
            return this.result("new", "problem", 0.85, true, "problem")
        }

        // ═══════════════════════════════════════════════════════
        // DECISION PATTERNS
        // ═══════════════════════════════════════════════════════

        const decisionPatterns = [
            /\b(should i|which one|better option|recommend|suggest|choose|prefer)\b/i,
            /\b(versus|vs\.?)\b/i,
        ]
        if (decisionPatterns.some(p => p.test(t))) {
            return this.result("new", "decision", 0.75, true, "decision")
        }

        // ═══════════════════════════════════════════════════════
        // POST-ANSWER CONTINUATION DETECTION
        // If we answered recently and the input has meaningful content,
        // treat it as a follow-up instead of ignoring
        // ═══════════════════════════════════════════════════════

        if (context?.lastAnswerTime) {
            const timeSinceAnswer = Date.now() - context.lastAnswerTime
            if (timeSinceAnswer < POST_ANSWER_WINDOW_MS && context.lastAnswer) {
                // Check if input shares topic words with the last Q&A
                const inputWords = new Set(t.split(/\s+/).filter(w => w.length > 2))
                const lastQWords = new Set((context.lastQuestion || "").toLowerCase().split(/\s+/).filter(w => w.length > 2))
                const lastAWords = new Set((context.lastAnswer || "").toLowerCase().split(/\s+/).filter(w => w.length > 2))

                const hasTopicOverlap = [...inputWords].some(w => lastQWords.has(w) || lastAWords.has(w))
                const hasSubstance = inputWords.size >= 2

                if (hasTopicOverlap && hasSubstance) {
                    if (DEBUG) console.log(`[RuleClassifier] 🔗 Post-answer continuation (${Math.floor(timeSinceAnswer / 1000)}s ago): "${text}"`)
                    return this.result("followup", "question", 0.8, true, "post-answer continuation")
                }

                // Even without topic overlap, if input has question-like words, treat as followup
                const hasQuestionIntent = /\b(what|why|how|when|where|who|which|explain|tell|describe|same|different|both|compare)\b/i.test(t)
                if (hasQuestionIntent && hasSubstance) {
                    if (DEBUG) console.log(`[RuleClassifier] 🔗 Post-answer question-like (${Math.floor(timeSinceAnswer / 1000)}s ago): "${text}"`)
                    return this.result("followup", "question", 0.75, true, "post-answer question-like")
                }
            }
        }

        // ═══════════════════════════════════════════════════════
        // DEFAULT — plain statements → ignore
        // ═══════════════════════════════════════════════════════

        const hasQuestionWords = /\b(what|why|how|when|where|who|which|explain|tell|describe|know|do you)\b/i.test(t)
        if (t.length > 30 && !hasQuestionWords && !t.includes("?")) {
            return this.result("ignore", "none", 0.8, false, "plain statement")
        }

        if (DEBUG) console.log(`[RuleClassifier] ❓ Uncertain, ignoring: "${text}"`)
        return this.result("ignore", "none", 0.7, false, "uncertain")
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
