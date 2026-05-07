import { BrowserWindow, screen } from "electron" // Added screen
import path from "path"

export function createOverlayWindow(isDev: boolean): BrowserWindow {
    // 1. Get the screen dimensions
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth } = primaryDisplay.workAreaSize;

    // 2. Define window size
    const winWidth = 800;
    const winHeight = 600;

    // 3. Calculate "Middle Top" coordinates
    const x = Math.floor((screenWidth / 2) - (winWidth / 2));
    const y = 20; // 20px below the top edge (just below the camera)

    const win = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        x: x, // Set calculated X
        y: y, // Set calculated Y
        frame: false,
        transparent: true,
        resizable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        hasShadow: false,
        backgroundColor: "#00000000",
        show: false, // ✅ IMPORTANT: prevent early show
        webPreferences: {
            preload: path.join(__dirname, "../../preload/preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
        },
    })

    let isReady = false

    win.once("ready-to-show", () => {
        isReady = true
    })

    // ✅ SAFE SHOW (fixes first-click issue)
    function safeShow() {
        if (win.isDestroyed()) return

        if (isReady) {
            win.showInactive()
        } else {
            win.once("ready-to-show", () => {
                if (!win.isDestroyed()) win.showInactive()
            })
        }
    }

    // attach method (clean workaround)
    ; (win as any).safeShow = safeShow

    // 🔥 Overlay behavior
    win.setIgnoreMouseEvents(true, { forward: true })
    win.setAlwaysOnTop(true, "screen-saver")

    win.setContentProtection(true) // Enable this for true Cluely stealth

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