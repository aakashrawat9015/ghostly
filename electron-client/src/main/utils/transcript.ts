// location: ghostly/apps/electron-client/src/main/utils/transcript.ts

import {
    cleanTranscript as baseClean,
    extractCoreQuestion,
    isMeaningful as baseIsMeaningful,
    isFollowUp as baseIsFollowUp
} from '../services/llm/filters'

export function cleanTranscript(text: string): string {
    return baseClean(text)
}

export function extractQuestion(text: string): string {
    return extractCoreQuestion(text)
}

export function isMeaningful(text: string, requireQuestion = false): boolean {
    return baseIsMeaningful(text, requireQuestion)
}

export function isFollowUp(text: string): boolean {
    return baseIsFollowUp(text)
}

// ✅ IMPROVED: Two-stage approach - preserve original for classification
export function prepareForProcessing(rawText: string): {
    original: string,
    cleaned: string,
    shouldProcess: boolean
} {
    // Step 1: Basic cleaning
    const cleaned = cleanTranscript(rawText)

    // Step 2: Check if meaningful
    if (!isMeaningful(cleaned, false)) {
        return {
            original: rawText,
            cleaned: "",
            shouldProcess: false
        }
    }

    // Step 3: Extract core if it's better
    const extracted = extractCoreQuestion(cleaned)
    const final = (extracted && extracted.length >= cleaned.length * 0.5)
        ? extracted
        : cleaned

    return {
        original: rawText,
        cleaned: final,
        shouldProcess: true
    }
}