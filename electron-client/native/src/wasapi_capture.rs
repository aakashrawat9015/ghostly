/// WASAPI loopback capture for Windows.
///
/// Architecture mirrors Pluely's windows.rs:
///   - Sync init handshake via mpsc — caller blocks until WASAPI is ready or fails
///   - Wait-first event loop (wait → read, not read → wait)
///   - Graceful shutdown: signal + join thread

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

use wasapi::{Direction, SampleType, StreamMode, WasapiError, WaveFormat};

struct CaptureState {
    shutdown: AtomicBool,
}

pub struct CaptureHandle {
    state: Arc<CaptureState>,
    thread: Option<thread::JoinHandle<()>>,
}

/// Start WASAPI loopback capture.
///
/// Blocks up to 5 s waiting for WASAPI initialisation; returns an error
/// immediately if init fails rather than handing back a silent handle.
pub fn start_loopback(
    device_id: &str,
    target_sample_rate: u32,
    target_channels: u16,
    callback: napi::threadsafe_function::ThreadsafeFunction<
        Vec<u8>,
        napi::threadsafe_function::ErrorStrategy::Fatal,
    >,
) -> napi::Result<u64> {
    let state = Arc::new(CaptureState {
        shutdown: AtomicBool::new(false),
    });
    let state_clone = state.clone();
    let device_id_owned = device_id.to_string();
    let (init_tx, init_rx) = mpsc::channel::<Result<(), String>>();

    let thread = thread::spawn(move || {
        if let Err(e) = run_capture_loop(
            &device_id_owned,
            state_clone,
            target_sample_rate,
            target_channels,
            callback,
            init_tx,
        ) {
            eprintln!("[ghostly-audio] Capture error: {}", e);
        }
    });

    // Wait up to 5 s for WASAPI init (matching Pluely's recv_timeout pattern)
    match init_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            return Err(napi::Error::from_reason(format!(
                "Failed to start loopback capture: {}",
                e
            )));
        }
        Err(_) => {
            return Err(napi::Error::from_reason(
                "Loopback capture init timed out (5 s)",
            ));
        }
    }

    let handle = Box::into_raw(Box::new(CaptureHandle {
        state,
        thread: Some(thread),
    })) as u64;

    Ok(handle)
}

/// Stop WASAPI loopback capture. Signals the thread and joins it.
pub fn stop_loopback(handle: u64) -> napi::Result<()> {
    if handle == 0 {
        return Err(napi::Error::from_reason("Invalid capture handle"));
    }
    let mut h = unsafe { Box::from_raw(handle as *mut CaptureHandle) };
    h.state.shutdown.store(true, Ordering::SeqCst);
    if let Some(thread) = h.thread.take() {
        let _ = thread.join();
    }
    Ok(())
}

