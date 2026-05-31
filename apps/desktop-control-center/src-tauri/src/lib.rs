// Sumo robot WiFi UDP controller backend.
//
// This is the core of the desktop control center. It replaces the
// previous serial-based backend with:
//
// 1. **gilrs** for native gamepad input (sub-ms latency vs browser
//    Gamepad API's 16ms polling interval).
// 2. **UDP over WiFi** for motor commands (the Arduino R4 WiFi creates
//    an access point and listens for UDP packets).
// 3. **Tauri Channel API** for high-frequency telemetry streaming to
//    the React frontend (avoids the overhead of the global event bus).
//
// The control loop runs at 250Hz (4ms interval) in a dedicated OS thread.
// Telemetry is streamed to the frontend at ~30Hz (every 8th tick) to
// avoid overwhelming the renderer while still feeling responsive.

mod controller;
mod drive;
mod network;
mod protocol;
mod telemetry;

use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::controller::read_gamepad;
use crate::drive::compute_arcade_drive;
use crate::network::{create_socket, recv_telemetry, send_command};
use crate::protocol::{decode_telemetry, encode_command};
use crate::telemetry::TelemetryPayload;

// ─── Managed State ───────────────────────────────────────────────────────────

/// Application-wide state shared across Tauri commands and background threads.
///
/// All fields are behind synchronization primitives because:
/// - `running` is checked by multiple threads to coordinate shutdown.
/// - `target_addr` and `socket` are set by `connect` and read by the
///   control loop thread.
/// - Thread handles are stored so `disconnect` can join them cleanly.
pub struct RobotState {
    /// Signals all background threads to stop when set to `false`.
    running: Arc<AtomicBool>,
    /// The Arduino's UDP address (e.g. 192.168.4.1:8888).
    target_addr: Mutex<Option<SocketAddr>>,
    /// The local UDP socket used for both sending commands and
    /// receiving telemetry.
    socket: Mutex<Option<UdpSocket>>,
    /// Handle to the 250Hz control loop thread.
    control_handle: Mutex<Option<JoinHandle<()>>>,
    /// Handle to the telemetry listener thread.
    telemetry_handle: Mutex<Option<JoinHandle<()>>>,
}

impl Default for RobotState {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            target_addr: Mutex::new(None),
            socket: Mutex::new(None),
            control_handle: Mutex::new(None),
            telemetry_handle: Mutex::new(None),
        }
    }
}

// ─── IPC Response Types ──────────────────────────────────────────────────────

/// Connection status returned by `get_status`.
#[derive(Serialize, Clone, Debug)]
pub struct StatusInfo {
    pub connected: bool,
    pub target: Option<String>,
}

