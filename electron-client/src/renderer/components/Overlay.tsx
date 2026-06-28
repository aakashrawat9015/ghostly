import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react"
import type { AIResult, IntentType } from "../types/window-api"

type OverlayStatus = "listening" | "transcribing" | "understanding" | "suggesting" | "answering"

const INTENT_TO_STATUS: Record<Exclude<IntentType, "none">, OverlayStatus> = {
    question: "understanding",
    explanation: "understanding",
    problem: "understanding",
    decision: "suggesting",
    context: "suggesting",
}

const STATUS_CFG = {
    listening: { dot: "bg-white/20", label: "Listening", color: "text-white/35" },
    transcribing: { dot: "bg-sky-400 animate-pulse", label: "Transcribing", color: "text-sky-400" },
    understanding: { dot: "bg-yellow-400 animate-pulse", label: "Thinking", color: "text-yellow-400" },
    suggesting: { dot: "bg-violet-400 animate-pulse", label: "Suggesting", color: "text-violet-400" },
    answering: { dot: "bg-emerald-400", label: "Answering", color: "text-emerald-400" },
} as const

// ── Styles handled via a single-instance check ────────────────────────
const styles = `
  @keyframes pulse-dot {
    0%,80%,100% { opacity:.2; transform:scale(.7); }
    40%         { opacity:1;  transform:scale(1);  }
  }
  @keyframes ov-enter {
    from { opacity:0; transform:translateY(-8px) scale(.98); }
    to   { opacity:1; transform:translateY(0)    scale(1);   }
  }
  @keyframes chunk-in {
    from { opacity:0; transform:translateY(3px); }
    to   { opacity:1; transform:translateY(0);   }
  }
  @keyframes shimmer {
    0%   { background-position: -400px 0; }
    100% { background-position:  400px 0; }
  }
  .ov-enter  { animation: ov-enter .18s cubic-bezier(.22,1,.36,1) forwards; }
  .chunk-in  { animation: chunk-in .12s ease forwards; }
  .shimmer   {
    background: linear-gradient(90deg, rgba(255,255,255,.04) 25%, rgba(255,255,255,.10) 50%, rgba(255,255,255,.04) 75%);
    background-size: 400px 100%;
    animation: shimmer 1.4s infinite linear;
  }
`;

