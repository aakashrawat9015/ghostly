import type { IntentType, InputType } from "../classifier/types"

export interface ResponseContext {
    input: string
    inputType: InputType
    intent: IntentType
    conversationHistory: string
    previousQA?: {
        question: string
        answer: string
    }
}

export interface GeneratedResponse {
    text: string
    confidence: number
    tokensUsed?: number
}

export interface DedupConfig {
    minTimeBetweenSimilar: number  // ms
    similarityThreshold: number     // 0-1
    cooldownPeriod: number          // ms
}