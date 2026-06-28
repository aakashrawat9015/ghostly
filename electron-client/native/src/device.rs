#[cfg(target_os = "windows")]
use crate::windows_device;
#[cfg(target_os = "macos")]
use crate::macos_device;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use crate::stub_device;

use napi_derive::napi;
use serde::Serialize;

#[napi(object)]
#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub device_type: String, // "input" | "output" | "loopback"
    pub channels: u32,
    pub default_sample_rate: f64,
    pub host_api: String,
    pub is_default: bool,
}

/// List all available audio devices on the system.
#[napi]
pub fn list_devices() -> napi::Result<Vec<AudioDevice>> {
    #[cfg(target_os = "windows")]
    {
        windows_device::list_devices()
            .map_err(|e| napi::Error::from_reason(format!("Failed to list audio devices: {}", e)))
    }
    #[cfg(target_os = "macos")]
    {
        macos_device::list_devices()
            .map_err(|e| napi::Error::from_reason(format!("Failed to list audio devices: {}", e)))
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        stub_device::list_devices()
            .map_err(|e| napi::Error::from_reason(format!("Failed to list audio devices: {}", e)))
    }
}
