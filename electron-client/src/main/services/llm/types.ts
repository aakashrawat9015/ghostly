import type { IntentType } from "./triggers"

/** Structured result sent from worker → main → renderer */
export type AIResult = {
    text: string
    intent: Exclude<IntentType, "none">
    confidence: number // 0–1, derived from intent signal strength
}

/** Early intent signal sent before LLM responds */
export type AIIntent = {
    intent: Exclude<IntentType, "none">
}
