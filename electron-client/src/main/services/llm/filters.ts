// location: ghostly/apps/electron-client/src/main/services/llm/filters.ts

// ═══════════════════════════════════════════════════════════════
// NOISE REMOVAL
// ═══════════════════════════════════════════════════════════════

const NOISE_TOKENS = [
    /\[BLANK_AUDIO\]/gi,
    /\[silence\]/gi,
    /\(laughing\)/gi,
    /\(applause\)/gi,
    /\(music.*?\)/gi,
    /\[.*?\]/g,
]

// Only TRUE fillers (safe to remove)
const TRUE_FILLERS = [
    '\\buh\\b',
    '\\bum\\b',
    '\\bhmm\\b',
    '\\bmhm\\b',
    '\\berr\\b',
    '\\bahh\\b'
]

// ═══════════════════════════════════════════════════════════════
// RESPONSE FILTERING
// ═══════════════════════════════════════════════════════════════

export const REJECT_RESPONSES: RegExp[] = [
    /^i('m| am) (not sure|unable|sorry)[^.]*\.?\s*$/i,
    /^(i don't|i do not) have (enough|sufficient|the)[^.]*\.?\s*$/i,
    /^(as an ai|as a language model)[^.]*\.?\s*$/i,
    /^i need more (context|information)[^.]*\.?\s*$/i,
    /^(sorry|i'm sorry)[^.]*\.?\s*$/i,
]

// ═══════════════════════════════════════════════════════════════
// CLEANING
// ═══════════════════════════════════════════════════════════════

export function cleanText(text: string): string {
    let t = text ?? ""
    for (const p of NOISE_TOKENS) t = t.replace(p, "")
    return t.replace(/\s+/g, " ").trim()
}

export function cleanTranscript(text: string): string {
    if (!text) return ""

    let cleaned = text.trim()

    // Remove ONLY safe fillers
    const fillerPattern = new RegExp(`(${TRUE_FILLERS.join('|')})`, 'gi')
    cleaned = cleaned.replace(fillerPattern, ' ')

    // Fix stuttering: "do do do" → "do"
    cleaned = cleaned.replace(/\b(\w+)(\s+\1)+\b/gi, '$1')

    // Remove long pauses
    cleaned = cleaned.replace(/\.{2,}/g, ' ')

    // Normalize spacing
    cleaned = cleaned.replace(/\s{2,}/g, ' ')

    // Normalize punctuation
    cleaned = cleaned.replace(/,\s*\?/g, '?')
    cleaned = cleaned.replace(/\?+/g, '?')

    return cleaned.trim()
}

// ═══════════════════════════════════════════════════════════════
// QUESTION EXTRACTION
// ═══════════════════════════════════════════════════════════════

export function extractCoreQuestion(text: string): string {
    const cleaned = cleanTranscript(text)
    if (!cleaned) return ""

    // 1. Direct command-style questions
    const commandMatch = cleaned.match(
        /(tell me|explain|describe|show|give|walk me through|talk about)\s+.+/i
    )
    if (commandMatch) return commandMatch[0].trim()

    // 2. Standard WH questions
    const whMatch = cleaned.match(
        /(what|how|why|when|where|who|which|can|could|do|does|is|are)\s+.+\??/i
    )
    if (whMatch) return whMatch[0].trim()

    // 3. Follow-up detection (IMPORTANT)
    if (isFollowUp(cleaned)) {
        return cleaned
    }

    return cleaned
}

// ═══════════════════════════════════════════════════════════════
// MEANINGFUL INPUT DETECTION
// ═══════════════════════════════════════════════════════════════

export function isMeaningful(text: string, requireQuestion = false): boolean {
    const cleaned = cleanTranscript(text)
    if (!cleaned) return false

    // Allow short follow-ups like "why?", "how?"
    if (isFollowUp(cleaned)) return true

    if (cleaned.length < 3) return false

    const words = cleaned.toLowerCase().split(/\s+/)

    const meaningfulWords = words.filter(w =>
        w.length > 2 &&
        !['the', 'and', 'but', 'for', 'with'].includes(w)
    )

    if (meaningfulWords.length < 1) return false

    if (requireQuestion) {
        const hasQuestionWord =
            /\b(what|how|why|when|where|who|which|is|are|do|does|can|could|tell|explain|show)\b/i.test(cleaned)

        const hasQuestionMark = cleaned.includes('?')

        return hasQuestionWord || hasQuestionMark
    }

    return true
}

// ═══════════════════════════════════════════════════════════════
// FOLLOW-UP DETECTION (CRITICAL FIX)
// ═══════════════════════════════════════════════════════════════

export function isFollowUp(text: string): boolean {
    const t = text.toLowerCase().trim()

    // Strong follow-up phrases
    const strongPatterns = [
        /^why\b/,
        /^how\b/,
        /^what about\b/,
        /^and\b/,
        /^also\b/,
        /^then\b/,
    ]

    if (strongPatterns.some(p => p.test(t))) return true

    // Weak but useful follow-ups
    const weakPatterns = [
        /\b(explain more|more details|elaborate)\b/,
        /\b(go on|continue|tell me more)\b/,
        /\b(example|for example|instance)\b/,
    ]

    if (weakPatterns.some(p => p.test(t))) return true

    // Short follow-up queries
    if (t.length < 20 && /\b(why|how|more|details|example)\b/.test(t)) {
        return true
    }

    return false
}

// ═══════════════════════════════════════════════════════════════
// TRANSCRIPT WINDOW
// ═══════════════════════════════════════════════════════════════

export function trimTranscript(text: string): string {
    const sentences = (text ?? "").split(/(?<=[.?!])\s+/)
    return sentences.slice(-5).join(" ").trim()
}

// ═══════════════════════════════════════════════════════════════
// SIMILARITY CHECK (FIXED ROOT BUG)
// ═══════════════════════════════════════════════════════════════

export function isSimilar(a: string, b: string): boolean {
    if (!a || !b) return false

    // ❌ NEVER dedup short inputs (this was breaking follow-ups)
    if (a.length < 60 || b.length < 60) return false

    const normalize = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim()

    const x = normalize(a)
    const y = normalize(b)

    const wordsA = new Set(x.split(/\s+/).filter(w => w.length > 3))
    const wordsB = new Set(y.split(/\s+/).filter(w => w.length > 3))

    if (!wordsA.size || !wordsB.size) return false

    const intersection = [...wordsA].filter(w => wordsB.has(w)).length
    const overlap = intersection / Math.min(wordsA.size, wordsB.size)

    // Stricter threshold
    return overlap > 0.85
}