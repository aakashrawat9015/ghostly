// src/main/services/llm/CorrectionAgent.ts
import Groq from "groq-sdk"
import fs from "fs"
import { ProjectIndexer } from "../../utils/ProjectIndexer"

const DEBUG = process.env.DEBUG_LLM === "true"

const MODEL = "llama-3.1-8b-instant"
const TIMEOUT_MS = 3000
const MAX_CODE_SNIPPET_CHARS = 1500  // per file — keep prompt short
const MAX_SNIPPETS = 2               // max files to include in context

const SYSTEM_PROMPT = `You are a Speech-to-Text corrector for a live technical coding session.

Your ONLY job: fix words that were MISHEARD by the microphone — where the spoken sound closely matches a technical term.

STRICT RULES:
1. Only correct a word if it SOUNDS SIMILAR to the technical term (phonetic match required)
   GOOD: "em see pee" → "MCP" (sounds like the letters M-C-P)
   GOOD: "next jay es" → "Next.js" (sounds like "Next J S")
   GOOD: "j s" → "JS", "a p i" → "API" (spaced-out acronyms)
   BAD:  "memory" → "MCP" (completely different sounds — do NOT change)
   BAD:  "creation" → any tech term (it's a real English word — do NOT change)
2. NEVER replace a real English word (memory, creation, context, function, class, etc.)
   with a technical term unless the sounds are nearly identical
3. PRESERVE sentence structure, word order, and length exactly
4. PRESERVE all punctuation — especially "?" — never remove it
5. Do NOT add words that were not spoken
6. If in doubt, leave the word unchanged — wrong corrections are worse than no correction
7. Return ONLY the corrected text. No explanations, no quotes, no labels.`

export interface CorrectionResult {
    corrected: string
    latencyMs: number
    usedFallback: boolean
}

export class CorrectionAgent {
    private client: Groq | null = null

    constructor(private indexer: ProjectIndexer) {
        const apiKey = process.env.GROQ_API_KEY
        if (!apiKey) {
            console.warn("[CorrectionAgent] No GROQ_API_KEY — will use fallback (raw text)")
            return
        }
        try {
            const baseURL = (process.env.GROQ_BASE_URL || "https://api.groq.com")
                .replace(/\/openai\/v1\/?$/, "")
                .replace(/\/+$/, "")
            this.client = new Groq({ apiKey, baseURL })
        } catch (e) {
            console.error("[CorrectionAgent] Failed to init Groq client:", e)
        }
    }

    async correct(rawText: string, activeFilePath: string): Promise<CorrectionResult> {
        const start = Date.now()

        if (!this.client || rawText.trim().length < 4) {
            return { corrected: rawText, latencyMs: 0, usedFallback: true }
        }

        // Skip correction if no technical signals are present in the transcript.
        // This avoids the LLM substituting common English words with tech terms.
        if (!this.hasTechnicalSignal(rawText)) {
            return { corrected: rawText, latencyMs: 0, usedFallback: true }
        }

        try {
            const corrected = await Promise.race([
                this.run(rawText, activeFilePath),
                this.timeout(rawText, TIMEOUT_MS),
            ])

            const latencyMs = Date.now() - start

            // Safety: never drop a "?" that was in the original
            const safe = this.safetyCheck(rawText, corrected)

            if (DEBUG && safe !== rawText) {
                console.log(`[CorrectionAgent] ✅ ${latencyMs}ms`)
                console.log(`  Raw:       "${rawText}"`)
                console.log(`  Corrected: "${safe}"`)
            }

            return { corrected: safe, latencyMs, usedFallback: false }
        } catch (e: any) {
            const latencyMs = Date.now() - start
            console.error(`[CorrectionAgent] ❌ ${latencyMs}ms:`, e?.message)
            return { corrected: rawText, latencyMs, usedFallback: true }
        }
    }

