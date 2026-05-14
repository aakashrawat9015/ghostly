import { GroqService } from "./GroqService"

const REFINER_SYSTEM_PROMPT = `You are a specialized STT (Speech-to-Text) transcript refiner for technical software engineering meetings.
Your goal is to take a raw, potentially noisy transcript and return a corrected, coherent version.

RULES:
1. Fix common technical misspellings based on context (e.g., "MCP" instead of "Storm" or "MCP protocol", "event loop" instead of "loop log").
2. Fix grammar and punctuation while preserving the original intent and speaker's style.
3. If the transcript is already clear, return it as is.
4. If the transcript is pure noise or meaningless, return it as is.
5. Do NOT add new information. Only fix the existing text.
6. Return ONLY the refined text. No explanations.

CONTEXT:
The meeting involves topics like software development, programming languages, web frameworks, AI models, protocols, and software architecture. Fix common technical misspellings based on context while preserving the original intent.`

export class TranscriptRefiner {
    constructor(private groq: GroqService) { }

    async refine(text: string, context: string): Promise<string> {
        if (!text || text.length < 5) return text

        try {
            const refined = await this.groq.generateAnswer({
                transcript: text,
                systemPrompt: REFINER_SYSTEM_PROMPT,
                userPrompt: `Raw Transcript: "${text}"\n\nRecent Context:\n${context}\n\nRefined Transcript:`,
                temperature: 0.1,
                maxTokens: 100,
            })

            const final = refined.replace(/^["']|["']$/g, "").trim()
            return final || text
        } catch (err) {
            console.error("[Refiner] Error refining transcript:", err)
            return text
        }
    }
}
