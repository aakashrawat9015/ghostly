export { }

export type STTMode = "technical" | "general" | "meeting"

export type IntentType =
    | "question"
    | "decision"
    | "problem"
    | "explanation"
    | "context"
    | "none"

export type AIResult = {
    text: string
    intent: Exclude<IntentType, "none">
    confidence: number
}

export type Reply =
    | { ok: true; already?: true }
    | { ok: false; error: string }

declare global {
    interface Window {
        api: {
            startRecording: () => Promise<Reply>
            stopRecording: () => Promise<Reply>

            onAIAnswer: (cb: (result: AIResult) => void) => () => void
            onAIIntent: (cb: (intent: Exclude<IntentType, "none">) => void) => () => void

            onTranscriptPartial: (cb: (text: string) => void) => () => void
            onTranscriptFinal: (cb: (text: string) => void) => () => void
            onTranscriptFinalCorrected: (cb: (text: string) => void) => () => void
            onTranscriptClear: (cb: () => void) => () => void

            onAIAnswerChunk: (cb: (accumulated: string) => void) => () => void
            onAISummary: (cb: (text: string) => void) => () => void
            onAIError: (cb: (message: string) => void) => () => void

            setActiveFile: (filePath: string) => void
            setOverlayInteractive: (interactive: boolean) => Promise<Reply>
            resizeOverlay: (height: number) => void
            setSTTMode: (mode: STTMode) => Promise<Reply>
            setOverlayOpacity: (opacity: number) => void
        }
    }
}