// Gamepad input module using the `gilrs` crate for cross-platform
// controller support (macOS HID, Windows XInput/DirectInput, Linux evdev).
//
// Moving gamepad reading to the Rust backend (instead of the Browser
// Gamepad API) eliminates the browser's polling overhead and gives us
// sub-millisecond input latency. The `gilrs` event loop runs in the
// same thread as the 250Hz control loop to avoid synchronization costs.

use gilrs::{Axis, Gilrs};
use serde::Serialize;

/// Snapshot of all gamepad axes and connection state at a single point
/// in time. Sent to the frontend as part of telemetry.
#[derive(Serialize, Clone, Debug)]
pub struct ControllerState {
    pub left_x: f32,
    pub left_y: f32,
    pub right_x: f32,
    pub right_y: f32,
    pub connected: bool,
    pub name: String,
}

impl Default for ControllerState {
    fn default() -> Self {
        Self {
            left_x: 0.0,
            left_y: 0.0,
            right_x: 0.0,
            right_y: 0.0,
            connected: false,
            name: String::new(),
        }
    }
}

/// Minimum stick deflection to register as intentional input.
///
/// Gamepads drift slightly around center due to potentiometer wear and
/// manufacturing tolerance. 0.08 (~8%) is a conservative threshold that
/// eliminates drift on most controllers without eating into usable range.
const DEADZONE: f32 = 0.08;

/// Removes deadzone and rescales the remaining range to [0.0, 1.0].
///
/// Without rescaling, the output would jump from 0.0 to `deadzone` the
/// instant the stick crosses the threshold — creating a noticeable lurch
/// in motor response. This formula smoothly maps:
///
///   |value| < deadzone  →  0.0
///   |value| = deadzone  →  0.0  (continuous at the boundary)
///   |value| = 1.0       →  1.0
///
/// The sign of the original value is preserved.
///
/// # HOT PATH — called 4× per tick (one per axis)
#[inline]
fn apply_deadzone(value: f32, deadzone: f32) -> f32 {
    if value.abs() < deadzone {
        return 0.0;
    }
    let sign = value.signum();
    (value.abs() - deadzone) / (1.0 - deadzone) * sign
}

/// Drains all pending gilrs events and reads the first connected
/// gamepad's stick axes.
///
/// gilrs uses an event-driven model: axis values are cached internally
/// and updated when events arrive. We must call `next_event()` in a loop
/// to drain the queue, otherwise stale events accumulate and the axis
/// values become outdated.
///
/// # HOT PATH — called at 250Hz
pub fn read_gamepad(gilrs: &mut Gilrs) -> ControllerState {
    // Drain all pending events to keep the internal state up-to-date.
    // We don't inspect individual events — we just need gilrs to
    // process them so `gamepad.value()` returns fresh data.
    while gilrs.next_event().is_some() {}

    // Find the first connected gamepad. In a sumo competition there's
    // only ever one controller, so picking the first is correct.
    let Some((_id, gamepad)) = gilrs.gamepads().find(|(_, gp)| gp.is_connected()) else {
        return ControllerState::default();
    };

    let name = gamepad.name().to_string();

    // Read raw axis values and apply deadzone compensation.
    let left_x = apply_deadzone(gamepad.value(Axis::LeftStickX), DEADZONE);
    let left_y = apply_deadzone(gamepad.value(Axis::LeftStickY), DEADZONE);
    let right_x = apply_deadzone(gamepad.value(Axis::RightStickX), DEADZONE);
    let right_y = apply_deadzone(gamepad.value(Axis::RightStickY), DEADZONE);

    ControllerState {
        left_x,
        left_y,
        right_x,
        right_y,
        connected: true,
        name,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadzone_removes_small_values() {
        assert_eq!(apply_deadzone(0.05, DEADZONE), 0.0);
        assert_eq!(apply_deadzone(-0.05, DEADZONE), 0.0);
    }

    #[test]
    fn deadzone_preserves_max() {
        let result = apply_deadzone(1.0, DEADZONE);
        assert!((result - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn deadzone_is_continuous_at_boundary() {
        // Just above threshold should produce a value very close to 0
        let result = apply_deadzone(DEADZONE + 0.001, DEADZONE);
        assert!(result > 0.0);
        assert!(result < 0.01);
    }

    #[test]
    fn deadzone_preserves_sign() {
        let pos = apply_deadzone(0.5, DEADZONE);
        let neg = apply_deadzone(-0.5, DEADZONE);
        assert!(pos > 0.0);
        assert!(neg < 0.0);
        assert!((pos + neg).abs() < f32::EPSILON);
    }
}
