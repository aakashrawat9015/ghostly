// services/llm/classifier/types.ts

export type InputType = "new" | "followup" | "context" | "ignore"

export type IntentType =
    | "question"
    | "problem"
    | "explanation"
    | "decision"
    | "context"
    | "none"

export interface ClassificationResult {
    type: InputType
    intent: IntentType
    confidence: number
    shouldRespond: boolean
    reason?: string
}

export interface ConversationContext {
    lastQuestion?: string
    lastAnswer?: string
    lastAnswerTime?: number
    recentTranscripts: string[]
}

/*
import { GroqService } from "./GroqService"
import { InputClassifier } from "./classifier/InputClassifier"
import type { ConversationContext, ClassificationResult } from "./classifier/types"
import { PROMPTS, buildUserPrompt } from "./prompts"
import { cleanText, REJECT_RESPONSES } from "./filters"

const DEBUG_LLM = process.env.DEBUG_LLM === "true"

export class MeetingAssistant {
    private shortTerm: string[] = []
    private longTerm = ""
    
    private lastQuestion: string = ""
    private lastAnswer: string = ""
    private lastAnswerAt: number = 0
    
    private classifier: InputClassifier
    
    private readonly MAX_SHORT_TERM = 5

    constructor(
        private groq: GroqService,
        private opts: { maxContextChars?: number } = {}
    ) {
        this.classifier = new InputClassifier(groq)
    }

    addFinalTranscript(text: string) {
        const cleaned = cleanText(text)
        if (!cleaned) return

        this.shortTerm.push(cleaned)
        if (this.shortTerm.length > this.MAX_SHORT_TERM) {
            this.shortTerm.shift()
        }
    }

    async maybeAnswer(latestFinal: string): Promise<{ text: string; intent: string; confidence: number } | null> {
        const latest = cleanText(latestFinal)
        if (!latest) return null

        // ✅ Build conversation context
        const context: ConversationContext = {
            lastQuestion: this.lastQuestion,
            lastAnswer: this.lastAnswer,
            lastAnswerTime: this.lastAnswerAt,
            recentTranscripts: this.shortTerm
        }

        // ✅ Classify input
        const classification = await this.classifier.classify(latest, context)

        if (DEBUG_LLM) {
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            console.log(`[MeetingAssistant] Classification:`)
            console.log(`  Type: ${classification.type}`)
            console.log(`  Intent: ${classification.intent}`)
            console.log(`  Confidence: ${classification.confidence}`)
            console.log(`  Should Respond: ${classification.shouldRespond}`)
            console.log(`  Reason: ${classification.reason}`)
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
        }

        // ✅ Skip if shouldn't respond
        if (!classification.shouldRespond) {
            return null
        }

        // ✅ Build full context for answer generation
        const fullContext = this.buildAnswerContext(classification.type === "followup")

        if (!fullContext || fullContext.length < 50) {
            if (DEBUG_LLM) console.log("[MeetingAssistant] ❌ Insufficient context")
            return null
        }

        // ✅ Generate answer
        const systemPrompt = PROMPTS[classification.intent] || PROMPTS.question
        const userPrompt = buildUserPrompt(fullContext, latest, classification.type, classification.intent)

        if (DEBUG_LLM) {
            console.log(`[MeetingAssistant] 🤖 Generating answer...`)
            console.log(`Context: "${fullContext.substring(0, 200)}..."`)
        }

        const raw = await this.groq.generateAnswer({
            transcript: fullContext,
            systemPrompt,
            userPrompt,
        })

        const answer = cleanText(raw)

        // ✅ Quality checks
        if (!answer || answer.length < 10) return null
        if (/^(ok|yes|no|sure|listening)\.?$/i.test(answer)) return null
        if (REJECT_RESPONSES.some(r => r.test(answer))) return null

        // ✅ Store for next iteration
        this.lastQuestion = latest
        this.lastAnswer = answer
        this.lastAnswerAt = Date.now()

        return {
            text: answer,
            intent: classification.intent,
            confidence: classification.confidence
        }
    }

    private buildAnswerContext(isFollowUp: boolean): string {
        const parts: string[] = []

        // Include long-term if exists
        if (this.longTerm) {
            parts.push(this.longTerm)
        }

        // Include last Q&A for follow-ups
        if (isFollowUp && this.lastQuestion && this.lastAnswer) {
            parts.push(`\n[Previous Q&A]:`)
            parts.push(`Q: ${this.lastQuestion}`)
            parts.push(`A: ${this.lastAnswer}`)
        }

        // Include recent transcripts
        if (this.shortTerm.length > 0) {
            parts.push(`\n[Recent conversation]:`)
            parts.push(this.shortTerm.join(" "))
        }

        const full = parts.join("\n")
        const max = this.opts.maxContextChars ?? 6000

        return full.length > max ? "..." + full.slice(-max) : full
    }

    reset() {
        this.shortTerm = []
        this.longTerm = ""
        this.lastQuestion = ""
        this.lastAnswer = ""
        this.lastAnswerAt = 0
        this.classifier.reset()
    }

    getContext(): string {
        return this.buildAnswerContext(false)
    }
}
 */