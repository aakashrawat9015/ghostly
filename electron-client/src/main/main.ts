import { app, BrowserWindow, ipcMain } from "electron"
import path from "path"
import { Worker } from "worker_threads"
import "dotenv/config"

import { WorkerBridge } from "./workers/WorkerBridge"
import { AudioService } from "./services/AudioService"
import { MicService } from "./services/MicService"
import { PipelineCoordinator } from "./coordinators/PipelineCoordinator"
import { registerIpc } from "./ipc"

// ✅ IMPORT WINDOWS
import { createOverlayWindow } from "./windows/overlayWindow"
import { createMainWindow } from "./windows/mainWindow"

const isDev = !app.isPackaged
const DEBUG = process.env.DEBUG === "true"

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let coordinator: PipelineCoordinator | null = null
let isQuitting = false

app.whenReady().then(() => {
    // ✅ USE THEM HERE
    mainWindow = createMainWindow(isDev)
    overlayWindow = createOverlayWindow(isDev)

    const workerPath = path.join(__dirname, "workers", "audio", "audio.worker.js")

    const workerBridge = new WorkerBridge(
        () => new Worker(workerPath, { env: process.env })
    )

    const audioService = new AudioService();
    const micService = new MicService();

    // ── Worker → UI ─────────────────────────────

    workerBridge.onIntent(({ intent }) => {
        // Early intent signal — show UI state before LLM responds
        console.log("[IPC SEND] ai:intent →", intent)
        overlayWindow?.webContents.send("ai:intent", intent)
    })

    workerBridge.onResult((result) => {
        console.log("[IPC SEND] ai:answer → intent:", result.intent, "| confidence:", result.confidence, "| text:", result.text.slice(0, 80))
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            const safeShow = (overlayWindow as any).safeShow
            if (typeof safeShow === "function") safeShow()
            else overlayWindow.showInactive()
            console.log("[MAIN → OVERLAY] ai:answer sent")
            overlayWindow.webContents.send("ai:answer", result)
        }
        mainWindow?.webContents.send("ai:answer", result)
    })

    // ✅ Stream chunks to overlay as tokens arrive — shows text before full response is done
    workerBridge.onResultChunk(({ accumulated }) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send("ai:answer:chunk", accumulated)
        }
    })

    workerBridge.onSummary((text) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send("ai:summary", text)
        }
    })

    workerBridge.onTranscriptPartial((text) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            console.log("[MAIN → RENDERER] transcript:partial", text.slice(0, 50))
            overlayWindow.webContents.send("transcript:partial", text)
        }
    })

    workerBridge.onTranscriptFinal((text) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            console.log("[MAIN → RENDERER] transcript:final", text.slice(0, 50))
            overlayWindow.webContents.send("transcript:final", text)
        }
    })

    // Corrected transcript — replaces the raw final on the overlay
    workerBridge.onTranscriptFinalCorrected((text) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            if (DEBUG) console.log("[MAIN → RENDERER] transcript:final:corrected", text.slice(0, 50))
            overlayWindow.webContents.send("transcript:final:corrected", text)
        }
    })

    workerBridge.onTranscriptClear(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            console.log("[MAIN → RENDERER] transcript:clear")
            overlayWindow.webContents.send("transcript:clear")
        }
    })

    workerBridge.onLog((msg) => {
        // ... generic logs ...
    })

    workerBridge.onError((err) => {
        overlayWindow?.webContents.send("ai:error", err)
    })

    // ── Coordinator ─────────────────────────────

    coordinator = new PipelineCoordinator(
        audioService,
        micService,
        workerBridge
    )

    // ── IPC ─────────────────────────────────────

    if (coordinator && overlayWindow) {
        registerIpc({ coordinator, overlayWindow })
    }

    // Active file path from renderer → forward to worker for keyword extraction
    ipcMain.on("active-file:set", (_evt, filePath: string) => {
        if (DEBUG) console.log("[MAIN] active-file:set →", filePath)
        workerBridge.setActiveFile(filePath ?? "")
    })
})

app.on("before-quit", () => {
    isQuitting = true
    coordinator?.stop()
})

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
    mainWindow?.show()
})