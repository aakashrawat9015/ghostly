use crate::device::AudioDevice;
use wasapi::{DeviceCollection, Direction};

/// Enumerate all active audio endpoints via WASAPI.
pub fn list_devices() -> Result<Vec<AudioDevice>, String> {
    // COM must be initialised before any WASAPI call.
    // Swallow RPC_E_CHANGED_MODE: Electron may have already initialised COM as STA,
    // which is fine — WASAPI works from any apartment.
    let _ = wasapi::initialize_mta();

    let mut devices = Vec::new();

    // ── Render (output / loopback) endpoints ────────────────────────
    let default_render_id = wasapi::get_default_device(&Direction::Render)
        .ok()
        .and_then(|d| d.get_id().ok());

    let collection = DeviceCollection::new(&Direction::Render)
        .map_err(|e| format!("DeviceCollection::new(Render): {}", e))?;
    let count = collection
        .get_nbr_devices()
        .map_err(|e| format!("get_nbr_devices: {}", e))?;

    for i in 0..count {
        if let Ok(device) = collection.get_device_at_index(i) {
            let name = device
                .get_friendlyname()
                .unwrap_or_else(|_| format!("Speaker {}", i));
            let id = device
                .get_id()
                .unwrap_or_else(|_| format!("windows_output_{}", i));
            let is_default = default_render_id.as_ref().map(|def| def == &id).unwrap_or(false);

            let (channels, sample_rate) = if let Ok(ac) = device.get_iaudioclient() {
                if let Ok(fmt) = ac.get_mixformat() {
                    (fmt.get_nchannels() as u32, fmt.get_samplespersec() as f64)
                } else {
                    (2u32, 48000.0)
                }
            } else {
                (2u32, 48000.0)
            };

            // Expose both an output entry and a loopback entry (matching Pluely)
            devices.push(AudioDevice {
                id: id.clone(),
                name: name.clone(),
                device_type: "output".into(),
                channels,
                default_sample_rate: sample_rate,
                host_api: "WASAPI".into(),
                is_default,
            });
            devices.push(AudioDevice {
                id,
                name,
                device_type: "loopback".into(),
                channels,
                default_sample_rate: sample_rate,
                host_api: "WASAPI".into(),
                is_default,
            });
        }
    }

    // ── Capture (input) endpoints ────────────────────────────────────
    let default_capture_id = wasapi::get_default_device(&Direction::Capture)
        .ok()
        .and_then(|d| d.get_id().ok());

    if let Ok(collection) = DeviceCollection::new(&Direction::Capture) {
        if let Ok(count) = collection.get_nbr_devices() {
            for i in 0..count {
                if let Ok(device) = collection.get_device_at_index(i) {
                    let name = device
                        .get_friendlyname()
                        .unwrap_or_else(|_| format!("Microphone {}", i));
                    let id = device
                        .get_id()
                        .unwrap_or_else(|_| format!("windows_input_{}", i));
                    let is_default =
                        default_capture_id.as_ref().map(|def| def == &id).unwrap_or(false);

                    let (channels, sample_rate) = if let Ok(ac) = device.get_iaudioclient() {
                        if let Ok(fmt) = ac.get_mixformat() {
                            (fmt.get_nchannels() as u32, fmt.get_samplespersec() as f64)
                        } else {
                            (1u32, 44100.0)
                        }
                    } else {
                        (1u32, 44100.0)
                    };

                    devices.push(AudioDevice {
                        id,
                        name,
                        device_type: "input".into(),
                        channels,
                        default_sample_rate: sample_rate,
                        host_api: "WASAPI".into(),
                        is_default,
                    });
                }
            }
        }
    }

    Ok(devices)
}
