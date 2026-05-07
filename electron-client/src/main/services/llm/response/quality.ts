const DEBUG = process.env.DEBUG_LLM === "true"

// Generic/useless responses to reject
const REJECT_PATTERNS = [
    /^(ok|yes|no|sure|listening)\.?$/i,
    /^i (don't|do not) (know|understand)/i,
    /^(hmm|uh|um|well)/i,
    /^that'?s (interesting|good|nice|great)\.?$/i,
]

// Responses indicating lack of context
const CONTEXT_WARNINGS = [
    /not enough (context|information)/i,
    /hasn'?t been discussed/i,
    /need more (context|information|details)/i,
    /don'?t have enough/i,
]

export interface QualityCheckResult {
    isValid: boolean
    reason?: string
    isContextWarning?: boolean
}

export function checkResponseQuality(text: string): QualityCheckResult {
    const cleaned = text.trim()

    // Too short
    if (cleaned.length < 10) {
        return { isValid: false, reason: "Answer too short (<10 chars)" }
    }

    // Generic filler
    if (REJECT_PATTERNS.some(pattern => pattern.test(cleaned))) {
        return { isValid: false, reason: "Generic/filler response" }
    }

    // Context warning (valid but low confidence)
    if (CONTEXT_WARNINGS.some(pattern => pattern.test(cleaned))) {
        if (DEBUG) {
            console.log(`[Quality] ⚠️ Context warning detected`)
        }
        return { isValid: true, isContextWarning: true }
    }

    return { isValid: true }
}