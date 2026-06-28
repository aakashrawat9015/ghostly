// src/main/services/audio/index.ts
// Barrel export for the audio engine module

export { NativeAudioBackend } from "./NativeAudioBackend"
export type { IAudioBackend } from "./IAudioBackend"
export type {
  AudioDevice,
  AudioStreamConfig,
  AudioChunkCallback,
  StreamState,
} from "./types"