/// Gamepad info returned by `list_controllers`.
#[derive(Serialize, Clone, Debug)]
pub struct ControllerInfo {
    pub id: String,
    pub name: String,
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

/// Creates a UDP socket and stores the target Arduino address.
///
/// This establishes the "connection" (UDP is connectionless, but we
/// store the target address so the control loop knows where to send).
/// The control loop is NOT started here — call `start_control_loop`
/// separately so the frontend can attach its telemetry channel first.
#[tauri::command]
fn connect(ip: String, port: u16, state: State<RobotState>) -> Result<(), String> {
    // Parse and store the target address.
    let addr: SocketAddr = format!("{ip}:{port}")
        .parse()
        .map_err(|e| format!("Invalid address {ip}:{port}: {e}"))?;

    let socket = create_socket()?;

    {
        let mut target_guard = state
            .target_addr
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        *target_guard = Some(addr);
    }
    {
        let mut socket_guard = state
            .socket
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        *socket_guard = Some(socket);
    }

    state.running.store(true, Ordering::SeqCst);

    Ok(())
}

/// Stops all background threads and releases the UDP socket.
///
/// Sets `running = false` which causes both the control loop and
/// telemetry listener threads to exit their loops, then joins them
/// to ensure clean shutdown before returning.
#[tauri::command]
fn disconnect(state: State<RobotState>) -> Result<(), String> {
    // Signal all threads to stop.
    state.running.store(false, Ordering::SeqCst);

    // Join the control loop thread.
    if let Ok(mut guard) = state.control_handle.lock() {
        if let Some(handle) = guard.take() {
            let _ = handle.join();
        }
    }

    // Join the telemetry listener thread.
    if let Ok(mut guard) = state.telemetry_handle.lock() {
        if let Some(handle) = guard.take() {
            let _ = handle.join();
        }
    }

    // Release the socket and target address.
    if let Ok(mut guard) = state.socket.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = state.target_addr.lock() {
        *guard = None;
    }

    Ok(())
}

/// Returns the current connection status for the frontend status bar.
#[tauri::command]
fn get_status(state: State<RobotState>) -> Result<StatusInfo, String> {
    let connected = state.running.load(Ordering::SeqCst);
    let target = state
        .target_addr
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?
        .map(|addr| addr.to_string());

    Ok(StatusInfo { connected, target })
}

/// Lists all currently connected gamepads.
///
/// Creates a temporary `Gilrs` instance because this command is called
/// infrequently (e.g. when the user opens settings). The main control
/// loop creates its own long-lived instance.
#[tauri::command]
fn list_controllers() -> Result<Vec<ControllerInfo>, String> {
    let gilrs = gilrs::Gilrs::new().map_err(|e| format!("Failed to init gilrs: {e}"))?;

    let controllers: Vec<ControllerInfo> = gilrs
        .gamepads()
        .filter(|(_, gp)| gp.is_connected())
        .map(|(id, gp)| ControllerInfo {
            id: format!("{id:?}"),
            name: gp.name().to_string(),
        })
        .collect();

    Ok(controllers)
}

/// Starts the 250Hz control loop and telemetry listener in dedicated threads.
///
/// This is the **heart of the application**. The Tauri `Channel<TelemetryPayload>`
/// parameter gives us a zero-copy IPC pipe to the frontend — much faster than
/// `app.emit()` for high-frequency data.
///
/// # Thread architecture
///
/// ```text
///  ┌─────────────────────────────────────────┐
///  │  Control Loop Thread (250Hz)             │
///  │  gilrs → arcade_drive → encode → UDP TX  │
///  │  └─→ Channel (throttled 30Hz)            │
///  └─────────────────────────────────────────┘
///  ┌─────────────────────────────────────────┐
///  │  Telemetry Listener Thread               │
///  │  UDP RX → decode → latency → Channel     │
///  └─────────────────────────────────────────┘
/// ```
#[tauri::command]
fn start_control_loop(
    channel: Channel<TelemetryPayload>,
    state: State<RobotState>,
) -> Result<(), String> {
    // Prevent starting multiple control loops.
    {
        let guard = state
            .control_handle
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        if guard.is_some() {
            return Err("Control loop already running".to_string());
        }
    }

    // Clone the socket for the telemetry listener thread.
    let socket_for_control = {
        let guard = state
            .socket
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        guard
            .as_ref()
            .ok_or("Not connected — call connect() first")?
            .try_clone()
            .map_err(|e| format!("Failed to clone socket: {e}"))?
    };

    let socket_for_telemetry = {
        let guard = state
            .socket
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        guard
            .as_ref()
            .ok_or("Not connected — call connect() first")?
            .try_clone()
            .map_err(|e| format!("Failed to clone socket: {e}"))?
    };

    let target_addr = {
        let guard = state
            .target_addr
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        guard.ok_or("No target address configured")?
    };

    let running = Arc::clone(&state.running);
    let running_telemetry = Arc::clone(&state.running);
    let channel_telemetry = channel.clone();

    // ── Telemetry Listener Thread ────────────────────────────────────────

    let telemetry_handle = thread::Builder::new()
        .name("telemetry-listener".into())
        .spawn(move || {
            telemetry_listener_loop(
                socket_for_telemetry,
                running_telemetry,
                channel_telemetry,
            );
        })
        .map_err(|e| format!("Failed to spawn telemetry thread: {e}"))?;

    // ── Control Loop Thread (250Hz) ──────────────────────────────────────

    let control_handle = thread::Builder::new()
        .name("control-loop-250hz".into())
        .spawn(move || {
            control_loop(
                socket_for_control,
                target_addr,
                running,
                channel,
            );
        })
        .map_err(|e| format!("Failed to spawn control thread: {e}"))?;

    // Store thread handles so `disconnect` can join them.
    {
        let mut guard = state
            .control_handle
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        *guard = Some(control_handle);
    }
    {
        let mut guard = state
            .telemetry_handle
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        *guard = Some(telemetry_handle);
    }

    Ok(())
}

// ─── Background Thread Functions ─────────────────────────────────────────────

/// The 250Hz control loop — reads gamepad, computes motor output, sends UDP.
///
/// This function runs in its own OS thread and is the real-time core of
/// the application. Every design decision here prioritizes latency:
///
/// - `gilrs` is created inside this thread to avoid cross-thread sync.
/// - `encode_command` is zero-allocation (stack array only).
/// - Telemetry is throttled to 30Hz (every 8th tick) to avoid flooding
///   the frontend IPC channel.
/// - CPS is computed over 1-second rolling windows for stable readout.
fn control_loop(
    socket: UdpSocket,
    target_addr: SocketAddr,
    running: Arc<AtomicBool>,
    channel: Channel<TelemetryPayload>,
) {
    // Create gilrs in this thread — it must be polled from the thread
    // that created it on some platforms (notably macOS IOKit).
    let mut gilrs = match gilrs::Gilrs::new() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("[control-loop] Failed to init gilrs: {e}");
            return;
        }
    };

    // ── CPS tracking state ───────────────────────────────────────────────
    let mut cmd_count: u64 = 0;
    let mut cps_window_start = Instant::now();
    let mut current_cps: f64 = 0.0;

    // ── Telemetry throttle counter ───────────────────────────────────────
    // Send telemetry to the frontend every 8th iteration:
    // 250Hz / 8 = ~31.25Hz, close to 30Hz target.
    let mut tick_counter: u64 = 0;

    // Track previous controller state to emit StatusChange on transitions.
    let mut prev_connected = false;

    // ── Main loop ────────────────────────────────────────────────────────
    // HOT PATH — everything below runs at 250Hz
    while running.load(Ordering::Relaxed) {
        let tick_start = Instant::now();

        // 1. Read gamepad input with deadzone compensation.
        let gamepad_state = read_gamepad(&mut gilrs);

        // 2. Emit StatusChange when controller connect/disconnect occurs.
        if gamepad_state.connected != prev_connected {
            let _ = channel.send(TelemetryPayload::StatusChange {
                connected: true, // UDP "connection" is still active
                controller_connected: gamepad_state.connected,
                controller_name: if gamepad_state.connected {
                    Some(gamepad_state.name.clone())
                } else {
                    None
                },
            });
            prev_connected = gamepad_state.connected;
        }

        // 3. Compute arcade drive from left stick axes.
        let motor_output = compute_arcade_drive(gamepad_state.left_x, gamepad_state.left_y);

        // 4. Encode to 6-byte wire format — zero heap allocation.
        let packet = encode_command(&motor_output);

        // 5. Send UDP command to the Arduino.
        if let Err(e) = send_command(&socket, &target_addr, &packet) {
            eprintln!("[control-loop] Send failed: {e}");
        }

        // 6. Update CPS counter.
        cmd_count += 1;
        let elapsed = cps_window_start.elapsed();
        if elapsed >= Duration::from_secs(1) {
            current_cps = cmd_count as f64 / elapsed.as_secs_f64();
            cmd_count = 0;
            cps_window_start = Instant::now();
        }

        // 7. Stream telemetry to frontend (throttled to ~30Hz).
        tick_counter += 1;
        if tick_counter % 8 == 0 {
            let _ = channel.send(TelemetryPayload::ControlState {
                gamepad: gamepad_state,
                motor: motor_output,
                // Single allocation per 30Hz tick — acceptable at this rate.
                packet: packet.to_vec(),
                cps: current_cps,
            });
        }

        // 8. Sleep to maintain 250Hz cadence.
        // Subtract elapsed processing time for more accurate timing.
        let processing_time = tick_start.elapsed();
        let target_interval = Duration::from_millis(4);
        if let Some(remaining) = target_interval.checked_sub(processing_time) {
            thread::sleep(remaining);
        }
    }
}

