import { useState, useCallback } from "react"
import { STTMode } from "../types/window-api"

type RecordingStatus = "idle" | "recording"

const DEBUG = import.meta.env.VITE_DEBUG === "true"

export default function MainWindow() {
    const [status, setStatus] = useState<RecordingStatus>("idle")
    const [loading, setLoading] = useState(false)
    const [opacity, setOpacity] = useState(0.95)
    const [activeMode, setActiveMode] = useState<STTMode>("general")

    const log = (...args: any[]) => {
        if (DEBUG) console.log("[MainWindow]", ...args)
    }

    const handleStart = async () => {
        if (status === "recording") return
        setLoading(true)
        try {
            await window.api?.startRecording?.()
            setStatus("recording")
            log("Recording started")
        } catch (err) {
            console.error("Start failed:", err)
        } finally {
            setLoading(false)
        }
    }

    const handleStop = async () => {
        if (status === "idle") return
        setLoading(true)
        try {
            await window.api?.stopRecording?.()
            setStatus("idle")
            log("Recording stopped")
        } catch (err) {
            console.error("Stop failed:", err)
        } finally {
            setLoading(false)
        }
    }


    const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value)
        setOpacity(val)
        window.api.setOverlayOpacity(val)
    }

    const changeMode = useCallback(async (mode: STTMode) => {
        setActiveMode(mode)
        await window.api.setSTTMode(mode)
    }, [])

    return (
        <div className="flex items-center justify-center w-full h-full font-sans select-none overflow-hidden bg-transparent">
            {/* ── Header Pill Container ── */}
            <div className="flex items-center justify-between w-[620px] h-14 px-5 bg-[#0a0a0f]/75 backdrop-blur-[14px] border border-white/10 rounded-[28px] shadow-[0_8px_32px_rgba(0,0,0,0.4)]">

                {/* Drag Handle + Logo */}
                <div className="flex items-center gap-3 cursor-move -webkit-app-region-drag shrink-0">
                    <div className="relative flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-violet-500 shadow-lg shadow-sky-500/20">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>
                    <span className="text-[13px] font-black text-white tracking-[0.1em] opacity-90"></span>
                </div>

                <div className="flex items-center gap-4 -webkit-app-region-no-drag">
                    {/* Mode Switcher */}
                    <div className="flex items-center bg-white/[0.03] p-1 rounded-2xl border border-white/5">
                        {(["general", "technical", "meeting"] as STTMode[]).map((m) => (
                            <button key={m} onClick={() => changeMode(m)}
                                className={`px-3 py-1 rounded-xl text-[10px] font-bold capitalize transition-all duration-300
                                    ${activeMode === m ? "bg-white/10 text-white shadow-sm" : "text-white/25 hover:text-white/50"}`}>
                                {m}
                            </button>
                        ))}
                    </div>

                    <div className="h-5 w-px bg-white/10" />

                    {/* Main Controls */}
                    <div className="flex items-center gap-3">
                        {status === "idle" ? (
                            <button
                                onClick={handleStart}
                                disabled={loading}
                                className="flex items-center gap-2 px-5 py-2 rounded-2xl bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-black transition-all active:scale-95 shadow-lg shadow-sky-500/30 disabled:opacity-50"
                            >
                                <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                                START
                            </button>
                        ) : (
                            <button
                                onClick={handleStop}
                                disabled={loading}
                                className="flex items-center gap-2 px-5 py-2 rounded-2xl bg-red-500 hover:bg-red-400 text-white text-[11px] font-black transition-all active:scale-95 shadow-lg shadow-red-500/30 disabled:opacity-50"
                            >
                                <div className="w-2 h-2 rounded-full bg-white" />
                                STOP
                            </button>
                        )}

                    </div>

                    <div className="h-5 w-px bg-white/10" />

                    {/* Transparency Slider */}
                    <div className="flex items-center gap-3 group">
                        <svg className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.172-1.172a4 4 0 015.656 0l1.172 1.172a4 4 0 010 5.656l-1.172 1.172a4 4 0 01-5.656 0L11 11.657" />
                        </svg>
                        <input
                            type="range"
                            min="0.25"
                            max="1.0"
                            step="0.05"
                            value={opacity}
                            onChange={handleOpacityChange}
                            className="w-20 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-sky-500"
                        />
                    </div>

                    <div className="h-5 w-px bg-white/10" />

                    {/* Settings Button */}
                    <button className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/[0.03] border border-white/5 text-white/30 hover:text-white/60 hover:bg-white/[0.08] transition-all">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </button>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                input[type=range]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 14px;
                    height: 14px;
                    background: #fff;
                    border-radius: 50%;
                    cursor: pointer;
                    box-shadow: 0 0 12px rgba(56, 189, 248, 0.6);
                    border: 2px solid #0ea5e9;
                }
                .-webkit-app-region-drag {
                    -webkit-app-region: drag;
                }
                .-webkit-app-region-no-drag {
                    -webkit-app-region: no-drag;
                }
            `}} />
        </div>
    )
}
