import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react"
import type { AIResult, IntentType, STTMode } from "../types/window-api"

type OverlayStatus = "listening" | "transcribing" | "understanding" | "suggesting" | "answering"

const INTENT_TO_STATUS: Record<Exclude<IntentType, "none">, OverlayStatus> = {
    question:    "understanding",
    explanation: "understanding",
    problem:     "understanding",
    decision:    "suggesting",
    context:     "suggesting",
}

const STATUS_CFG = {
    listening:     { dot: "bg-white/20",                 label: "Listening",    color: "text-white/35" },
    transcribing:  { dot: "bg-sky-400 animate-pulse",    label: "Transcribing", color: "text-sky-400" },
    understanding: { dot: "bg-yellow-400 animate-pulse", label: "Thinking",     color: "text-yellow-400" },
    suggesting:    { dot: "bg-violet-400 animate-pulse", label: "Suggesting",   color: "text-violet-400" },
    answering:     { dot: "bg-emerald-400",              label: "Answering",    color: "text-emerald-400" },
} as const

// ── Styles injected once ──────────────────────────────────────
const styleEl = document.createElement("style")
styleEl.textContent = `
  @keyframes pulse-dot {
    0%,80%,100% { opacity:.2; transform:scale(.7); }
    40%         { opacity:1;  transform:scale(1);  }
  }
  /* Container slides down from top */
  @keyframes ov-enter {
    from { opacity:0; transform:translateY(-8px) scale(.98); }
    to   { opacity:1; transform:translateY(0)    scale(1);   }
  }
  /* Each new text chunk fades up */
  @keyframes chunk-in {
    from { opacity:0; transform:translateY(3px); }
    to   { opacity:1; transform:translateY(0);   }
  }
  /* Skeleton shimmer */
  @keyframes shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position:  400px 0; }
  }
  .ov-enter  { animation: ov-enter .18s cubic-bezier(.22,1,.36,1) forwards; }
  .chunk-in  { animation: chunk-in .12s ease forwards; }
  .shimmer   {
    background: linear-gradient(90deg,
      rgba(255,255,255,.04) 25%,
      rgba(255,255,255,.10) 50%,
      rgba(255,255,255,.04) 75%);
    background-size: 400px 100%;
    animation: shimmer 1.4s infinite linear;
  }
  .drag-region { -webkit-app-region: drag; }
  .no-drag     { -webkit-app-region: no-drag; }
`
document.head.appendChild(styleEl)

