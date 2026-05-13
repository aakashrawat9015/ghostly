import { BrowserWindow, screen, ipcMain } from "electron"
import path from "path"

const WIN_WIDTH = 580
const WIN_MIN_HEIGHT = 52   // just the header bar
const WIN_MAX_HEIGHT = 600  // cap so it never goes full screen
const WIN_Y = 20            // px from top edge

export function createOverlayWindow(isDev: boolean): BrowserWindow {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
    const x = Math.floor((screenWidth / 2) - (WIN_WIDTH / 2))

    const win = new BrowserWindow({
        width: WIN_WIDTH,
        height: WIN_MIN_HEIGHT,
        minHeight: WIN_MIN_HEIGHT,
        maxHeight: WIN_MAX_HEIGHT,
        x,
        y: WIN_Y,
        frame: false,
        transparent: true,
        resizable: false,       // user can't resize — we control it programmatically
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
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

    // ── Dynamic resize from renderer ──────────────────────────
    // Renderer measures its own DOM height and sends it here.
    // We clamp it and animate via setBounds for a smooth feel.
    ipcMain.on("overlay:resize", (_evt, contentHeight: number) => {
        if (win.isDestroyed()) return
        const clamped = Math.max(WIN_MIN_HEIGHT, Math.min(Math.ceil(contentHeight), WIN_MAX_HEIGHT))
        const [currentX, currentY] = win.getPosition()
        const [currentW] = win.getSize()
        // setBounds is instant; use animate:true for smooth resize on macOS
        win.setBounds({ x: currentX, y: currentY, width: currentW, height: clamped }, true)
    })

    if (isDev) {
        win.loadURL("http://localhost:5173/#/overlay")
    } else {
        win.loadFile(
            path.join(__dirname, "../../renderer/index.html"),
            { hash: "/overlay" }
        )
    }

    win.on("close", (e) => {
        e.preventDefault()
        win.hide()
    })

    return win
}