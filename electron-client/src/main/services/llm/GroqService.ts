// src/main/services/llm/GroqService.ts

const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1"
const DEFAULT_MODEL = "llama-3.1-8b-instant"
const DEFAULT_MAX_TRANSCRIPT_CHARS = 6000

export type GroqChatMessage = {
    role: "system" | "user" | "assistant"
    content: string
}

type GroqChatCompletionResponse = {
    id: string
    choices: Array<{
        index: number
        message: { role: "assistant"; content: string | null }
        finish_reason: string
    }>
    error?: { message?: string; type?: string }
}

export class GroqService {
    private model: string
    private baseUrl: string
    private timeoutMs: number
    private maxTranscriptChars: number

    constructor(
        private apiKey: string,
        opts?: {
            model?: string
            baseUrl?: string
            timeoutMs?: number
            maxTranscriptChars?: number
        }
    ) {
        if (!apiKey) throw new Error("Missing GROQ_API_KEY")

        this.model = opts?.model || process.env.GROQ_MODEL || DEFAULT_MODEL
        this.baseUrl = normalizeBaseUrl(
            opts?.baseUrl || process.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL
        )

        this.timeoutMs = opts?.timeoutMs ?? Number(process.env.GROQ_TIMEOUT_MS ?? 12000)
        this.maxTranscriptChars = opts?.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS
    }

    /**
     * Streaming version — calls onChunk with each token as it arrives.
     * Returns the full accumulated text when done.
     */
    async generateAnswerStream(input: {
        transcript: string
        systemPrompt: string
        userPrompt: string
        temperature?: number
        maxTokens?: number
        additionalMessages?: GroqChatMessage[]
        signal?: AbortSignal
        onChunk: (chunk: string, accumulated: string) => void
    }): Promise<string> {
        const {
            systemPrompt,
            userPrompt,
            temperature = 0.15,
            maxTokens = 150,        // was 350 — shorter = faster completion
            additionalMessages = [],
            signal,
            onChunk,
        } = input

        if (!systemPrompt || !userPrompt) {
            throw new Error("Both systemPrompt and userPrompt are required")
        }

        const messages: GroqChatMessage[] = [
            { role: "system", content: systemPrompt },
            ...additionalMessages,
            { role: "user", content: userPrompt },
        ]

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.timeoutMs)
        const onAbort = () => controller.abort()
        signal?.addEventListener("abort", onAbort, { once: true })

        try {
            const res = await fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: this.model,
                    messages,
                    temperature,
                    max_tokens: maxTokens,
                    stream: true,
                }),
                signal: controller.signal,
            })

            if (!res.ok) {
                const raw = await res.text().catch(() => "")
                throw new Error(`Groq HTTP ${res.status}: ${raw || res.statusText}`)
            }

            if (!res.body) throw new Error("Groq: no response body for streaming")

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let accumulated = ""
            let buffer = ""

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split("\n")
                buffer = lines.pop() ?? "" // keep incomplete line

                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed || trimmed === "data: [DONE]") continue
                    if (!trimmed.startsWith("data: ")) continue

                    try {
                        const json = JSON.parse(trimmed.slice(6))
                        const delta = json.choices?.[0]?.delta?.content
                        if (delta) {
                            accumulated += delta
                            onChunk(delta, accumulated)
                        }
                    } catch {
                        // malformed SSE line — skip
                    }
                }
            }

            return accumulated.trim() || "No answer generated."
        } catch (e: any) {
            if (e?.name === "AbortError") {
                throw new Error(`Groq request timed out/aborted after ${this.timeoutMs}ms`)
            }
            throw e
        } finally {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
    }

    async generateAnswer(input: {
        transcript: string
        systemPrompt: string
        userPrompt: string
        temperature?: number
        maxTokens?: number
        additionalMessages?: GroqChatMessage[]
        signal?: AbortSignal
    }): Promise<string> {
        const {
            transcript,
            systemPrompt,
            userPrompt,
            temperature = 0.15,
            maxTokens = 150,        // was 350
            additionalMessages = [],
            signal,
        } = input

        if (!systemPrompt || !userPrompt) {
            throw new Error("Both systemPrompt and userPrompt are required")
        }

        const messages: GroqChatMessage[] = [
            { role: "system", content: systemPrompt },
            ...additionalMessages,
            { role: "user", content: userPrompt },
        ]

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.timeoutMs)

        const onAbort = () => controller.abort()
        signal?.addEventListener("abort", onAbort, { once: true })

        try {
            const res = await fetch(`${this.baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: this.model,
                    messages,
                    temperature,
                    max_tokens: maxTokens,
                    stream: false,
                }),
                signal: controller.signal,
            })

            const raw = await res.text().catch(() => "")

            if (!res.ok) {
                throw new Error(`Groq HTTP ${res.status}: ${raw || res.statusText}`)
            }

            let data: GroqChatCompletionResponse
            try {
                data = JSON.parse(raw) as GroqChatCompletionResponse
            } catch {
                throw new Error(`Groq parse error: expected JSON but got: ${raw.slice(0, 500)}`)
            }

            const out = data.choices?.[0]?.message?.content?.trim() || ""
            return out || "No answer generated."
        } catch (e: any) {
            if (e?.name === "AbortError") {
                throw new Error(`Groq request timed out/aborted after ${this.timeoutMs}ms`)
            }
            throw e
        } finally {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
    }
}

function truncateTail(text: string, maxChars: number) {
    const t = (text ?? "").trim()
    return t.length <= maxChars ? t : t.slice(t.length - maxChars)
}

function normalizeBaseUrl(url: string) {
    return (url || DEFAULT_GROQ_BASE_URL).replace(/\/+$/, "")
}
