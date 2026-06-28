use crate::device::AudioDevice;

/// Enumerate CoreAudio input devices on macOS.
pub fn list_devices() -> Result<Vec<AudioDevice>, String> {
    // coreaudio-rs provides device enumeration via AudioObject properties
    // For now, return a basic input device to validate the NAPI-RS build pipeline
    // A full implementation would iterate AudioObjectGetPropertyData for all devices

    // Attempt to get the default input device
    let devices = vec![AudioDevice {
        id: "default_input".into(),
        name: "Default Input (CoreAudio)".into(),
        device_type: "input".into(),
        channels: 2,
        default_sample_rate: 44100.0,
        host_api: "CoreAudio".into(),
        is_default: true,
    }];

    Ok(devices)
}
