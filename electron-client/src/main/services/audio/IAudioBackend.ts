// src/main/services/audio/IAudioBackend.ts
//
// Shared interface for audio capture backends.
// NativeAudioBackend (NAPI-RS/WASAPI) implements this contract.

import type { AudioDevice, AudioChunkCallback, AudioStreamConfig } from "./types"

export interface IAudioBackend {
    /** List all available audio devices. Results may be cached. */
    listDevices(): AudioDevice[]

    /** Invalidate the device cache. Call after device hot-swap. */
    refreshDevices(): void

    /**
     * Start capturing system audio (speaker loopback).
     * Audio arrives as 16-bit PCM int LE, mono, at the negotiated sample rate.
     */
    startSystemAudioCapture(
        onChunk: AudioChunkCallback,
        config?: Partial<AudioStreamConfig>
    ): void

    /**
     * Start capturing microphone input.
     * May not be supported on all platforms (e.g. NAPI-RS backend may throw).
     */
    startMicCapture?(
        onChunk: AudioChunkCallback,
        config?: Partial<AudioStreamConfig>
    ): void

    /** Stop all active capture streams. */
    stopAll(): void

    /** Whether any capture stream is currently active. */
    readonly isCapturing: boolean
}
