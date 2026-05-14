import { BrowserWindow, screen, ipcMain } from "electron"
import path from "path"

const WIN_WIDTH = 700
const WIN_MIN_HEIGHT = 1 
const WIN_MAX_HEIGHT = 600

export function createOverlayWindow(isDev: boolean): BrowserWindow {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
    const x = Math.floor((screenWidth / 2) - (WIN_WIDTH / 2))

    const win = new BrowserWindow({
        width: WIN_WIDTH,
        height: WIN_MIN_HEIGHT,
        minHeight: WIN_MIN_HEIGHT,
        maxHeight: WIN_MAX_HEIGHT,
        x,
        y: 0, // 👈 CHANGE THIS: Set to 0, let main.ts handle positioning
        frame: false,
        transparent: true,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        fullscreenable: false,
        maximizable: false,
        minimizable: false,
        backgroundColor: "#00000000",
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "../../preload/preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    let isReady = false
    win.once("ready-to-show", () => { isReady = true })

    function safeShow() {
        if (win.isDestroyed()) return
        if (isReady) win.showInactive()
        else win.once("ready-to-show", () => { if (!win.isDestroyed()) win.showInactive() })
    }
    ;(win as any).safeShow = safeShow

    win.setIgnoreMouseEvents(true, { forward: true })
    win.setAlwaysOnTop(true, "screen-saver")
    win.setContentProtection(true)

    // ✅ FIX: Change setBounds to setSize to avoid resetting position
    ipcMain.on("overlay:resize", (_evt, contentHeight: number) => {
        if (win.isDestroyed()) return
        const clamped = Math.max(WIN_MIN_HEIGHT, Math.min(Math.ceil(contentHeight), WIN_MAX_HEIGHT))
        
        const [currentW] = win.getSize()
        win.setSize(currentW, clamped, true) 
    })

    if (isDev) {
        win.loadURL("http://localhost:5173/#/overlay")
    } else {
        win.loadFile(
            path.join(__dirname, "../../renderer/index.html"),
            { hash: "/overlay" }
        )
    }

    return win
}