fn run_capture_loop(
    device_id: &str,
    state: Arc<CaptureState>,
    target_sample_rate: u32,
    target_channels: u16,
    callback: napi::threadsafe_function::ThreadsafeFunction<
        Vec<u8>,
        napi::threadsafe_function::ErrorStrategy::Fatal,
    >,
    init_tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    // ── Initialise WASAPI ─────────────────────────────────────────────
    let init_result = (|| -> Result<_, String> {
        // COM must be initialised on this thread before any WASAPI call.
        // Swallow RPC_E_CHANGED_MODE: Electron may have already initialised COM as STA.
        let _ = wasapi::initialize_mta();

        let device = if device_id == "default" || device_id.is_empty() {
            wasapi::get_default_device(&Direction::Render)
                .map_err(|e| format!("get_default_device: {}", e))?
        } else {
            find_render_device_by_id(device_id)
                .ok_or_else(|| format!("Device not found: {}", device_id))?
        };

        let device_name = device
            .get_friendlyname()
            .unwrap_or_else(|_| "Unknown".to_string());
        eprintln!(
            "[ghostly-audio] Device: {}, target={}Hz {}ch",
            device_name, target_sample_rate, target_channels
        );

        let mut audio_client = device
            .get_iaudioclient()
            .map_err(|e| format!("get_iaudioclient: {}", e))?;

        let device_format = audio_client
            .get_mixformat()
            .map_err(|e| format!("get_mixformat: {}", e))?;
        let native_rate = device_format.get_samplespersec();
        let native_channels = device_format.get_nchannels() as usize;
        eprintln!(
            "[ghostly-audio] Native format: {}Hz {}ch",
            native_rate, native_channels
        );

        // Capture in the device's native channel count (stereo).
        // WASAPI delivers data in this format; we downmix to mono ourselves below.
        // Using target_channels here would cause WASAPI to deliver already-mono data
        // while native_channels=2 is still used in the downmix, corrupting the signal.
        let desired_format = WaveFormat::new(
            32,
            32,
            &SampleType::Float,
            native_rate as usize,
            native_channels,
            None,
        );

        let (_default_period, min_period) = audio_client
            .get_device_period()
            .map_err(|e| format!("get_device_period: {}", e))?;

        audio_client
            .initialize_client(
                &desired_format,
                &Direction::Capture,
                &StreamMode::EventsShared {
                    autoconvert: true,
                    buffer_duration_hns: min_period,
                },
            )
            .map_err(|e| format!("initialize_client: {}", e))?;

        let h_event = audio_client
            .set_get_eventhandle()
            .map_err(|e| format!("set_get_eventhandle: {}", e))?;

        let capture_client = audio_client
            .get_audiocaptureclient()
            .map_err(|e| format!("get_audiocaptureclient: {}", e))?;

        audio_client
            .start_stream()
            .map_err(|e| format!("start_stream: {}", e))?;

        eprintln!("[ghostly-audio] Loopback capture started");
        Ok((audio_client, h_event, capture_client, native_rate, native_channels))
    })();

    let (audio_client, h_event, capture_client, native_rate, native_channels) =
        match init_result {
            Ok(v) => {
                let _ = init_tx.send(Ok(()));
                v
            }
            Err(e) => {
                let _ = init_tx.send(Err(e.clone()));
                return Err(e);
            }
        };

    // ── Capture loop ──────────────────────────────────────────────────
    let step = {
        let src = native_rate as f64;
        let tgt = target_sample_rate as f64;
        if src > tgt { src / tgt } else { 1.0 }
    };

    loop {
        if state.shutdown.load(Ordering::SeqCst) {
            break;
        }

        // Wait-first pattern (matching Pluely's windows.rs)
        match h_event.wait_for_event(3000) {
            Ok(()) => {}
            Err(WasapiError::EventTimeout) => {
                // No audio playing — keep waiting
                continue;
            }
            Err(e) => {
                eprintln!("[ghostly-audio] Event wait error: {}, stopping", e);
                break;
            }
        }

        if state.shutdown.load(Ordering::SeqCst) {
            break;
        }

        let mut raw_bytes: std::collections::VecDeque<u8> = std::collections::VecDeque::new();
        if let Err(e) = capture_client.read_from_device_to_deque(&mut raw_bytes) {
            eprintln!("[ghostly-audio] Read error: {}", e);
            continue;
        }

        if raw_bytes.is_empty() {
            continue;
        }

        // ── Deserialise f32 samples ───────────────────────────────────
        let mut samples: Vec<f32> = Vec::with_capacity(raw_bytes.len() / 4);
        while raw_bytes.len() >= 4 {
            let bytes = [
                raw_bytes.pop_front().unwrap(),
                raw_bytes.pop_front().unwrap(),
                raw_bytes.pop_front().unwrap(),
                raw_bytes.pop_front().unwrap(),
            ];
            samples.push(f32::from_le_bytes(bytes));
        }

        if samples.is_empty() {
            continue;
        }

        // ── Downmix to mono ───────────────────────────────────────────
        let num_frames = samples.len() / native_channels;
        let mut mono: Vec<f32> = Vec::with_capacity(num_frames);
        for frame_idx in 0..num_frames {
            let mut sum = 0.0f32;
            for ch in 0..native_channels {
                sum += samples[frame_idx * native_channels + ch];
            }
            mono.push(sum / native_channels as f32);
        }

        // ── Downsample + convert to PCM16 ─────────────────────────────
        let mut pcm16: Vec<u8> = Vec::with_capacity((mono.len() as f64 / step) as usize * 2);
        let mut i = 0.0f64;
        while (i as usize) < mono.len() {
            let s = mono[i as usize].clamp(-1.0, 1.0);
            pcm16.extend_from_slice(&((s * 32767.0) as i16).to_le_bytes());
            i += step;
        }

        if !pcm16.is_empty() {
            callback.call(
                pcm16,
                napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────
    let _ = audio_client.stop_stream();
    eprintln!("[ghostly-audio] Loopback capture stopped");
    Ok(())
}

/// Start WASAPI microphone capture.
///
/// Same handshake as start_loopback but targets a capture (input) device.
pub fn start_mic_capture(
    device_id: &str,
    target_sample_rate: u32,
    target_channels: u16,
    callback: napi::threadsafe_function::ThreadsafeFunction<
        Vec<u8>,
        napi::threadsafe_function::ErrorStrategy::Fatal,
    >,
) -> napi::Result<u64> {
    let state = Arc::new(CaptureState {
        shutdown: AtomicBool::new(false),
    });
    let state_clone = state.clone();
    let device_id_owned = device_id.to_string();
    let (init_tx, init_rx) = mpsc::channel::<Result<(), String>>();

    let thread = thread::spawn(move || {
        if let Err(e) = run_mic_capture_loop(
            &device_id_owned,
            state_clone,
            target_sample_rate,
            target_channels,
            callback,
            init_tx,
        ) {
            eprintln!("[ghostly-audio] Mic capture error: {}", e);
        }
    });

    match init_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            return Err(napi::Error::from_reason(format!(
                "Failed to start mic capture: {}",
                e
            )));
        }
        Err(_) => {
            return Err(napi::Error::from_reason(
                "Mic capture init timed out (5 s)",
            ));
        }
    }

    let handle = Box::into_raw(Box::new(CaptureHandle {
        state,
        thread: Some(thread),
    })) as u64;

    Ok(handle)
}

fn run_mic_capture_loop(
    device_id: &str,
    state: Arc<CaptureState>,
    target_sample_rate: u32,
    target_channels: u16,
    callback: napi::threadsafe_function::ThreadsafeFunction<
        Vec<u8>,
        napi::threadsafe_function::ErrorStrategy::Fatal,
    >,
    init_tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    let init_result = (|| -> Result<_, String> {
        let _ = wasapi::initialize_mta();

        let device = if device_id == "default" || device_id.is_empty() {
            wasapi::get_default_device(&Direction::Capture)
                .map_err(|e| format!("get_default_device(mic): {}", e))?
        } else {
            find_capture_device_by_id(device_id)
                .ok_or_else(|| format!("Mic device not found: {}", device_id))?
        };

        let device_name = device
            .get_friendlyname()
            .unwrap_or_else(|_| "Unknown".to_string());
        eprintln!(
            "[ghostly-audio] Mic: {}, target={}Hz {}ch",
            device_name, target_sample_rate, target_channels
        );

        let mut audio_client = device
            .get_iaudioclient()
            .map_err(|e| format!("get_iaudioclient(mic): {}", e))?;

        let device_format = audio_client
            .get_mixformat()
            .map_err(|e| format!("get_mixformat(mic): {}", e))?;
        let native_rate = device_format.get_samplespersec();
        let native_channels = device_format.get_nchannels() as usize;
        eprintln!(
            "[ghostly-audio] Mic native format: {}Hz {}ch",
            native_rate, native_channels
        );

        let desired_format = WaveFormat::new(
            32,
            32,
            &SampleType::Float,
            native_rate as usize,
            native_channels,
            None,
        );

        let (_default_period, min_period) = audio_client
            .get_device_period()
            .map_err(|e| format!("get_device_period(mic): {}", e))?;

        audio_client
            .initialize_client(
                &desired_format,
                &Direction::Capture,
                &StreamMode::EventsShared {
                    autoconvert: true,
                    buffer_duration_hns: min_period,
                },
            )
            .map_err(|e| format!("initialize_client(mic): {}", e))?;

        let h_event = audio_client
            .set_get_eventhandle()
            .map_err(|e| format!("set_get_eventhandle(mic): {}", e))?;

        let capture_client = audio_client
            .get_audiocaptureclient()
            .map_err(|e| format!("get_audiocaptureclient(mic): {}", e))?;

        audio_client
            .start_stream()
            .map_err(|e| format!("start_stream(mic): {}", e))?;

        eprintln!("[ghostly-audio] Mic capture started");
        Ok((audio_client, h_event, capture_client, native_rate, native_channels))
    })();

    let (audio_client, h_event, capture_client, native_rate, native_channels) =
        match init_result {
            Ok(v) => {
                let _ = init_tx.send(Ok(()));
                v
            }
            Err(e) => {
                let _ = init_tx.send(Err(e.clone()));
                return Err(e);
            }
        };

    let step = {
        let src = native_rate as f64;
        let tgt = target_sample_rate as f64;
        if src > tgt { src / tgt } else { 1.0 }
    };

    loop {
        if state.shutdown.load(Ordering::SeqCst) {
            break;
        }

        match h_event.wait_for_event(3000) {
            Ok(()) => {}
            Err(WasapiError::EventTimeout) => continue,
            Err(e) => {
                eprintln!("[ghostly-audio] Mic event wait error: {}, stopping", e);
                break;
            }
        }

        if state.shutdown.load(Ordering::SeqCst) {
            break;
        }

        let mut raw_bytes: std::collections::VecDeque<u8> = std::collections::VecDeque::new();
        if let Err(e) = capture_client.read_from_device_to_deque(&mut raw_bytes) {
            eprintln!("[ghostly-audio] Mic read error: {}", e);
            continue;
        }

        if raw_bytes.is_empty() {
            continue;
        }

        let mut samples: Vec<f32> = Vec::with_capacity(raw_bytes.len() / 4);
        while raw_bytes.len() >= 4 {
            let bytes = [
                raw_bytes.pop_front().unwrap(),
                raw_bytes.pop_front().unwrap(),
                raw_bytes.pop_front().unwrap(),
                raw_bytes.pop_front().unwrap(),
            ];
            samples.push(f32::from_le_bytes(bytes));
        }

        if samples.is_empty() {
            continue;
        }

        let num_frames = samples.len() / native_channels;
        let mut mono: Vec<f32> = Vec::with_capacity(num_frames);
        for frame_idx in 0..num_frames {
            let mut sum = 0.0f32;
            for ch in 0..native_channels {
                sum += samples[frame_idx * native_channels + ch];
            }
            mono.push(sum / native_channels as f32);
        }

        let mut pcm16: Vec<u8> = Vec::with_capacity((mono.len() as f64 / step) as usize * 2);
        let mut i = 0.0f64;
        while (i as usize) < mono.len() {
            let s = mono[i as usize].clamp(-1.0, 1.0);
            pcm16.extend_from_slice(&((s * 32767.0) as i16).to_le_bytes());
            i += step;
        }

        if !pcm16.is_empty() {
            callback.call(
                pcm16,
                napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
    }

    let _ = audio_client.stop_stream();
    eprintln!("[ghostly-audio] Mic capture stopped");
    Ok(())
}

/// Find a render device by its WASAPI endpoint ID string.
fn find_render_device_by_id(device_id: &str) -> Option<wasapi::Device> {
    let collection = wasapi::DeviceCollection::new(&Direction::Render).ok()?;
    let count = collection.get_nbr_devices().ok()?;
    for i in 0..count {
        let device = collection.get_device_at_index(i).ok()?;
        if let Ok(id) = device.get_id() {
            if id == device_id {
                return Some(device);
            }
        }
    }
    None
}

/// Find a capture device by its WASAPI endpoint ID string.
fn find_capture_device_by_id(device_id: &str) -> Option<wasapi::Device> {
    let collection = wasapi::DeviceCollection::new(&Direction::Capture).ok()?;
    let count = collection.get_nbr_devices().ok()?;
    for i in 0..count {
        let device = collection.get_device_at_index(i).ok()?;
        if let Ok(id) = device.get_id() {
            if id == device_id {
                return Some(device);
            }
        }
    }
    None
}
