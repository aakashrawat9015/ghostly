// src/main/services/audio/NativeAudioBackend.ts
//
// NAPI-RS WASAPI loopback audio backend implementing IAudioBackend.

import path from "path"
import type { AudioDevice, AudioChunkCallback, AudioStreamConfig } from "./types"
import type { IAudioBackend } from "./IAudioBackend"

// ── NAPI-RS addon types ────────────────────────────

interface NativeAudioDevice {
    id: string
    name: string
    deviceType: string // "input" | "output" | "loopback"
    channels: number
    defaultSampleRate: number
    hostApi: string
    isDefault: boolean
}

interface GhostlyAudioNative {
    listDevices(): NativeAudioDevice[]
    startLoopback(
        deviceId: string,
        sampleRate: number,
        channels: number,
        callback: (chunk: number[]) => void
    ): bigint
    stopLoopback(handle: bigint): void
    startMicCapture(
        deviceId: string,
        sampleRate: number,
        channels: number,
        callback: (chunk: number[]) => void
    ): bigint
    stopMicCapture(handle: bigint): void
    getVersion(): string
}

// ── Defaults ───────────────────────────────────────

const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_CHANNELS = 1

// ── NativeAudioBackend ─────────────────────────────

export class NativeAudioBackend implements IAudioBackend {
    private native: GhostlyAudioNative | null = null
    private _initialised = false
    private _deviceCache: AudioDevice[] | null = null
    private _activeHandle: bigint | null = null
    private _micHandle: bigint | null = null

    constructor(private readonly nativePath?: string) {}

    // ── Init ────────────────────────────────────────

    private ensureInitialised(): void {
        if (this._initialised) return

        try {
            const addonPath = this.nativePath ?? this.resolveNativePath()
            this.native = require(addonPath) as GhostlyAudioNative
            this._initialised = true
            console.log(
                `[NativeAudioBackend] Loaded ghostly-audio v${this.native.getVersion()}`
            )
        } catch (err: any) {
            throw new Error(
                `Failed to load ghostly-audio native addon: ${err.message}. ` +
                    `Build it with: cd native && npm run build`
            )
        }
    }

    private resolveNativePath(): string {
        const platform = process.platform
        const arch = process.arch === "x64" ? "x64" : process.arch
        let suffix = ""
        switch (platform) {
            case "win32":
                suffix = "-msvc"
                break
            case "linux":
                suffix = "-gnu"
                break
        }
        const triple = `${platform}-${arch}${suffix}`
        // From dist/main/services/audio/ → up 4 dirs to project root → native/
        return path.resolve(
            __dirname,
            `../../../../native/ghostly-audio.${triple}.node`
        )
    }

    // ── IAudioBackend: device enumeration ───────────

    listDevices(): AudioDevice[] {
        this.ensureInitialised()
        if (this._deviceCache) return this._deviceCache

        const raw = this.native!.listDevices()
        this._deviceCache = raw.map(toAudioDevice)
        return this._deviceCache
    }

    refreshDevices(): void {
        this._deviceCache = null
    }

    // ── IAudioBackend: system audio capture ─────────

    startSystemAudioCapture(
        onChunk: AudioChunkCallback,
        config?: Partial<AudioStreamConfig>
    ): void {
        this.ensureInitialised()

        if (this._activeHandle !== null) {
            console.warn(
                "[NativeAudioBackend] Already capturing — stopping previous"
            )
            this.stopAll()
        }

        // Device IDs are WASAPI GUIDs — pass through as-is, "default" for OS default
        const deviceId = config?.deviceId ?? "default"
        const sampleRate = config?.sampleRate ?? DEFAULT_SAMPLE_RATE
        const channels = config?.channels ?? DEFAULT_CHANNELS

        console.log(
            `[NativeAudioBackend] Starting loopback: device="${deviceId}", ` +
                `${sampleRate}Hz, ${channels}ch`
        )

        // start_loopback now blocks in Rust until WASAPI init succeeds or throws
        this._activeHandle = this.native!.startLoopback(
            deviceId,
            sampleRate,
            channels,
            (chunk: number[]) => {
                try {
                    onChunk(Buffer.from(chunk))
                } catch (e) {
                    console.error("[NativeAudioBackend] Chunk callback error:", e)
                }
            }
        )

        console.log(
            `[NativeAudioBackend] Capture active (handle=${this._activeHandle})`
        )
    }

    // ── IAudioBackend: mic capture ──────────────────

    startMicCapture(
        onChunk: AudioChunkCallback,
        config?: Partial<AudioStreamConfig>
    ): void {
        this.ensureInitialised()

        if (this._micHandle !== null) {
            this.native!.stopMicCapture(this._micHandle)
            this._micHandle = null
        }

        const deviceId = config?.deviceId ?? "default"
        const sampleRate = config?.sampleRate ?? DEFAULT_SAMPLE_RATE
        const channels = config?.channels ?? DEFAULT_CHANNELS

        console.log(
            `[NativeAudioBackend] Starting mic capture: device="${deviceId}", ` +
                `${sampleRate}Hz, ${channels}ch`
        )

        this._micHandle = this.native!.startMicCapture(
            deviceId,
            sampleRate,
            channels,
            (chunk: number[]) => {
                try {
                    onChunk(Buffer.from(chunk))
                } catch (e) {
                    console.error("[NativeAudioBackend] Mic chunk callback error:", e)
                }
            }
        )

        console.log(
            `[NativeAudioBackend] Mic capture active (handle=${this._micHandle})`
        )
    }

    // ── IAudioBackend: stop ─────────────────────────

    stopAll(): void {
        this.ensureInitialised()

        if (this._activeHandle !== null) {
            this.native!.stopLoopback(this._activeHandle)
            console.log(
                `[NativeAudioBackend] Loopback stopped (handle=${this._activeHandle})`
            )
            this._activeHandle = null
        }

        if (this._micHandle !== null) {
            this.native!.stopMicCapture(this._micHandle)
            console.log(
                `[NativeAudioBackend] Mic stopped (handle=${this._micHandle})`
            )
            this._micHandle = null
        }
    }

    // ── IAudioBackend: status ───────────────────────

    get isCapturing(): boolean {
        return this._activeHandle !== null || this._micHandle !== null
    }

    // ── Convenience ─────────────────────────────────

    get version(): string {
        this.ensureInitialised()
        return this.native!.getVersion()
    }
}

// ── Helpers ────────────────────────────────────────

function toAudioDevice(raw: NativeAudioDevice): AudioDevice {
    return {
        id: raw.id,
        name: raw.name || raw.id,
        type: raw.deviceType as AudioDevice["type"],
        channels: raw.channels,
        defaultSampleRate: raw.defaultSampleRate,
        hostAPI: raw.hostApi || "WASAPI",
        isDefault: raw.isDefault,
    }
}
