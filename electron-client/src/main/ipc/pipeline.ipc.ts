import { ipcMain, BrowserWindow } from "electron"
import { PipelineCoordinator } from "../coordinators/PipelineCoordinator"

const DEBUG = process.env.DEBUG === "true"

type Reply = { ok: true } | { ok: false; error: string }

export function registerPipelineIpc(deps: {
    coordinator: PipelineCoordinator
    overlayWindow: BrowserWindow
    state: {
        overlayInteractive: boolean
    }
}) {
    // ✅ prevent duplicate registrations
    ipcMain.removeHandler("overlay:setInteractive")
    ipcMain.removeHandler("pipeline:status")

    ipcMain.handle(
        "overlay:setInteractive",
        async (_evt, interactive: boolean): Promise<Reply> => {
            try {
                if (deps.overlayWindow.isDestroyed()) return { ok: false, error: "Overlay window destroyed" }

                deps.state.overlayInteractive = interactive

                if (DEBUG) console.log("[IPC][overlay] setInteractive:", interactive)

                // interactive=true => allow clicks, allow focus
                deps.overlayWindow.setIgnoreMouseEvents(!interactive, { forward: true })
                deps.overlayWindow.setFocusable(interactive)

                // if user makes it interactive, ensure it's visible
                if (interactive) deps.overlayWindow.showInactive()

                return { ok: true }
            } catch (e: any) {
                const msg = e?.message ?? "Failed to set overlay interactive"
                console.error("[IPC][overlay] setInteractive error:", msg)
                return { ok: false, error: msg }
            }
        }
    )

    ipcMain.handle("pipeline:status", async () => {
        return {
            ok: true,
            running: deps.coordinator.running,
            overlayInteractive: deps.state.overlayInteractive,
        }
    })
}