// ── Thinking dots ─────────────────────────────────────────────
const ThinkingDots = memo(() => (
    <span className="inline-flex items-center gap-[3px] ml-1">
        {[0, 1, 2].map(i => (
            <span key={i} className="inline-block h-[3px] w-[3px] rounded-full bg-yellow-400"
                style={{ animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite` }} />
        ))}
    </span>
))

// ── Skeleton placeholder — shown while Groq is thinking ──────
const ThinkingSkeleton = memo(() => (
    <div className="px-4 py-3 space-y-2">
        <div className="shimmer h-[13px] rounded-full w-[85%]" />
        <div className="shimmer h-[13px] rounded-full w-[70%]" />
        <div className="shimmer h-[13px] rounded-full w-[55%]" />
    </div>
))

// ── Blinking cursor shown at end of streaming text ───────────
const StreamCursor = memo(() => (
    <span className="inline-block w-[2px] h-[13px] bg-emerald-400 ml-0.5 align-middle rounded-full"
        style={{ animation: "pulse-dot .7s ease-in-out infinite" }} />
))

// ── Typewriter text — renders bullet lines with staggered fade-in ──
// Each line slides in sequentially so bullets appear one by one.
const TypewriterText = memo(({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
    const lines = useMemo(() => {
        return text
            .split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 0)
    }, [text])

    // Single line (no bullets) — animate word by word
    if (lines.length <= 1) {
        const words = text.trim().match(/\S+\s*/g) ?? []
        return (
            <p className="text-[13.5px] text-white/85 leading-[1.75] whitespace-pre-wrap">
                {words.map((word, i) => (
                    <span key={i} className="chunk-in inline"
                        style={{ animationDelay: `${Math.min(i * 8, 80)}ms` }}>
                        {word}
                    </span>
                ))}
                {isStreaming && <StreamCursor />}
            </p>
        )
    }

    // Multiple lines — animate each line in sequentially
    return (
        <div className="space-y-[6px]">
            {lines.map((line, i) => {
                const isBullet = /^[•\-\*]/.test(line)
                const content  = isBullet ? line.slice(1).trim() : line
                return (
                    <div key={i} className="chunk-in flex items-start gap-2"
                        style={{ animationDelay: `${i * 60}ms` }}>
                        {isBullet && (
                            <span className="mt-[3px] flex-shrink-0 w-[5px] h-[5px] rounded-full bg-emerald-400/70" />
                        )}
                        <span className="text-[13.5px] text-white/85 leading-[1.7]">
                            {content}
                            {/* Show cursor on the last line while streaming */}
                            {isStreaming && i === lines.length - 1 && <StreamCursor />}
                        </span>
                    </div>
                )
            })}
        </div>
    )
})

// ── Syntax highlight ──────────────────────────────────────────
function useHighlight(text: string, active: boolean) {
    return useMemo(() => {
        if (!active) return null
        return text.split("\n").map((line, i) => {
            if (/^\s*(#|\/\/)/.test(line))
                return <div key={i} className="text-slate-500 font-mono">{line}</div>
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
            if (/["'`]/.test(line))
                return <div key={i} className="font-mono text-amber-300">{line}</div>
            return <div key={i} className="font-mono text-slate-200">{line}</div>
        })
    }, [text, active])
}

