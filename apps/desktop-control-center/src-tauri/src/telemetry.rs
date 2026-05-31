// Telemetry types streamed to the frontend via Tauri's Channel API.
//
// All variants are serialized with `#[serde(tag = "type")]` so the
// frontend receives a discriminated union it can switch on:
//
//   { type: "ControlState", gamepad: {...}, motor: {...}, ... }
//   { type: "RobotTelemetry", latency_us: 1234, ... }
//   { type: "StatusChange", connected: true, ... }
//
// The Channel API is used instead of `app.emit()` because it avoids
// the overhead of Tauri's global event system. For 250Hz telemetry
// this matters — Channel writes are a direct IPC call with no event
// bus fan-out.

use serde::Serialize;

use crate::controller::ControllerState;
use crate::protocol::MotorOutput;

/// Discriminated union of all telemetry events the backend can push
/// to the frontend through a Tauri Channel.
#[derive(Clone, Serialize)]
#[serde(tag = "type")]
pub enum TelemetryPayload {
    /// Sent every ~8th control loop tick (~30Hz) with the current
    /// gamepad axes, computed motor output, raw packet bytes, and
    /// throughput measurement.
    ControlState {
        gamepad: ControllerState,
        motor: MotorOutput,
        /// The 6-byte command packet as a Vec for serde compatibility.
        /// We accept the single allocation here because this variant
        /// is only sent at 30Hz (throttled), not on every 250Hz tick.
        packet: Vec<u8>,
        /// Commands per second — measured over 1-second rolling windows.
        cps: f64,
    },

    /// Sent when the Arduino responds with a heartbeat telemetry packet.
    /// Used by the frontend to display connection health and latency.
    RobotTelemetry {
        /// Round-trip UDP latency in microseconds.
        latency_us: u64,
        /// Arduino's `millis()` uptime — useful for detecting reboots.
        arduino_uptime_ms: u32,
    },

    /// Sent when connection or controller status changes. The frontend
    /// uses this to update status indicators without polling.
    StatusChange {
        connected: bool,
        controller_connected: bool,
        controller_name: Option<String>,
    },
}
