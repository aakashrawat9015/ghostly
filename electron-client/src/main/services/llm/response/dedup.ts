const DEBUG = process.env.DEBUG_LLM === "true"

export interface DedupState {
    lastAnswerText: string
    lastAnswerTime: number
    answerHistory: Array<{ text: string; timestamp: number }>
}

export class ResponseDeduplicator {
    private state: DedupState = {
        lastAnswerText: "",
        lastAnswerTime: 0,
        answerHistory: []
    }

    private readonly MAX_HISTORY = 5
    private readonly SIMILARITY_THRESHOLD = 0.85
    private readonly MIN_TIME_BETWEEN_SIMILAR = 8000   // was 15s — reduced so same Q asked again after 8s gets answered
    private readonly HISTORY_WINDOW_MS = 10000          // was 60s — only check last 10s of history

    isDuplicate(newAnswer: string, currentTime: number): boolean {
        // Check against last answer
        if (this.state.lastAnswerText) {
            const timeSinceLast = currentTime - this.state.lastAnswerTime
            const similarity = this.calculateSimilarity(newAnswer, this.state.lastAnswerText)

            if (similarity > this.SIMILARITY_THRESHOLD && timeSinceLast < this.MIN_TIME_BETWEEN_SIMILAR) {
                if (DEBUG) {
                    console.log(`[Dedup] ❌ Duplicate answer`)
                    console.log(`  Similarity: ${similarity.toFixed(2)}`)
                    console.log(`  Time since last: ${timeSinceLast}ms`)
                }
                return true
            }
        }

        // Check against recent history
        for (const entry of this.state.answerHistory) {
            const timeSince = currentTime - entry.timestamp
            if (timeSince > this.HISTORY_WINDOW_MS) continue  // skip old answers

            const similarity = this.calculateSimilarity(newAnswer, entry.text)
            if (similarity > 0.95) {  // was 0.9 — only block near-identical answers
                if (DEBUG) {
                    console.log(`[Dedup] ❌ Matches answer from ${Math.floor(timeSince / 1000)}s ago`)
                }
                return true
            }
        }

        return false
    }

    recordAnswer(text: string, currentTime: number) {
        this.state.lastAnswerText = text
        this.state.lastAnswerTime = currentTime

        this.state.answerHistory.push({ text, timestamp: currentTime })
        if (this.state.answerHistory.length > this.MAX_HISTORY) {
            this.state.answerHistory.shift()
        }
    }

    private calculateSimilarity(text1: string, text2: string): number {
        const words1 = new Set(text1.toLowerCase().split(/\s+/))
        const words2 = new Set(text2.toLowerCase().split(/\s+/))

        const intersection = new Set([...words1].filter(w => words2.has(w)))
        const union = new Set([...words1, ...words2])

        return intersection.size / union.size
    }

    reset() {
        this.state = {
            lastAnswerText: "",
            lastAnswerTime: 0,
            answerHistory: []
        }
    }
}