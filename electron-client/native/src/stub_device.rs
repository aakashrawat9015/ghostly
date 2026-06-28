use crate::device::AudioDevice;

/// Stub for Linux — returns empty device list.
/// Full ALSA/PulseAudio support would go here.
pub fn list_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(vec![AudioDevice {
        id: "stub".into(),
        name: "No audio devices available (Linux stub)".into(),
        device_type: "output".into(),
        channels: 2,
        default_sample_rate: 48000.0,
        host_api: "ALSA (stub)".into(),
        is_default: true,
    }])
}
