// ghostly-audio — NAPI-RS native audio capture for Ghostly
//
// Platform support:
//   Windows  → WASAPI loopback (system audio) via `wasapi` crate
//   macOS    → CoreAudio (stub — full impl in future)
//   Linux    → Stub
//
// Exports:
//   listDevices()      — enumerate all audio endpoints
//   startLoopback()    — begin WASAPI loopback capture, callback gets PCM Buffer
//   stopLoopback()     — stop capture by handle
//   startMicCapture()  — begin microphone capture, callback gets PCM Buffer
//   stopMicCapture()   — stop mic capture by handle
//   getVersion()       — module version

#[cfg(target_os = "windows")]
mod wasapi_capture;

#[cfg(target_os = "windows")]
mod windows_device;

#[cfg(target_os = "macos")]
mod macos_device;

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod stub_device;

mod device;

use napi_derive::napi;

// ──────────────────────────────────────────────
// NAPI exports
// ──────────────────────────────────────────────

/// Start system audio loopback capture.
///
/// @param deviceId  WASAPI endpoint ID (use "default" for default render device)
/// @param sampleRate  Target sample rate in Hz (e.g. 16000 for STT)
/// @param channels  Target channels (1 = mono)
/// @param callback  JS function called with each PCM chunk as Buffer (16-bit int LE)
/// @returns Handle number — pass to stopLoopback() to stop
#[cfg(target_os = "windows")]
#[napi]
pub fn start_loopback(
    device_id: String,
    sample_rate: u32,
    channels: u16,
    callback: napi::threadsafe_function::ThreadsafeFunction<
        Vec<u8>,
        napi::threadsafe_function::ErrorStrategy::Fatal,
    >,
) -> napi::Result<i64> {
    wasapi_capture::start_loopback(&device_id, sample_rate, channels, callback).map(|h| h as i64)
}

#[cfg(not(target_os = "windows"))]
#[napi]
pub fn start_loopback(
    _device_id: String,
    _sample_rate: u32,
    _channels: u16,
    _callback: napi::threadsafe_function::ThreadsafeFunction<
        Vec<u8>,
        napi::threadsafe_function::ErrorStrategy::Fatal,
    >,
) -> napi::Result<i64> {
    Err(napi::Error::from_reason(
        "Loopback capture is only supported on Windows (WASAPI).",
    ))
}

/// Stop a running loopback capture.
///
/// @param handle  The handle returned by startLoopback()
#[cfg(target_os = "windows")]
#[napi]
pub fn stop_loopback(handle: i64) -> napi::Result<()> {
    wasapi_capture::stop_loopback(handle as u64)
}

#[cfg(not(target_os = "windows"))]
#[napi]
pub fn stop_loopback(_handle: i64) -> napi::Result<()> {
    Err(napi::Error::from_reason(
        "Loopback capture is only supported on Windows.",
    ))
}

/// Start microphone (input device) capture.
///
/// @param deviceId  WASAPI endpoint ID (use "default" for default input device)
/// @param sampleRate  Target sample rate in Hz (e.g. 16000)
/// @param channels  Target channels (1 = mono)
/// @param callback  JS function called with each PCM chunk as Buffer (16-bit int LE)
/// @returns Handle number — pass to stopMicCapture() to stop
#[cfg(target_os = "windows")]
#[napi]
pub fn start_mic_capture(
    device_id: String,
    sample_rate: u32,
    channels: u16,
    callback: napi::threadsafe_function::ThreadsafeFunction<
        Vec<u8>,
        napi::threadsafe_function::ErrorStrategy::Fatal,
    >,
) -> napi::Result<i64> {
    wasapi_capture::start_mic_capture(&device_id, sample_rate, channels, callback)
        .map(|h| h as i64)
}

#[cfg(not(target_os = "windows"))]
#[napi]
pub fn start_mic_capture(
    _device_id: String,
    _sample_rate: u32,
    _channels: u16,
    _callback: napi::threadsafe_function::ThreadsafeFunction<
        Vec<u8>,
        napi::threadsafe_function::ErrorStrategy::Fatal,
    >,
) -> napi::Result<i64> {
    Err(napi::Error::from_reason(
        "Mic capture is only supported on Windows (WASAPI).",
    ))
}

/// Stop a running mic capture.
///
/// @param handle  The handle returned by startMicCapture()
#[cfg(target_os = "windows")]
#[napi]
pub fn stop_mic_capture(handle: i64) -> napi::Result<()> {
    wasapi_capture::stop_loopback(handle as u64)
}

#[cfg(not(target_os = "windows"))]
#[napi]
pub fn stop_mic_capture(_handle: i64) -> napi::Result<()> {
    Err(napi::Error::from_reason(
        "Mic capture is only supported on Windows.",
    ))
}

/// Get the native module version.
#[napi]
pub fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
