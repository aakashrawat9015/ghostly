// location: ghostly/apps/electron-client/src/main/services/llm/triggers.ts

export type IntentType =
    | "question"
    | "decision"
    | "problem"
    | "explanation"
    | "context"
    | "none"

export const TRIGGER_PATTERNS = {
    directQuestion: /\?/,
    questionWords: /\b(what|why|how|when|where|who|which|explain|define|describe)\b/i,
    modalQuestion: /\b(can|could|should|would|will|shall|may|might|must)\s+(we|i|you|they|it|this|that)\b/i,
    confusion: /\b(confused|lost|unclear|not sure|don't understand|what does|what's that|wait|hold on|huh)\b/i,
    explain: /\b(explain|tell me|show me|help me understand|what is|how does|why does|walk me through|what are)\b/i,
    unknowing: /\b(don't know|not sure|forgot|can't remember|never heard|no idea|unclear on|remind me)\b/i,
    problem: /\b(struggling|issue|problem|not working|difficult|challenge|broken|failing|stuck|error|bug|slow|crash|latency|timeout)\b/i,
    decision: /\b(better|worse|versus|vs|compare|difference between|which one|prefer|recommend|pros and cons|should we use|trade.?off)\b/i,
    pureGreeting: /^(hi|hello|hey|thanks|thank you|okay|ok|yes|no|yeah|yep|sure|alright|cool|bye|goodbye)[\s.!,]*$/i,
}

/**
 * Detects the intent of a transcript segment.
 * Returns a typed intent rather than a boolean — callers can choose
 * different prompts / behaviour per intent.
 */
export function detectIntent(text: string): IntentType {
    const t = (text ?? "").toLowerCase().trim()
    const words = t.split(/\s+/).filter(Boolean)

    if (words.length < 3) return "none"
    if (TRIGGER_PATTERNS.pureGreeting.test(t)) return "none"

    // Explicit question signals
    if (TRIGGER_PATTERNS.directQuestion.test(t)) return "question"
    if (TRIGGER_PATTERNS.questionWords.test(t)) return "question"
    if (TRIGGER_PATTERNS.explain.test(t)) return "explanation"
    if (TRIGGER_PATTERNS.confusion.test(t)) return "question"
    if (TRIGGER_PATTERNS.unknowing.test(t)) return "question"

    // Problem / error signals
    if (TRIGGER_PATTERNS.problem.test(t)) return "problem"

    // Decision / comparison signals
    if (TRIGGER_PATTERNS.modalQuestion.test(t)) return "decision"
    if (TRIGGER_PATTERNS.decision.test(t) && words.length >= 6) return "decision"

    // Passive context: substantive sentence worth summarising / suggesting on
    if (words.length >= 5) return "context"

    return "none"
}

/** Backward-compat wrapper used by existing callers */
export function shouldRespond(text: string): boolean {
    return detectIntent(text) !== "none"
}

export function isHighPriority(text: string): boolean {
    const intent = detectIntent(text)
    return intent === "question" || intent === "problem" || intent === "explanation"
}