/// Telemetry listener — receives Arduino heartbeat packets and measures
/// round-trip latency.
///
/// Runs in its own thread with the socket's read timeout set to 50ms
/// (configured in `create_socket`). When no data arrives, the timeout
/// fires and we simply loop back to check the `running` flag.
fn telemetry_listener_loop(
    socket: UdpSocket,
    running: Arc<AtomicBool>,
    channel: Channel<TelemetryPayload>,
) {
    // Reusable receive buffer — kept on the stack, no allocation per iteration.
    let mut buf = [0u8; 64];

    // Timestamp of last command send for latency estimation.
    // Since we don't have the exact send timestamp from the control loop
    // thread, we approximate by tracking when we last received a response.
    let mut last_recv = Instant::now();

    while running.load(Ordering::Relaxed) {
        match recv_telemetry(&socket, &mut buf) {
            Ok((len, _src)) => {
                let now = Instant::now();
                if let Some(response) = decode_telemetry(&buf[..len]) {
                    // Approximate round-trip latency as time between consecutive
                    // telemetry packets. This isn't true RTT but gives a useful
                    // health indicator — if it spikes, something is wrong.
                    let latency_us = now.duration_since(last_recv).as_micros() as u64;
                    last_recv = now;

                    let _ = channel.send(TelemetryPayload::RobotTelemetry {
                        latency_us,
                        arduino_uptime_ms: response.uptime_ms as u32,
                    });
                }
            }
            Err(_) => {
                // Timeout or socket error — not fatal for UDP.
                // The 50ms read timeout in create_socket ensures we
                // re-check the running flag frequently.
            }
        }
    }
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

/// Boots the Tauri application with UDP WiFi commands and managed `RobotState`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(RobotState::default())
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            get_status,
            list_controllers,
            start_control_loop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
