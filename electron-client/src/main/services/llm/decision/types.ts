import type { ClassificationResult } from "../classifier/types"

export interface DecisionContext {
    classification: ClassificationResult
    conversationContext: {
        lastQuestion?: string
        lastAnswer?: string
        lastAnswerTime?: number
        recentTranscripts: string[]
    }
    currentTime: number
}

export interface DecisionResult {
    shouldRespond: boolean
    reason: string
    confidence: number
    suggestedDelay?: number  // Optional: "wait 500ms before responding"
}