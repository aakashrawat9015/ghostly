import { app, BrowserWindow, ipcMain } from "electron"
import path from "path"
import { Worker } from "worker_threads"
import "dotenv/config"

import { WorkerBridge } from "./workers/WorkerBridge"
import { AudioService } from "./services/AudioService"
import { MicService } from "./services/MicService"
import { PipelineCoordinator } from "./coordinators/PipelineCoordinator"
import { ProjectIndexer } from "./utils/ProjectIndexer"
import { registerIpc } from "./ipc"

import { createOverlayWindow } from "./windows/overlayWindow"
import { createMainWindow } from "./windows/mainWindow"

const isDev = !app.isPackaged
const DEBUG = process.env.DEBUG === "true"

// 🔥 Performance & GPU Optimization Switches
app.commandLine.appendSwitch("ignore-gpu-blocklist")
app.commandLine.appendSwitch("enable-gpu-rasterization")
app.commandLine.appendSwitch("enable-zero-copy")
app.commandLine.appendSwitch("max-tiles-for-interest-area", "512")

let isQuitting = false
let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let coordinator: PipelineCoordinator | null = null

// ── Window Sync Helpers ─────────────────────────────────────

function syncOverlayPosition() {
    if (!mainWindow || !overlayWindow || mainWindow.isDestroyed() || overlayWindow.isDestroyed()) return

    const bounds = mainWindow.getBounds()
    const ovBounds = overlayWindow.getBounds()
    
    // Atomic update of position and width to prevent jitter
    overlayWindow.setBounds({
        x: bounds.x,
        y: bounds.y + bounds.height,
        width: bounds.width,
        height: ovBounds.height
    })
}

let syncInterval: NodeJS.Timeout | null = null
function startSyncLoop() {
    if (syncInterval) return
    syncInterval = setInterval(syncOverlayPosition, 16) // 60fps for smooth dragging
}
function stopSyncLoop() {
    if (syncInterval) {
        clearInterval(syncInterval)
        syncInterval = null
    }
    syncOverlayPosition() // Final snap to perfect position
}

// ── Project indexer — Instance only (Method called in whenReady) ──
const projectIndexer = new ProjectIndexer()

app.whenReady().then(() => {
    mainWindow = createMainWindow(isDev)
    overlayWindow = createOverlayWindow(isDev)

    // ✅ Initial sync immediately after creation
    syncOverlayPosition()

    mainWindow.on("close", (e) => {
        if (!isQuitting) {
            e.preventDefault()
            mainWindow?.hide()
        }
    })

    overlayWindow.on("close", (e) => {
        if (!isQuitting) {
            e.preventDefault()
            overlayWindow?.hide()
        }
    })

    // ── Window Synchronization ───────────────────────────────

    // standard move/resize events
    mainWindow.on("move", syncOverlayPosition)
    mainWindow.on("resize", syncOverlayPosition)
    
    // Start high-frequency sync loop during active movement
    mainWindow.on("will-move", startSyncLoop)
    mainWindow.on("moved", stopSyncLoop)
    
    // Fallback focus/blur loop to ensure it stays in sync
    mainWindow.on("focus", startSyncLoop)
    mainWindow.on("blur", stopSyncLoop)

    // Initial sync after a short delay to ensure windows are rendered
    setTimeout(syncOverlayPosition, 200)

    const workerPath = path.join(__dirname, "workers", "audio", "audio.worker.js")
    const workerBridge = new WorkerBridge(
        () => new Worker(workerPath, { env: process.env })
    )

    const audioService = new AudioService();
    const micService = new MicService();

    // ── Worker → UI Bridge ─────────────────────────────

    workerBridge.onIntent(({ intent }) => {
        overlayWindow?.webContents.send("ai:intent", intent)
    })

    workerBridge.onResult((result) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            const safeShow = (overlayWindow as any).safeShow
            if (typeof safeShow === "function") safeShow()
            else overlayWindow.showInactive()
            overlayWindow.webContents.send("ai:answer", result)
        }
        mainWindow?.webContents.send("ai:answer", result)
    })

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
            overlayWindow.webContents.send("transcript:partial", text)
        }
    })

    workerBridge.onTranscriptFinal((text) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send("transcript:final", text)
        }
    })

    workerBridge.onTranscriptFinalCorrected((text) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send("transcript:final:corrected", text)
        }
    })

    workerBridge.onTranscriptClear(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send("transcript:clear")
        }
    })

    workerBridge.onError((err) => {
        overlayWindow?.webContents.send("ai:error", err)
    })

    // ── Coordinator ─────────────────────────────
    coordinator = new PipelineCoordinator(audioService, micService, workerBridge)

    if (coordinator && overlayWindow) {
        registerIpc({ coordinator, overlayWindow })
    }

    ipcMain.on("active-file:set", (_evt, filePath: string) => {
        workerBridge.setActiveFile(filePath ?? "")
    })

    // ✅ ONLY CALL INDEXER ONCE HERE
    projectIndexer.indexProject(process.cwd())
        .then(() => {
            const symbols = projectIndexer.getAllSymbolNames()
            workerBridge.setProjectSymbols(symbols)
            if (DEBUG) console.log(`[MAIN] Sent ${symbols.length} symbols to worker`)
        })
        .catch(e => console.error("[MAIN] Re-index failed:", e?.message))

    ipcMain.on("overlay:opacity:set", (_evt, opacity: number) => {
        if (!overlayWindow) return
        overlayWindow.setOpacity(opacity)
        if (opacity < 0.35) {
            overlayWindow.setIgnoreMouseEvents(true, { forward: true })
        } else {
            overlayWindow.setIgnoreMouseEvents(false)
        }
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
