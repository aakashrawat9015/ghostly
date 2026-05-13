// location : apps/electron-client/src/main/services/llm/MeetingAssistant.ts
import { GroqService } from "./GroqService"
import { InputClassifier } from "./classifier/InputClassifier"
import { DecisionEngine } from "./decision/DecisionEngine"
import { ResponseGenerator } from "./response/ResponseGenerator"
import { TranscriptRefiner } from "./TranscriptRefiner"
import type { ConversationContext } from "./classifier/types"
import type { DecisionContext } from "./decision/types"
import type { ResponseContext } from "./response/types"
import type { AIResult } from "./types"
import { cleanText } from "./filters"

const DEBUG = process.env.DEBUG_LLM === "true"

export class MeetingAssistant {
    private shortTerm: string[] = []
    private longTerm = ""

    private lastQuestion: string = ""
    private lastAnswer: string = ""
    private lastAnswerAt: number = 0

    private classifier: InputClassifier
    private decisionEngine: DecisionEngine
    private responseGenerator: ResponseGenerator
    private refiner: TranscriptRefiner

    private readonly MAX_SHORT_TERM = 3  // last 3 sentences is enough context

    constructor(
        groq: GroqService,
        private opts: { maxContextChars?: number, enableRefinement?: boolean } = {}
    ) {
        this.classifier = new InputClassifier()
        this.decisionEngine = new DecisionEngine()
        this.responseGenerator = new ResponseGenerator(groq)
        this.refiner = new TranscriptRefiner(groq)
    }

    addFinalTranscript(text: string) {
        const cleaned = cleanText(text)
        if (!cleaned) return

        this.shortTerm.push(cleaned)
        if (this.shortTerm.length > this.MAX_SHORT_TERM) {
            this.shortTerm.shift()
        }
    }

    async maybeAnswer(latestFinal: string): Promise<AIResult | null> {
        const now = Date.now()

        // ═══════════════════════════════════════════════════════
        // STEP 0: REFINE (Optional but recommended for noisy STT)
        // ═══════════════════════════════════════════════════════
        let latest = cleanText(latestFinal)
        if (this.opts.enableRefinement !== false) {
            const context = this.buildConversationHistory(false)
            const refined = await this.refiner.refine(latest, context)
            if (DEBUG && refined !== latest) {
                console.log(`[MeetingAssistant] ✨ Refined: "${latest}" → "${refined}"`)
            }
            latest = refined
        }

        if (!latest) return null

        // ═══════════════════════════════════════════════════════
        // STEP 1: CLASSIFY
        // ═══════════════════════════════════════════════════════

        const conversationContext: ConversationContext = {
            lastQuestion: this.lastQuestion,
            lastAnswer: this.lastAnswer,
            lastAnswerTime: this.lastAnswerAt,
            recentTranscripts: this.shortTerm
        }

        const classification = await this.classifier.classify(latest, conversationContext)

        if (DEBUG) {
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            console.log(`[MeetingAssistant] STEP 1: Classification`)
            console.log(`  Type: ${classification.type}`)
            console.log(`  Intent: ${classification.intent}`)
            console.log(`  Confidence: ${classification.confidence}`)
        }

        // ═══════════════════════════════════════════════════════
        // STEP 2: DECIDE
        // ═══════════════════════════════════════════════════════

        const decisionContext: DecisionContext = {
            classification,
            conversationContext,
            currentTime: now
        }

        const decision = this.decisionEngine.decide(decisionContext)

        if (DEBUG) {
            console.log(`\n[MeetingAssistant] STEP 2: Decision`)
            console.log(`  Should Respond: ${decision.shouldRespond}`)
            console.log(`  Reason: ${decision.reason}`)
        }

        if (!decision.shouldRespond) {
            if (DEBUG) console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
            return null
        }

        // ═══════════════════════════════════════════════════════
        // STEP 3: GENERATE RESPONSE
        // ═══════════════════════════════════════════════════════

        const fullContext = this.buildConversationHistory(classification.type === "followup", latest)

        const responseContext: ResponseContext = {
            input: latest,
            inputType: classification.type,
            intent: classification.intent,
            conversationHistory: fullContext,
            previousQA: this.lastQuestion && this.lastAnswer
                ? { question: this.lastQuestion, answer: this.lastAnswer }
                : undefined
        }

        const response = await this.responseGenerator.generate(responseContext)

        if (DEBUG) {
            console.log(`\n[MeetingAssistant] STEP 3: Response`)
            console.log(`  Generated: ${!!response}`)
            if (response) {
                console.log(`  Length: ${response.text.length} chars`)
                console.log(`  Confidence: ${response.confidence}`)
            }
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
        }

        if (!response) return null

        // Store for next iteration
        this.lastQuestion = latest
        this.lastAnswer = response.text
        this.lastAnswerAt = now

        const intent = (classification.intent === "none" ? "context" : classification.intent) as Exclude<typeof classification.intent, "none">

        return {
            text: response.text,
            intent,
            confidence: response.confidence
        }
    }

    private buildConversationHistory(isFollowUp: boolean, excludeLatest?: string): string {
        const parts: string[] = []

        if (this.longTerm) {
            parts.push(this.longTerm)
        }

        if (isFollowUp && this.lastQuestion && this.lastAnswer) {
            parts.push(`[Previous Q&A]:`)
            parts.push(`Q: ${this.lastQuestion}`)
            parts.push(`A: ${this.lastAnswer}`)
        }

        // Exclude the current question from context — it's already in the user prompt
        const contextLines = excludeLatest
            ? this.shortTerm.filter(t => t !== excludeLatest)
            : this.shortTerm

        if (contextLines.length > 0) {
            parts.push(contextLines.join(" "))
        }

        const full = parts.join("\n")
        const max = this.opts.maxContextChars ?? 800

        return full.length > max ? full.slice(-max) : full
    }

    reset() {
        this.shortTerm = []
        this.longTerm = ""
        this.lastQuestion = ""
        this.lastAnswer = ""
        this.lastAnswerAt = 0

        this.classifier.reset()
        this.decisionEngine.reset()
        this.responseGenerator.reset()
    }

    getContext(): string {
        return this.buildConversationHistory(false)
    }}