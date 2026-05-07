import { ipcMain, BrowserWindow } from "electron"
import { PipelineCoordinator } from "../coordinators/PipelineCoordinator"

const DEBUG = process.env.DEBUG === "true"

type Reply = { ok: true; already?: true } | { ok: false; error: string }

export function registerAudioIpc(deps: {
    coordinator: PipelineCoordinator
    overlayWindow?: BrowserWindow
    state: { overlayInteractive: boolean }
}) {
    ipcMain.removeHandler("audio:record:start")
    ipcMain.removeHandler("audio:record:stop")

    ipcMain.handle("audio:record:start", async (): Promise<Reply> => {
        if (deps.coordinator.running) return { ok: true, already: true }

        try {
            deps.coordinator.startPipeline()

            if (deps.overlayWindow && !deps.overlayWindow.isDestroyed()) {
                if (DEBUG) console.log("[IPC][audio] showing overlay window")
                
                // Ensure UI is fresh
                deps.overlayWindow.webContents.send("transcript:clear")
                
                setTimeout(() => {
                    if (deps.overlayWindow && !deps.overlayWindow.isDestroyed()) {
                        const safeShow = (deps.overlayWindow as any).safeShow
                        if (typeof safeShow === "function") safeShow()
                        else deps.overlayWindow.showInactive()
                    }
                }, 300)
                
                deps.overlayWindow.webContents.once("did-finish-load", () => {
                    console.log("[IPC][audio] Overlay is ready to receive data")
                    deps.overlayWindow?.webContents.send("transcript:clear")
                })

                deps.overlayWindow.setIgnoreMouseEvents(true, { forward: true })
            }

            return { ok: true }
        } catch (e: any) {
            return { ok: false, error: e?.message ?? "Failed to start" }
        }
    })

    ipcMain.handle("audio:record:stop", async (): Promise<Reply> => {
        if (!deps.coordinator.running) return { ok: true, already: true }

        try {
            deps.coordinator.stopPipeline()

            if (deps.overlayWindow && !deps.overlayWindow.isDestroyed()) {
                deps.overlayWindow.webContents.send("transcript:clear")
                deps.overlayWindow.setIgnoreMouseEvents(true, { forward: true })
                deps.overlayWindow.hide()
            }

            return { ok: true }
        } catch (e: any) {
            return { ok: false, error: e?.message ?? "Failed to stop" }
        }
    })

    ipcMain.handle("audio:mode:set", async (_event, mode: any): Promise<Reply> => {
        try {
            deps.coordinator.setMode(mode)
            return { ok: true }
        } catch (e: any) {
            return { ok: false, error: e?.message ?? "Failed to set mode" }
        }
    })
}