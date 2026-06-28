// src/preload/preload.ts
import { contextBridge, ipcRenderer } from "electron"
import type { AIResult } from "../main/services/llm/types"
import type { IntentType } from "../main/services/llm/triggers"

type OkReply = { ok: true; already?: true }
type ErrReply = { ok: false; error: string }
type Reply = OkReply | ErrReply

const validSendChannels = ["audio-command", "worker-task"] as const
const validOnChannels = ["audio-chunk", "worker-response"] as const

contextBridge.exposeInMainWorld("electron", {
    send: (channel: (typeof validSendChannels)[number], data: unknown) => {
        if (validSendChannels.includes(channel)) ipcRenderer.send(channel, data)
    },

    on: (channel: (typeof validOnChannels)[number], func: (...args: any[]) => void) => {
        if (!validOnChannels.includes(channel)) return () => { }
        const handler = (_event: unknown, ...args: any[]) => func(...args)
        ipcRenderer.on(channel, handler)
        return () => ipcRenderer.removeListener(channel, handler)
    },
})

contextBridge.exposeInMainWorld("api", {
    startRecording: (): Promise<Reply> => ipcRenderer.invoke("audio:record:start"),
    stopRecording: (): Promise<Reply> => ipcRenderer.invoke("audio:record:stop"),

    onAIAnswer: (cb: (result: AIResult) => void) => {
        const handler = (_: unknown, result: AIResult) => {
            console.log(`[RENDERER] result: ${result.text?.slice(0, 120)}`)
            console.log("[IPC RECEIVED] ai:answer | intent:", result.intent, "| confidence:", result.confidence, "| text:", result.text?.slice(0, 80))
            cb(result)
        }
        ipcRenderer.on("ai:answer", handler)
        return () => ipcRenderer.removeListener("ai:answer", handler)
    },

    onAIIntent: (cb: (intent: Exclude<IntentType, "none">) => void) => {
        const handler = (_: unknown, intent: Exclude<IntentType, "none">) => {
            console.log("[IPC RECEIVED] ai:intent →", intent)
            cb(intent)
        }
        ipcRenderer.on("ai:intent", handler)
        return () => ipcRenderer.removeListener("ai:intent", handler)
    },

    onTranscriptPartial: (cb: (text: string) => void) => {
        const handler = (_: unknown, text: string) => cb(text)
        ipcRenderer.on("transcript:partial", handler)
        return () => ipcRenderer.removeListener("transcript:partial", handler)
    },

    onTranscriptFinal: (cb: (text: string) => void) => {
        const handler = (_: unknown, text: string) => cb(text)
        ipcRenderer.on("transcript:final", handler)
        return () => ipcRenderer.removeListener("transcript:final", handler)
    },

    // Corrected transcript — replaces the last final with the LLM-cleaned version
    onTranscriptFinalCorrected: (cb: (text: string) => void) => {
        const handler = (_: unknown, text: string) => cb(text)
        ipcRenderer.on("transcript:final:corrected", handler)
        return () => ipcRenderer.removeListener("transcript:final:corrected", handler)
    },

    onTranscriptClear: (cb: () => void) => {
        const handler = () => cb()
        ipcRenderer.on("transcript:clear", handler)
        return () => ipcRenderer.removeListener("transcript:clear", handler)
    },

    // Send active file path to main process for keyword extraction
    setActiveFile: (filePath: string) => {
        ipcRenderer.send("active-file:set", filePath)
    },

    // ✅ Streaming: called with accumulated text as tokens arrive
    onAIAnswerChunk: (cb: (accumulated: string) => void) => {
        const handler = (_: unknown, accumulated: string) => cb(accumulated)
        ipcRenderer.on("ai:answer:chunk", handler)
        return () => ipcRenderer.removeListener("ai:answer:chunk", handler)
    },

    onAISummary: (cb: (text: string) => void) => {
        const handler = (_: unknown, text: string) => cb(text)
        ipcRenderer.on("ai:summary", handler)
        return () => ipcRenderer.removeListener("ai:summary", handler)
    },

    onAIError: (cb: (message: string) => void) => {
        const handler = (_: unknown, message: string) => cb(message)
        ipcRenderer.on("ai:error", handler)
        return () => ipcRenderer.removeListener("ai:error", handler)
    },

    setOverlayInteractive: (interactive: boolean): Promise<Reply> =>
        ipcRenderer.invoke("overlay:setInteractive", interactive),

    resizeOverlay: (height: number) => {
        ipcRenderer.send("overlay:resize", height)
    },

    setSTTMode: (mode: any): Promise<Reply> =>
        ipcRenderer.invoke("audio:mode:set", mode),

    setOverlayOpacity: (opacity: number) => {
        ipcRenderer.send("overlay:opacity:set", opacity)
    },
})