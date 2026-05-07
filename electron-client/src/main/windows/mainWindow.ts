import { BrowserWindow } from "electron"
import path from "path"

export function createMainWindow(isDev: boolean): BrowserWindow {
    const win = new BrowserWindow({
        width: 600,
        height: 400,
        show: false,
        frame: true,
        // skipTaskbar: true, // ✅ hide from taskbar
        webPreferences: {
            preload: path.join(__dirname, "../../preload/preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    win.once("ready-to-show", () => {
        win.center()
        win.show()
        win.focus()
    })

    // 🔥 Screen share protection
    win.setContentProtection(true)

    if (isDev) {
        win.loadURL("http://localhost:5173/#/control")
    } else {
        win.loadFile(
            path.join(__dirname, "../../renderer/index.html"),
            { hash: "/control" }
        )
    }

    return win
}