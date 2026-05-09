// prompts.ts
import type { IntentType } from "./triggers"

// ── Cached domain context (sent once, short) ─────────────────
// Keep this minimal — every extra token adds latency on Groq
const DOMAIN = `You are assisting in a live meeting. Answer ONLY based on what was said in the transcript. Do NOT introduce topics, technologies, or concepts not mentioned. No "I". Direct answers only. If the question is vague, answer the most literal interpretation.`

export const PROMPTS: Record<Exclude<IntentType, "none">, string> = {
    question: `${DOMAIN}
Output: 2-3 bullet points. No filler. No clarifying questions. No invented context.`,

    explanation: `${DOMAIN}
Output exactly 3 bullets: • WHAT • WHY • EXAMPLE — each max 10 words. Only use what's in the transcript.`,

    decision: `${DOMAIN}
Output: • REC • WHY • RISK — one line each. Base it only on what was discussed.`,

    problem: `${DOMAIN}
Output: • CAUSE • CHECK • FIX — one line each.`,

    context: `${DOMAIN}
Output: ONE line starting with Consider/Watch/Ask/Risk. If nothing useful: LISTENING`,
}

export function buildUserPrompt(
    context: string,
    latest: string,
    intent: Exclude<IntentType, "none">
): string {
    const trimmedContext = (context || "").trim().slice(-400)

    return trimmedContext
        ? `TRANSCRIPT CONTEXT (only use this, nothing else):\n${trimmedContext}\n\nQUESTION FROM TRANSCRIPT: "${latest}"`
        : `QUESTION FROM TRANSCRIPT: "${latest}"\n(No prior context — answer only what this question literally asks.)`
}

export const SYSTEM_PROMPT = PROMPTS.question