    private async run(rawText: string, activeFilePath: string): Promise<string> {
        // ── 1. Find symbols mentioned in the transcript ───────
        const mentionedSymbols = this.indexer.findMentionedSymbols(rawText)

        // ── 2. Collect code snippets for those symbols ────────
        let codeContext = ""
        const seenFiles = new Set<string>()
        let snippetCount = 0

        for (const sym of mentionedSymbols) {
            if (snippetCount >= MAX_SNIPPETS) break
            if (seenFiles.has(sym.filePath)) continue
            seenFiles.add(sym.filePath)

            try {
                const content = fs.readFileSync(sym.filePath, "utf-8")
                const snippet = content.slice(0, MAX_CODE_SNIPPET_CHARS)
                const fileName = sym.filePath.split(/[\\/]/).pop()
                codeContext += `\n[${fileName}]:\n${snippet}\n`
                snippetCount++
            } catch {
                // file unreadable — skip
            }
        }

        // ── 3. Also include all known symbol names + common global tech terms ──
        const globalTechTerms = ["MCP", "MCT", "RAG", "LLM", "STT", "TTS", "VAD", "Groq", "Claude", "ChatGPT"]
        const allSymbols = [...globalTechTerms, ...this.indexer.getAllSymbolNames()].slice(0, 60).join(", ")

        // ── 4. Build user prompt ──────────────────────────────
        const activeFileName = activeFilePath?.split(/[\\/]/).pop() ?? ""
        const parts: string[] = []

        if (allSymbols) {
            parts.push(`KNOWN SYMBOLS: ${allSymbols}`)
        }
        if (activeFileName) {
            parts.push(`ACTIVE FILE: ${activeFileName}`)
        }
        if (codeContext) {
            parts.push(`CODE CONTEXT:${codeContext}`)
        }
        parts.push(`RAW TRANSCRIPT: "${rawText}"`)

        const userPrompt = parts.join("\n\n")

        // ── 5. Call Groq ──────────────────────────────────────
        const res = await this.client!.chat.completions.create({
            model: MODEL,
            temperature: 0,
            max_tokens: 200,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
            ],
        })

        const text = res.choices?.[0]?.message?.content?.trim() ?? ""
        return text.replace(/^["'`]|["'`]$/g, "").trim() || rawText
    }

    private safetyCheck(original: string, corrected: string): string {
        if (original.includes("?") && !corrected.includes("?")) {
            return corrected.trimEnd() + "?"
        }
        return corrected
    }

    /**
     * Returns true only if the transcript contains signals that suggest
     * a technical mishearing actually occurred — spaced-out letters, known
     * acronym patterns, or words that phonetically resemble indexed symbols.
     *
     * This prevents the LLM from substituting plain English words like
     * "memory" or "creation" with technical terms just because they're in context.
     */
    private hasTechnicalSignal(text: string): boolean {
        const t = text.toLowerCase()

        // Spaced-out acronym pattern: "m c p", "j s", "a p i", "t s"
        if (/\b[a-z]\s[a-z](\s[a-z])*\b/.test(t)) return true

        // Phonetic tech patterns: "next jay es", "react jay es", "type script"
        if (/\b(jay\s*es|type\s*script|next\s*jay|react\s*jay|node\s*jay|vue\s*jay)\b/i.test(t)) return true

        // Partial word that sounds like a known acronym
        if (/\b(em\s*see\s*pee|ay\s*pee\s*eye|dee\s*bee|ess\s*kew\s*el)\b/i.test(t)) return true

        // Contains a word that's very close to a known symbol (edit distance 1)
        // Only check short words (≤5 chars) since those are most likely to be misheard acronyms
        const words = t.split(/\s+/)
        const symbols = this.indexer.getAllSymbolNames()
        for (const word of words) {
            if (word.length < 2 || word.length > 5) continue
            for (const sym of symbols) {
                if (sym.length < 2 || sym.length > 6) continue
                if (this.editDistance(word, sym.toLowerCase()) <= 1 && word !== sym.toLowerCase()) {
                    return true
                }
            }
        }

        return false
    }

    /** Levenshtein edit distance */
    private editDistance(a: string, b: string): number {
        const m = a.length, n = b.length
        const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
            Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
        )
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
            }
        }
        return dp[m][n]
    }

    private timeout(rawText: string, ms: number): Promise<string> {
        return new Promise(resolve => setTimeout(() => resolve(rawText), ms))
    }
}
