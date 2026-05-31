// Serial communication backend for the sumo robot controller.
//
// This module provides a Tauri command interface for managing a persistent
// serial connection to an Arduino-based sumo robot. The connection is held
// in Tauri managed state behind a Mutex so it survives across IPC calls.
//
// The motor command packet format (6 bytes):
//   [HEADER, LEFT_DIR, LEFT_PWM, RIGHT_DIR, RIGHT_PWM, CHECKSUM]
//
// HEADER   = 0xFF (sync marker — the Arduino receiver scans for this byte
//            to align on the start of a new packet)
// CHECKSUM = XOR of bytes 1‥4 (LEFT_DIR ^ LEFT_PWM ^ RIGHT_DIR ^ RIGHT_PWM)

use serialport::SerialPort;
use std::sync::Mutex;
use std::time::Duration;
use tauri::State;

// ─── Managed State ───────────────────────────────────────────────────────────

/// Wraps an optional, heap-allocated serial port behind a `Mutex` so the
/// connection can be shared safely across Tauri's async command invocations.
///
/// When no port is connected the inner value is `None`.
/// `Default` seeds the state as disconnected.
pub struct SerialState {
    pub port: Mutex<Option<Box<dyn SerialPort + Send>>>,
}

impl Default for SerialState {
    fn default() -> Self {
        Self {
            port: Mutex::new(None),
        }
    }
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Lists available serial ports, filtered to macOS Bluetooth/USB serial
/// devices whose path starts with `/dev/tty.`.
///
/// This convention filters out the `/dev/cu.*` duplicates and other virtual
/// devices that are not relevant to the robot's Bluetooth SPP link.
#[tauri::command]
fn list_serial_ports() -> Result<Vec<String>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;

    let names: Vec<String> = ports
        .into_iter()
        .map(|p| p.port_name)
        .filter(|name| name.contains("/dev/tty."))
        .collect();

    Ok(names)
}

/// Opens a serial connection to the given `port_name` and stores it in the
/// managed state.
///
/// If a port is already open it is closed (dropped) before the new one is
/// opened. The connection parameters are fixed to match the Arduino firmware:
///
/// | Parameter    | Value   |
/// |--------------|---------|
/// | Baud rate    | 115 200 |
/// | Data bits    | 8       |
/// | Stop bits    | 1       |
/// | Parity       | None    |
/// | Flow control | None    |
/// | Timeout      | 10 ms   |
#[tauri::command]
fn connect_serial(port_name: &str, state: State<SerialState>) -> Result<(), String> {
    let mut guard = state.port.lock().map_err(|e| e.to_string())?;

    // Drop any previously open port before opening a new one.
    if guard.is_some() {
        *guard = None;
    }

    let port = serialport::new(port_name, 115_200)
        .data_bits(serialport::DataBits::Eight)
        .stop_bits(serialport::StopBits::One)
        .parity(serialport::Parity::None)
        .flow_control(serialport::FlowControl::None)
        .timeout(Duration::from_millis(10))
        .open()
        .map_err(|e| format!("Failed to open port {port_name}: {e}"))?;

    *guard = Some(port);
    Ok(())
}

/// Closes the serial connection by taking ownership of the port and dropping
/// it. After this call `get_connection_status` will return `false`.
#[tauri::command]
fn disconnect_serial(state: State<SerialState>) -> Result<(), String> {
    let mut guard = state.port.lock().map_err(|e| e.to_string())?;

    // `take()` moves the port out of the Option, and the implicit drop at the
    // end of this scope closes the underlying file descriptor.
    guard.take();
    Ok(())
}

/// Sends a 6-byte motor command packet over the serial link.
///
/// **This is the HOT PATH** — the frontend calls it at ~60 Hz for real-time
/// joystick control, so it must be as lean as possible:
///
/// 1. Lock the mutex (cheap, uncontended).
/// 2. Build the packet in a stack-allocated array — zero heap allocation.
/// 3. `write_all` + `flush` to push bytes immediately.
///
/// # Packet layout
///
/// | Byte | Field       | Description                        |
/// |------|-------------|------------------------------------|
/// | 0    | `0xFF`      | Sync header for Arduino receiver   |
/// | 1    | `left_dir`  | Left motor direction (0 or 1)      |
/// | 2    | `left_pwm`  | Left motor speed (0–255)           |
/// | 3    | `right_dir` | Right motor direction (0 or 1)     |
/// | 4    | `right_pwm` | Right motor speed (0–255)          |
/// | 5    | checksum    | XOR of bytes 1‥4                   |
#[tauri::command]
fn send_motor_command(
    left_pwm: u8,
    left_dir: u8,
    right_pwm: u8,
    right_dir: u8,
    state: State<SerialState>,
) -> Result<(), String> {
    let mut guard = state.port.lock().map_err(|e| e.to_string())?;

    let port = guard
        .as_mut()
        .ok_or_else(|| "No serial port connected".to_string())?;

    // XOR checksum over the four payload bytes for basic integrity checking.
    let checksum = left_dir ^ left_pwm ^ right_dir ^ right_pwm;

    let packet: [u8; 6] = [
        0xFF,      // sync header — the Arduino scans for this byte
        left_dir,  // left motor direction
        left_pwm,  // left motor PWM duty cycle
        right_dir, // right motor direction
        right_pwm, // right motor PWM duty cycle
        checksum,  // XOR of bytes 1..4
    ];

    port.write_all(&packet)
        .map_err(|e| format!("Serial write failed: {e}"))?;

    port.flush()
        .map_err(|e| format!("Serial flush failed: {e}"))?;

    Ok(())
}

/// Returns `true` when a serial port is currently open and stored in state.
/// The frontend polls this to update the connection indicator in the UI.
#[tauri::command]
fn get_connection_status(state: State<SerialState>) -> Result<bool, String> {
    let guard = state.port.lock().map_err(|e| e.to_string())?;
    Ok(guard.is_some())
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

/// Boots the Tauri application, registering all serial commands and the
/// shared `SerialState` as managed state.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SerialState::default())
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect_serial,
            disconnect_serial,
            send_motor_command,
            get_connection_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