// ── Sub-components ──────────────────────────────────────────────────
const ThinkingDots = memo(() => (
    <span className="inline-flex items-center gap-[3px] ml-1">
        {[0, 1, 2].map(i => (
            <span key={i} className="inline-block h-[3px] w-[3px] rounded-full bg-yellow-400"
                style={{ animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite` }} />
        ))}
    </span>
))

const ThinkingSkeleton = memo(() => (
    <div className="px-4 py-3 space-y-2">
        <div className="shimmer h-[13px] rounded-full w-[85%]" />
        <div className="shimmer h-[13px] rounded-full w-[70%]" />
        <div className="shimmer h-[13px] rounded-full w-[55%]" />
    </div>
))

const StreamCursor = memo(() => (
    <span className="inline-block w-[2px] h-[13px] bg-emerald-400 ml-0.5 align-middle rounded-full"
        style={{ animation: "pulse-dot .7s ease-in-out infinite" }} />
))

const TypewriterText = memo(({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
    const lines = useMemo(() => text.split("\n").map(l => l.trim()).filter(l => l.length > 0), [text])

    if (lines.length <= 1) {
        const words = text.trim().match(/\S+\s*/g) ?? []
        return (
            <p className="text-[13.5px] text-white/85 leading-[1.75] whitespace-pre-wrap">
                {words.map((word, i) => (
                    <span key={i} className="chunk-in inline" style={{ animationDelay: `${Math.min(i * 8, 80)}ms` }}>
                        {word}
                    </span>
                ))}
                {isStreaming && <StreamCursor />}
            </p>
        )
    }

    return (
        <div className="space-y-[6px]">
            {lines.map((line, i) => {
                const isBullet = /^[•\-\*]/.test(line)
                const content = isBullet ? line.slice(1).trim() : line
                return (
                    <div key={i} className="chunk-in flex items-start gap-2" style={{ animationDelay: `${i * 60}ms` }}>
                        {isBullet && <span className="mt-[3px] flex-shrink-0 w-[5px] h-[5px] rounded-full bg-emerald-400/70" />}
                        <span className="text-[13.5px] text-white/85 leading-[1.7]">
                            {content}
                            {isStreaming && i === lines.length - 1 && <StreamCursor />}
                        </span>
                    </div>
                )
            })}
        </div>
    )
})

export default function Overlay() {
    const [result, setResult] = useState<AIResult | null>(null)
    const [streamingText, setStreaming] = useState("")
    const [summary, setSummary] = useState("")
    const [partial, setPartial] = useState("")
    const [lastFinals, setLastFinals] = useState<string[]>([])
    const [status, setStatus] = useState<OverlayStatus>("listening")
    const [visible, setVisible] = useState(true)
    const [answerKey, setAnswerKey] = useState(0)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)

    const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastAnswerRef = useRef("")
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // Prevent multiple style injections
        if (!document.getElementById("overlay-styles")) {
            const styleEl = document.createElement("style")
            styleEl.id = "overlay-styles"
            styleEl.textContent = styles
            document.head.appendChild(styleEl)
        }

        const el = containerRef.current
        if (!el) return
        const ro = new ResizeObserver((entries) => {
            const h = entries[0]?.contentRect.height
            if (h && h > 0) window.api.resizeOverlay?.(Math.ceil(h) + 8)
        })
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    const displayText = result?.text ?? streamingText
    const hasAnswer = !!displayText
    const isStreaming = !result && !!streamingText
    const isThinking = (status === "understanding" || status === "suggesting") && !hasAnswer
    const hasSummary = !hasAnswer && !!summary
    const hasTranscript = lastFinals.length > 0 || !!partial

    const resetState = useCallback(() => {
        setResult(null)
        setStreaming("")
        setSummary("")
        setPartial("")
        setLastFinals([])
        setStatus("listening")
        lastAnswerRef.current = ""
    }, [])

    useEffect(() => {
        const offIntent = window.api.onAIIntent((intent) => {
            setStatus(INTENT_TO_STATUS[intent] ?? "understanding")
            setResult(null)
            setStreaming("")
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

        const offError = window.api.onAIError?.((msg) => {
            setErrorMsg(msg)
            setTimeout(() => setErrorMsg(null), 8000)
        })

        return () => {
            offIntent?.(); offAnswer?.(); offChunk?.(); offSummary?.()
            offPartial?.(); offFinal?.(); offFinalCorrected?.(); offClear?.(); offError?.()
            if (silenceTimer.current) clearTimeout(silenceTimer.current)
        }
    }, [resetState])

    const cfg = STATUS_CFG[status]
    if (!visible) return null

    return (
        <div className="flex flex-col items-center h-screen bg-transparent" style={{ pointerEvents: "none" }}>
            <div className="w-[620px] ov-enter" style={{ pointerEvents: "auto" }}>
                <div ref={containerRef}
                    className="backdrop-blur-[14px] bg-[#0a0a0f]/75 border border-white/[0.08] rounded-[24px] shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden">

                    <div className="flex items-center gap-2 px-5 py-2.5 bg-white/[0.02] border-b border-white/[0.04]">
                        <div className={`w-[6px] h-[6px] rounded-full ${cfg.dot}`} />
                        <span className={`text-[10px] font-bold tracking-widest uppercase ${cfg.color}`}>
                            {cfg.label}
                            {(status === "understanding" || status === "suggesting") && <ThinkingDots />}
                        </span>
                    </div>

                    {isThinking && <ThinkingSkeleton />}

                    {hasAnswer && (
                        <div key={answerKey} className="px-5 py-4">
                            <TypewriterText text={displayText} isStreaming={isStreaming} />
                            {result?.intent && (
                                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/[0.03]">
                                    <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-white/[0.05] text-white/30 border border-white/[0.06] uppercase tracking-tighter">
                                        {result.intent}
                                    </span>
                                    {result.confidence != null && (
                                        <span className="text-[9px] font-medium text-white/20">
                                            {(result.confidence * 100).toFixed(0)}% confidence
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {hasSummary && (
                        <div className="px-5 py-4" key={`summary-${answerKey}`}>
                            <div className="flex items-center gap-2 mb-2">
                                <svg className="w-3.5 h-3.5 text-amber-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h7" />
                                </svg>
                                <span className="text-[10px] font-black text-amber-400/60 uppercase tracking-widest">Summary</span>
                            </div>
                            <TypewriterText text={summary} isStreaming={false} />
                        </div>
                    )}

                    {hasTranscript && (
                        <div className="px-5 py-3 border-t border-white/[0.05] bg-white/[0.01]">
                            <p className="text-[11px] text-white/30 leading-relaxed font-medium italic">
                                {lastFinals.join(" ")}
                                {partial && <span className="text-white/20"> {partial}…</span>}
                            </p>
                        </div>
                    )}

                    {errorMsg && (
                        <div className="px-5 py-3 flex items-start gap-2">
                            <span className="mt-[2px] text-red-400 shrink-0">⚠</span>
                            <p className="text-[11px] text-red-400/90 leading-relaxed">{errorMsg}</p>
                        </div>
                    )}

                    {!hasAnswer && !isThinking && !hasSummary && !hasTranscript && !errorMsg && (
                        <div className="flex items-center justify-center py-6 opacity-20">
                            <div className="flex items-center gap-3">
                                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                <p className="text-[10px] text-white tracking-[0.2em] uppercase font-black">
                                    Ghostly Listening
                                </p>
                                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
