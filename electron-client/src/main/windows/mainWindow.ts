import { BrowserWindow, screen } from "electron"
import path from "path"

export function createMainWindow(isDev: boolean): BrowserWindow {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
    const width = 700
    const height = 64
    const x = Math.floor((screenWidth / 2) - (width / 2))
    // const y = screenHeight - height - 100 // 100px from bottom (floating)
    const y = 60 // 60px from top (floating)

    const win = new BrowserWindow({
        width,
        height,
        x,
        y,
        show: false,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        hasShadow: true,
        skipTaskbar: false,
        fullscreenable: false,
        maximizable: false,
        minimizable: false,
        backgroundColor: "#00000000",
        webPreferences: {
            preload: path.join(__dirname, "../../preload/preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    win.once("ready-to-show", () => {
        win.show()
    })

    // 🔥 Screen share protection
    win.setAlwaysOnTop(true, "screen-saver")
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