// ── Main component ────────────────────────────────────────────
export default function Overlay() {
    const [result, setResult]         = useState<AIResult | null>(null)
    const [streamingText, setStreaming] = useState("")
    const [summary, setSummary]       = useState("")
    const [partial, setPartial]       = useState("")
    const [lastFinals, setLastFinals] = useState<string[]>([])
    const [status, setStatus]         = useState<OverlayStatus>("listening")
    const [visible, setVisible]       = useState(true)
    const [copied, setCopied]         = useState(false)
    const [codeMode, setCodeMode]     = useState(false)
    const [activeMode, setActiveMode] = useState<STTMode>("general")

    // Key that changes when a new answer starts — forces TypewriterText to remount
    // so word animations restart cleanly for each new answer
    const [answerKey, setAnswerKey]   = useState(0)

    const silenceTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastAnswerRef = useRef("")
    const containerRef  = useRef<HTMLDivElement>(null)

    // ── Auto-resize window ────────────────────────────────────
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        const ro = new ResizeObserver((entries) => {
            const h = entries[0]?.contentRect.height
            if (h && h > 0) window.api.resizeOverlay?.(Math.ceil(h) + 8)
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // ── Derived ───────────────────────────────────────────────
    const displayText   = result?.text ?? streamingText
    const hasAnswer     = !!displayText
    const isStreaming   = !result && !!streamingText
    const isThinking    = (status === "understanding" || status === "suggesting") && !hasAnswer
    const hasSummary    = !hasAnswer && !!summary
    const hasTranscript = lastFinals.length > 0 || !!partial

    const highlighted = useHighlight(displayText, codeMode && hasAnswer)

    // ── Handlers ─────────────────────────────────────────────
    const resetState = useCallback(() => {
        setResult(null)
        setStreaming("")
        setSummary("")
        setPartial("")
        setLastFinals([])
        setStatus("listening")
        lastAnswerRef.current = ""
    }, [])

    const changeMode = useCallback(async (mode: STTMode) => {
        setActiveMode(mode)
        await window.api.setSTTMode(mode)
    }, [])

    const copyAnswer = useCallback(async () => {
        if (!displayText) return
        await navigator.clipboard.writeText(displayText)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }, [displayText])

    // ── IPC ───────────────────────────────────────────────────
    useEffect(() => {
        const offIntent = window.api.onAIIntent((intent) => {
            setStatus(INTENT_TO_STATUS[intent] ?? "understanding")
            setResult(null)
            setStreaming("")
            // Bump key so next answer animates fresh
            setAnswerKey(k => k + 1)
        })

        const offAnswer = window.api.onAIAnswer((r) => {
            if (!r?.text || r.text === lastAnswerRef.current) return
            lastAnswerRef.current = r.text
            setResult(r)
            setStreaming("")
            setSummary("")
            setStatus("answering")
            setVisible(true)
        })

        const offChunk = window.api.onAIAnswerChunk?.((accumulated) => {
            setStreaming(accumulated)
            setStatus("answering")
            setVisible(true)
        })

        const offSummary = window.api.onAISummary?.((text) => {
            if (!text) return
            setSummary(text)
            setResult(null)
            setStreaming("")
            setAnswerKey(k => k + 1)
            setVisible(true)
        })

        const offPartial = window.api.onTranscriptPartial((text) => {
            setPartial(text)
            setStatus("transcribing")
            if (silenceTimer.current) clearTimeout(silenceTimer.current)
            silenceTimer.current = setTimeout(() => {
                setStatus(s => s === "transcribing" ? "understanding" : s)
            }, 800)
        })

        const offFinal = window.api.onTranscriptFinal((text) => {
            setLastFinals(prev => [...prev, text].slice(-2))
            setPartial("")
        })

        const offFinalCorrected = window.api.onTranscriptFinalCorrected?.((text) => {
            setLastFinals(prev => prev.length === 0 ? [text] : [...prev.slice(0, -1), text])
        })

        const offClear = window.api.onTranscriptClear(resetState)

        return () => {
            offIntent?.(); offAnswer?.(); offChunk?.(); offSummary?.()
            offPartial?.(); offFinal?.(); offFinalCorrected?.(); offClear?.()
            if (silenceTimer.current) clearTimeout(silenceTimer.current)
        }
    }, [resetState])

    const cfg = STATUS_CFG[status]
    if (!visible) return null

    return (
        <div className="fixed inset-0 flex flex-col items-center"
            style={{ zIndex: 9999, pointerEvents: "none" }}>
            <div className="mt-0 w-[560px] ov-enter" style={{ pointerEvents: "auto" }}>

                <div ref={containerRef}
                    className="rounded-2xl overflow-hidden border border-white/[0.08] bg-[#0a0a0f]/95 shadow-[0_8px_40px_rgba(0,0,0,0.6)]">

                    {/* ── HEADER ───────────────────────────────────── */}
                    <div className="drag-region flex items-center justify-between px-4 py-[10px] border-b border-white/[0.06] bg-white/[0.02]">

                        {/* Logo + status */}
                        <div className="flex items-center gap-3 no-drag select-none">
                            <div className="flex items-center gap-2">
                                <div className="relative flex items-center justify-center w-6 h-6">
                                    <div className="absolute inset-0 rounded-md bg-gradient-to-br from-sky-500 to-violet-600 opacity-90" />
                                    <svg className="relative w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 16 16">
                                        <path d="M2 5h12M2 8h8M2 11h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    </svg>
                                </div>
                                <span className="text-[12px] font-semibold text-white/70 tracking-wide">Ghostly</span>
                            </div>
                            <div className="w-px h-3.5 bg-white/[0.1]" />
                            <div className="flex items-center gap-1.5">
                                <div className={`w-[7px] h-[7px] rounded-full flex-shrink-0 transition-colors duration-200 ${cfg.dot}`} />
                                <span className={`text-[11px] font-medium tracking-wide transition-colors duration-200 ${cfg.color}`}>
                                    {cfg.label}
                                    {(status === "understanding" || status === "suggesting") && <ThinkingDots />}
                                </span>
                            </div>
                        </div>

                        {/* Mode switcher */}
                        <div className="flex items-center bg-white/[0.04] p-1 rounded-lg no-drag">
                            {(["general", "technical", "meeting"] as STTMode[]).map((m) => (
                                <button key={m} onClick={() => changeMode(m)}
                                    className={`px-2.5 py-0.5 rounded-md text-[10px] font-medium capitalize transition-colors duration-100
                                        ${activeMode === m ? "bg-white/[0.08] text-white" : "text-white/30 hover:text-white/60"}`}>
                                    {m}
                                </button>
                            ))}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 no-drag">
                            {hasAnswer && (
                                <>
                                    <button onClick={() => setCodeMode(v => !v)}
                                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors duration-100
                                            ${codeMode
                                                ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                                                : "bg-white/[0.06] text-white/40 border border-white/[0.08] hover:text-white/60"}`}>
                                        {"</>"}
                                    </button>
                                    <button onClick={copyAnswer}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-violet-600 text-white text-[11px] font-semibold hover:opacity-90 active:opacity-75 transition-opacity duration-100">
                                        {copied ? "✓ Copied" : "Copy"}
                                    </button>
                                </>
                            )}
                            <button onClick={() => setVisible(false)}
                                className="w-6 h-6 flex items-center justify-center rounded-md text-white/25 hover:text-white/60 hover:bg-white/[0.06] transition-colors duration-100">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14">
                                    <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    {/* ── THINKING SKELETON — appears immediately on intent ── */}
                    {isThinking && <ThinkingSkeleton />}

                    {/* ── ANSWER ───────────────────────────────────── */}
                    {hasAnswer && (
                        <div key={answerKey}>
                            {codeMode ? (
                                <div className="m-3 p-4 rounded-xl bg-[#070710]/80 border border-white/[0.06] text-[13px] leading-6">
                                    <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-white/[0.05]">
                                        {["bg-red-500/60", "bg-yellow-500/60", "bg-green-500/60"].map((c, i) => (
                                            <div key={i} className={`w-2.5 h-2.5 rounded-full ${c}`} />
                                        ))}
                                    </div>
                                    <div className="space-y-0.5">{highlighted}</div>
                                </div>
                            ) : (
                                <div className="px-4 py-3">
                                    <TypewriterText
                                        key={answerKey}
                                        text={displayText}
                                        isStreaming={isStreaming}
                                    />
                                </div>
                            )}
                            {result?.intent && (
                                <div className="flex items-center gap-2 px-4 pb-3">
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/[0.05] text-white/30 border border-white/[0.06] capitalize">
                                        {result.intent}
                                    </span>
                                    {result.confidence != null && (
                                        <span className="text-[10px] text-white/25">
                                            {Math.round(result.confidence * 100)}%
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── SUMMARY ──────────────────────────────────── */}
                    {hasSummary && (
                        <div className="px-4 py-3" key={`summary-${answerKey}`}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <svg className="w-3 h-3 text-amber-400/70" fill="none" viewBox="0 0 12 12">
                                    <path d="M2 3h8M2 6h6M2 9h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                </svg>
                                <span className="text-[10px] font-medium text-amber-400/70 uppercase tracking-wider">Summary</span>
                            </div>
                            <TypewriterText text={summary} isStreaming={false} />
                        </div>
                    )}

                    {/* ── TRANSCRIPT STRIP ─────────────────────────── */}
                    {hasTranscript && (
                        <div className="px-4 py-2 border-t border-white/[0.05] bg-white/[0.01]">
                            <p className="text-[11px] text-white/25 leading-relaxed line-clamp-2">
                                {lastFinals.join(" ")}
                                {partial && <span className="text-white/20 italic"> {partial}…</span>}
                            </p>
                        </div>
                    )}

                    {/* ── IDLE ─────────────────────────────────────── */}
                    {!hasAnswer && !isThinking && !hasSummary && !hasTranscript && (
                        <div className="flex items-center justify-center py-5">
                            <p className="text-[11px] text-white/15 tracking-widest uppercase font-medium">
                                Waiting for audio…
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
