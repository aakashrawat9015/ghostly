// src/main/services/stt/TranscriptionCorrectionService.ts
import Groq from "groq-sdk"

const DEBUG = process.env.DEBUG_LLM === "true"

const MODEL = "llama-3.1-8b-instant"
const TEMPERATURE = 0
const MAX_TOKENS = 200
const TIMEOUT_MS = 3000  // hard cap — if Groq takes >3s, fallback to raw text

const SYSTEM_PROMPT = `You are a Speech-to-Text corrector. Fix ONLY misheared technical words.

STRICT RULES:
1. Fix technical mishearings using the KEYWORDS list (e.g. "m c p" → "MCP", "next jay es" → "Next.js")
2. Fix spaced-out acronyms (e.g. "j s" → "JS", "a p i" → "API")
3. PRESERVE the sentence structure, word order, and length exactly
4. PRESERVE all punctuation including "?" — never remove a question mark
5. Do NOT add words that were not spoken — if the transcript is incomplete, keep it incomplete
6. Do NOT guess what the speaker meant to say — only fix clear mishearings
7. If nothing needs fixing, return the text exactly as-is
8. Return ONLY the corrected text. No explanations, no quotes.`

export interface CorrectionInput {
    rawText: string
    keywords: string[]  // from KeywordExtractor
}

export interface CorrectionResult {
    corrected: string
    latencyMs: number
    usedFallback: boolean
}

export class TranscriptionCorrectionService {
    private client: Groq | null = null

    constructor(private apiKey: string) {
        if (!apiKey) {
            console.warn("[TranscriptionCorrection] No API key — will use fallback (raw text)")
            return
        }
        try {
            // Pass only the base domain — the SDK appends /openai/v1 itself.
            // If GROQ_BASE_URL is set to "https://api.groq.com/openai/v1" it would
            // double the path → /openai/v1/openai/v1/chat/completions (404).
            const baseURL = (process.env.GROQ_BASE_URL || "https://api.groq.com")
                .replace(/\/openai\/v1\/?$/, "")  // strip trailing /openai/v1 if present
                .replace(/\/+$/, "")              // strip trailing slashes
            this.client = new Groq({ apiKey, baseURL })
        } catch (e) {
            console.error("[TranscriptionCorrection] Failed to init Groq client:", e)
        }
    }

    async correctTranscript(
        rawText: string,
        filePath: string,
        keywords: string[]
    ): Promise<CorrectionResult> {
        const start = Date.now()

        // Fallback immediately if no client
        if (!this.client) {
            return { corrected: rawText, latencyMs: 0, usedFallback: true }
        }

        // Skip correction for very short text — not worth the API call
        if (rawText.trim().length < 4) {
            return { corrected: rawText, latencyMs: 0, usedFallback: true }
        }

        const userPrompt = this.buildUserPrompt(rawText, filePath, keywords)

        try {
            // Race against timeout — if Groq is slow, return raw text immediately
            const corrected = await Promise.race([
                this.callGroq(userPrompt).then(c => this.safetyCheck(rawText, c)),
                this.timeoutFallback(rawText, TIMEOUT_MS),
            ])

            const latencyMs = Date.now() - start

            if (DEBUG) {
                console.log(`[TranscriptionCorrection] ✅ ${latencyMs}ms`)
                if (corrected !== rawText) {
                    console.log(`  Raw:       "${rawText}"`)
                    console.log(`  Corrected: "${corrected}"`)
                }
            }

            return { corrected, latencyMs, usedFallback: false }
        } catch (e: any) {
            const latencyMs = Date.now() - start
            console.error(`[TranscriptionCorrection] ❌ Error (${latencyMs}ms):`, e?.message)
            return { corrected: rawText, latencyMs, usedFallback: true }
        }
    }

    private async callGroq(userPrompt: string): Promise<string> {
        const res = await this.client!.chat.completions.create({
            model: MODEL,
            temperature: TEMPERATURE,
            max_tokens: MAX_TOKENS,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
            ],
        })

        let text = res.choices?.[0]?.message?.content?.trim() ?? ""
        text = text.replace(/^["'`]|["'`]$/g, "").trim()
        return text
    }

    /**
     * Safety check: if the original had a "?" but the corrected version lost it,
     * restore it. The correction service must never destroy question intent.
     */
    private safetyCheck(original: string, corrected: string): string {
        const origHasQuestion = original.includes("?")
        const corrHasQuestion = corrected.includes("?")
        if (origHasQuestion && !corrHasQuestion) {
            return corrected.trimEnd() + "?"
        }
        return corrected
    }

    private timeoutFallback(rawText: string, ms: number): Promise<string> {
        return new Promise(resolve => setTimeout(() => resolve(rawText), ms))
    }

    private buildUserPrompt(
        rawText: string,
        filePath: string,
        keywords: string[]
    ): string {
        const parts: string[] = []

        if (keywords.length > 0) {
            parts.push(`KEYWORDS (technical terms from the active file — use these to correct mishearings):`)
            parts.push(keywords.join(", "))
            parts.push("")
        }

        if (filePath) {
            // Just the filename, not the full path — gives context without noise
            const fileName = filePath.split(/[\\/]/).pop() ?? filePath
            parts.push(`ACTIVE FILE: ${fileName}`)
            parts.push("")
        }

        parts.push(`RAW TRANSCRIPT:`)
        parts.push(rawText)

        return parts.join("\n")
    }
}
