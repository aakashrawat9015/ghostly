import { ipcMain, BrowserWindow } from "electron"

export function registerWindowIpc(deps: {
    overlayWindow: BrowserWindow
}) {
    ipcMain.on("overlay:visibility:set", (_evt, visible: boolean) => {
        if (deps.overlayWindow.isDestroyed()) return
        if (visible) {
            // Use safeShow if available or just showInactive
            const safeShow = (deps.overlayWindow as any).safeShow
            if (typeof safeShow === "function") safeShow()
            else deps.overlayWindow.showInactive()
        } else {
            deps.overlayWindow.hide()
        }
    })

    ipcMain.on("overlay:opacity:set", (_evt, opacity: number) => {
        if (deps.overlayWindow.isDestroyed()) return
        // opacity should be between 0 and 1
        deps.overlayWindow.setOpacity(Math.max(0, Math.min(1, opacity)))
    })
}
