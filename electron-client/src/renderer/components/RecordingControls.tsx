// import { useState } from "react"

// type RecordingStatus = "idle" | "recording"

// const DEBUG = import.meta.env.VITE_DEBUG === "true"

// export default function RecordingControls() {
//     const [status, setStatus] = useState<RecordingStatus>("idle")
//     const [loading, setLoading] = useState(false)

//     const log = (...args: any[]) => {
//         if (DEBUG) console.log("[RecordingControls]", ...args)
//     }

//     const handleStart = async () => {
//         if (status === "recording") return
//         setLoading(true)
//         try {
//             await window.api?.startRecording?.()
//             setStatus("recording")
//             log("Recording started")
//         } catch (err) {
//             console.error("Start failed:", err)
//         } finally {
//             setLoading(false)
//         }
//     }

//     const handleStop = async () => {
//         if (status === "idle") return
//         setLoading(true)
//         try {
//             await window.api?.stopRecording?.()
//             setStatus("idle")
//             log("Recording stopped")
//         } catch (err) {
//             console.error("Stop failed:", err)
//         } finally {
//             setLoading(false)
//         }
//     }

//     return (
//         /* 🔹 Container: Soft Sky Blue Background */
//         <div className="flex flex-col items-center gap-4 p-6 font-sans bg-sky-300 border border-sky-100 rounded-2xl shadow-sm">
//             <div className="flex items-center gap-2">
//                 <span
//                     className={`h-2.5 w-2.5 rounded-full ${status === "recording" ? "bg-green-500 animate-pulse" : "bg-sky-300"
//                         }`}
//                 />
//                 {/* 🔹 Text: Slate/Blue hybrid for a modern light look */}
//                 <span className="text-sm font-semibold text-sky-900">
//                     {status === "recording" ? "LIVE TRANSCRIPTION" : "SYSTEM READY"}
//                 </span>
//             </div>

//             <div className="flex gap-3">
//                 <button
//                     onClick={handleStart}
//                     disabled={status === "recording" || loading}
//                     className="rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40 hover:bg-sky-700 active:scale-95 transition-all shadow-md shadow-sky-200"
//                 >
//                     Start
//                 </button>

//                 <button
//                     onClick={handleStop}
//                     disabled={status === "idle" || loading}
//                     className="rounded-xl bg-white border border-red-200 px-5 py-2 text-sm font-bold text-red-600 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-red-50 active:scale-95 transition-all"
//                 >
//                     Stop
//                 </button>
//             </div>
//         </div>
//     )
// }