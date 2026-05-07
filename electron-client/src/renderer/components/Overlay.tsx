import { useEffect, useState, useRef, useCallback } from "react"
import type { AIResult, IntentType, STTMode } from "../types/window-api"

// ── Types ─────────────────────────────────────────────────────
type OverlayStatus =
    | "listening"
    | "transcribing"
    | "understanding"
    | "suggesting"
    | "answering"

const INTENT_TO_STATUS: Record<Exclude<IntentType, "none">, OverlayStatus> = {
    question: "understanding",
    explanation: "understanding",
    problem: "understanding",
    decision: "suggesting",
    context: "suggesting",
}

// ── Simple syntax highlighter ─────────────────────────────────
function highlight(text: string): React.ReactNode[] {
    const lines = text.split("\n")
    return lines.map((line, i) => {
        // Code comment
        if (/^\s*(#|\/\/)/.test(line)) {
            return <div key={i} className="text-slate-500 font-mono">{line}</div>
        }
        // Keyword line
        if (/\b(def |class |return |import |from |if |else|for |while |const |let |var |function )\b/.test(line)) {
            const parts = line.split(/(\b(?:def|class|return|import|from|if|else|for|while|const|let|var|function)\b)/)
            return (
                <div key={i} className="font-mono">
                    {parts.map((p, j) =>
                        /^(def|class|return|import|from|if|else|for|while|const|let|var|function)$/.test(p)
                            ? <span key={j} className="text-violet-400">{p}</span>
                            : <span key={j} className="text-slate-200">{p}</span>
                    )}
                </div>
            )
        }
        // String values
        if (/["'`]/.test(line)) {
            return (
                <div key={i} className="font-mono text-amber-300">{line}</div>
            )
        }
        // Default
        return <div key={i} className="font-mono text-slate-200">{line}</div>
    })
}

// ── Thinking dots animation ───────────────────────────────────
function ThinkingDots() {
    return (
        <span className="inline-flex items-center gap-[3px] ml-1">
            {[0, 1, 2].map(i => (
                <span
                    key={i}
                    className="inline-block h-[3px] w-[3px] rounded-full bg-yellow-400"
                    style={{
                        animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                />
            ))}
        </span>
    )
}

// ── Main component ────────────────────────────────────────────
export default function Overlay() {
    const [result, setResult] = useState<AIResult | null>(null)
    const [partial, setPartial] = useState("")
    const [finalTranscripts, setFinalTranscripts] = useState<string[]>([])
    const [status, setStatus] = useState<OverlayStatus>("listening")
    const [isDragging, setIsDragging] = useState(false)
    const [visible, setVisible] = useState(true)
    const [copied, setCopied] = useState(false)
    const [codeMode, setCodeMode] = useState(false)
    const [activeMode, setActiveMode] = useState<STTMode>("general")

    const dragOffset = useRef({ x: 0, y: 0 })
    const silenceTimer = useRef<NodeJS.Timeout | null>(null)
    const lastAnswerRef = useRef("")

    const changeMode = async (mode: STTMode) => {
        if (mode === activeMode) return
        setActiveMode(mode)
        await window.api.setSTTMode(mode)
    }

    // ── State handlers ────────────────────────────────────────
    const resetState = useCallback(() => {
        setResult(null)
        setPartial("")
        setFinalTranscripts([])
        setStatus("listening")
        lastAnswerRef.current = ""
    }, [])

    useEffect(() => {
        if (!result) return
        setPartial("")
        setStatus("answering")
    }, [result])

    useEffect(() => {
        if (!partial) return
        setStatus("transcribing")
        if (silenceTimer.current) clearTimeout(silenceTimer.current)
        silenceTimer.current = setTimeout(() => {
            setStatus(s => s === "transcribing" ? "understanding" : s)
        }, 1200)
    }, [partial])

    // ── IPC ───────────────────────────────────────────────────
    useEffect(() => {
        const offIntent = window.api.onAIIntent((intent) => {
            setStatus(INTENT_TO_STATUS[intent] ?? "understanding")
            setResult(null)
        })
        const offAnswer = window.api.onAIAnswer((r) => {
            if (!r?.text) return
            if (r.text === lastAnswerRef.current) return
            lastAnswerRef.current = r.text
            setResult(r)
            setVisible(true)
        })
        const offPartial = window.api.onTranscriptPartial(setPartial)
        const offFinal = window.api.onTranscriptFinal((text) => {
            setFinalTranscripts(prev => [...prev, text].slice(-2))
            setPartial("")
        })
        const offClear = window.api.onTranscriptClear(resetState)

        return () => {
            offIntent?.(); offAnswer?.(); offPartial?.(); offFinal?.(); offClear?.()
        }
    }, [resetState])

    // ── Drag ──────────────────────────────────────────────────
    // Using webkit-app-region for native Electron drag
    // Only the header strip is draggable

    const copyAnswer = async () => {
        if (!result) return
        await navigator.clipboard.writeText(result.text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
    }

    // ── Status config ─────────────────────────────────────────
    const STATUS_CFG = {
        listening: { dot: "bg-white/20", label: "Listening", color: "text-white/35" },
        transcribing: { dot: "bg-sky-400 animate-pulse", label: "Transcribing", color: "text-sky-400" },
        understanding: { dot: "bg-yellow-400 animate-pulse", label: "Thinking", color: "text-yellow-400" },
        suggesting: { dot: "bg-violet-400 animate-pulse", label: "Suggesting", color: "text-violet-400" },
        answering: { dot: "bg-emerald-400", label: "AI Response", color: "text-emerald-400" },
    } as const

    const cfg = STATUS_CFG[status]

    if (!visible) return null

    const hasAnswer = !!result
    const hasTranscript = finalTranscripts.length > 0 || !!partial

    return (
        <>
            {/* ── Keyframe animations injected via style tag ── */}
            <style>{`
        @keyframes pulse-dot {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.7); }
          40% { opacity: 1; transform: scale(1); }
        }
        @keyframes slide-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .slide-in { animation: slide-in 0.18s ease forwards; }
        .fade-in  { animation: fade-in 0.22s ease forwards; }
        .drag-region { -webkit-app-region: drag; }
        .no-drag     { -webkit-app-region: no-drag; }
      `}</style>

            <div
                className="fixed inset-0 flex flex-col items-center"
                style={{ zIndex: 9999, pointerEvents: "none" }}
            >
                <div
                    className="mt-0 w-[560px] slide-in"
                    style={{ pointerEvents: "auto" }}
                >
                    {/* ══ MAIN CONTAINER ════════════════════════════════ */}
                    <div className="
            rounded-2xl overflow-hidden
            border border-white/[0.08]
            bg-[#0a0a0f]/90
            backdrop-blur-2xl
            shadow-[0_8px_60px_rgba(0,0,0,0.7)]
          ">

                        {/* ── HEADER BAR ─────────────────────────────────── */}
                        <div
                            className="
                drag-region
                flex items-center justify-between
                px-4 py-[10px]
                border-b border-white/[0.06]
                bg-white/[0.025]
              "
                        >
                            {/* Left — logo + status */}
                            <div className="flex items-center gap-3 no-drag select-none">
                                {/* Logo mark */}
                                <div className="flex items-center gap-2">
                                    <div className="relative flex items-center justify-center w-6 h-6">
                                        <div className="absolute inset-0 rounded-md bg-gradient-to-br from-sky-500 to-violet-600 opacity-90" />
                                        <svg className="relative w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 16 16">
                                            <path d="M2 5h12M2 8h8M2 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                        </svg>
                                    </div>
                                    <span className="text-[12px] font-semibold text-white/70 tracking-wide">
                                        Ghostly
                                    </span>
                                </div>

                                {/* Separator */}
                                <div className="w-px h-3.5 bg-white/[0.1]" />

                                {/* Status */}
                                <div className="flex items-center gap-1.5">
                                    <div className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${cfg.dot}`} />
                                    <span className={`text-[11px] font-medium tracking-wide ${cfg.color}`}>
                                        {cfg.label}
                                        {(status === "understanding" || status === "suggesting") && <ThinkingDots />}
                                    </span>
                                </div>
                            </div>

                            {/* Center — Mode Switcher */}
                            <div className="flex items-center bg-white/[0.04] p-1 rounded-lg no-drag">
                                {(["general", "technical", "meeting"] as STTMode[]).map((m) => (
                                    <button
                                        key={m}
                                        onClick={() => changeMode(m)}
                                        className={`
                                            px-2.5 py-0.5 rounded-md text-[10px] font-medium capitalize
                                            transition-all duration-150
                                            ${activeMode === m
                                                ? "bg-white/[0.08] text-white shadow-sm"
                                                : "text-white/30 hover:text-white/60 hover:bg-white/[0.02]"
                                            }
                                        `}
                                    >
                                        {m}
                                    </button>
                                ))}
                            </div>

                            {/* Right — actions */}
                            <div className="flex items-center gap-2 no-drag">
                                {hasAnswer && (
                                    <>
                                        {/* Code mode toggle */}
                                        <button
                                            onClick={() => setCodeMode(v => !v)}
                                            className={`
                        px-2.5 py-1 rounded-md text-[11px] font-medium
                        transition-all duration-150
                        ${codeMode
                                                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                                                    : "bg-white/[0.06] text-white/40 border border-white/[0.08] hover:bg-white/[0.1] hover:text-white/60"
                                                }
                      `}
                                        >
                                            {"</>"}
                                        </button>

                                        {/* Primary CTA */}
                                        <button
                                            onClick={copyAnswer}
                                            className="
                        flex items-center gap-1.5
                        px-3 py-1.5 rounded-lg
                        bg-gradient-to-r from-sky-500 to-violet-600
                        text-white text-[11px] font-semibold
                        hover:opacity-90 active:opacity-75
                        transition-opacity duration-100
                        shadow-[0_0_16px_rgba(99,102,241,0.3)]
                      "
                                        >
                                            {copied ? (
                                                <>
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
                                                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                    Copied!
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12">
                                                        <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
                                                        <path d="M2 8V2h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                                    </svg>
                                                    Copy answer
                                                </>
                                            )}
                                        </button>
                                    </>
                                )}

                                {/* Close */}
                                <button
                                    onClick={() => setVisible(false)}
                                    className="
                    w-6 h-6 flex items-center justify-center rounded-md
                    text-white/25 hover:text-white/60 hover:bg-white/[0.06]
                    transition-all duration-100
                  "
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14">
                                        <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* ── ANSWER CONTENT ──────────────────────────────── */}
                        {hasAnswer && (
                            <div className="fade-in max-h-[440px] overflow-y-auto">
                                {codeMode ? (
                                    /* Code block view */
                                    <div className="
                    m-3 p-4 rounded-xl
                    bg-[#070710]/80
                    border border-white/[0.06]
                    text-[13px] leading-6
                  ">
                                        <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-white/[0.05]">
                                            {["bg-red-500/60", "bg-yellow-500/60", "bg-green-500/60"].map((c, i) => (
                                                <div key={i} className={`w-2.5 h-2.5 rounded-full ${c}`} />
                                            ))}
                                            <span className="ml-2 text-[10px] text-slate-500 font-mono">response.py</span>
                                        </div>
                                        <div className="space-y-0.5">
                                            {highlight(result!.text)}
                                        </div>
                                    </div>
                                ) : (
                                    /* Prose view */
                                    <div className="px-4 py-3">
                                        <p className="text-[13.5px] text-white/85 leading-[1.75] whitespace-pre-wrap">
                                            {result!.text}
                                        </p>
                                    </div>
                                )}

                                {/* Confidence + intent metadata */}
                                {result!.intent && (
                                    <div className="flex items-center gap-2 px-4 pb-3 pt-0">
                                        <span className="
                      px-2 py-0.5 rounded-md text-[10px] font-medium
                      bg-white/[0.05] text-white/30 border border-white/[0.06]
                      capitalize
                    ">
                                            {result!.intent}
                                        </span>
                                        {result!.confidence != null && (
                                            <div className="flex items-center gap-1.5">
                                                <div className="h-px flex-1 w-16 bg-white/[0.06] rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-sky-500 to-violet-500 rounded-full transition-all duration-500"
                                                        style={{ width: `${Math.round(result!.confidence * 100)}%` }}
                                                    />
                                                </div>
                                                <span className="text-[10px] text-white/25">
                                                    {Math.round(result!.confidence * 100)}%
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── TRANSCRIPT STRIP ────────────────────────────── */}
                        {hasTranscript && (
                            <div className="
                px-4 py-2.5
                border-t border-white/[0.05]
                bg-white/[0.015]
              ">
                                <p className="text-[11px] text-white/25 leading-relaxed line-clamp-2">
                                    {finalTranscripts.join(" ")}
                                    {partial && (
                                        <span className="text-white/20 italic"> {partial}…</span>
                                    )}
                                </p>
                            </div>
                        )}

                        {/* ── IDLE STATE (no content yet) ──────────────────── */}
                        {!hasAnswer && !hasTranscript && (
                            <div className="flex items-center justify-center py-5">
                                <p className="text-[11px] text-white/15 tracking-widest uppercase font-medium">
                                    Waiting for audio…
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}