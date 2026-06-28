// src/main/services/audio/types.ts

/**
 * Audio device exposed to consumers of the backend.
 * IDs are WASAPI endpoint GUID strings on Windows (e.g. "{0.0.0.00000000}.{uuid}").
 * Pass id directly to startSystemAudioCapture; use "default" to let the OS choose.
 */
export interface AudioDevice {
  id: string
  name: string
  type: "input" | "output" | "loopback"
  channels: number
  defaultSampleRate: number
  hostAPI: string
  isDefault: boolean
}

/**
 * Configuration for opening an audio capture stream.
 */
export interface AudioStreamConfig {
  /** WASAPI endpoint GUID, or "default" */
  deviceId: string
  /** Sample rate in Hz (16000 recommended for STT) */
  sampleRate: number
  /** Channel count (1 = mono) */
  channels: number
}

/**
 * Callback invoked for every PCM chunk from the engine.
 * Chunk format: 16-bit signed int LE, mono, at the negotiated sample rate.
 */
export type AudioChunkCallback = (chunk: Buffer) => void

/** Possible states of a managed audio stream. */
export type StreamState = "idle" | "starting" | "active" | "stopping" | "error"
