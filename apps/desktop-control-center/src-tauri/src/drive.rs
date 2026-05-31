// Arcade drive computation — converts joystick axes into differential
// motor outputs for a two-wheeled sumo robot.
//
// "Arcade drive" maps a single joystick to both motors:
//   left  = throttle + steering
//   right = throttle - steering
//
// This is ported from the TypeScript frontend implementation. The key
// difference: gilrs reports Y-axis as positive-up (push forward = +1),
// which matches our convention directly — no negation needed, unlike
// the Browser Gamepad API where Y is inverted.
//
// # HOT PATH — called at 250Hz in the control loop.

use crate::protocol::MotorOutput;

/// Computes arcade drive motor outputs from joystick axes.
///
/// # Arguments
/// - `x` — horizontal axis (left = -1.0, right = +1.0), controls steering
/// - `y` — vertical axis (down = -1.0, up = +1.0), controls throttle
///
/// # Returns
/// A `MotorOutput` with direction bytes (0 = forward, 1 = reverse) and
/// PWM values (0–255) for each motor.
///
/// # HOT PATH — zero heap allocation
#[inline]
pub fn compute_arcade_drive(x: f32, y: f32) -> MotorOutput {
    // Mix throttle and steering into per-side power values.
    let left = (y + x).clamp(-1.0, 1.0);
    let right = (y - x).clamp(-1.0, 1.0);

    // Decompose signed float into direction bit + unsigned PWM byte.
    // Positive values = forward (dir 0), negative = reverse (dir 1).
    let left_dir: u8 = if left >= 0.0 { 0 } else { 1 };
    let left_pwm: u8 = (left.abs() * 255.0) as u8;

    let right_dir: u8 = if right >= 0.0 { 0 } else { 1 };
    let right_pwm: u8 = (right.abs() * 255.0) as u8;

    MotorOutput {
        left_dir,
        left_pwm,
        right_dir,
        right_pwm,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_forward() {
        let m = compute_arcade_drive(0.0, 1.0);
        assert_eq!(m.left_dir, 0);
        assert_eq!(m.right_dir, 0);
        assert_eq!(m.left_pwm, 255);
        assert_eq!(m.right_pwm, 255);
    }

    #[test]
    fn full_reverse() {
        let m = compute_arcade_drive(0.0, -1.0);
        assert_eq!(m.left_dir, 1);
        assert_eq!(m.right_dir, 1);
        assert_eq!(m.left_pwm, 255);
        assert_eq!(m.right_pwm, 255);
    }

    #[test]
    fn turn_right() {
        let m = compute_arcade_drive(1.0, 0.0);
        // left forward, right reverse (pivot right)
        assert_eq!(m.left_dir, 0);
        assert_eq!(m.right_dir, 1);
        assert_eq!(m.left_pwm, 255);
        assert_eq!(m.right_pwm, 255);
    }

    #[test]
    fn neutral_is_zero() {
        let m = compute_arcade_drive(0.0, 0.0);
        assert_eq!(m.left_pwm, 0);
        assert_eq!(m.right_pwm, 0);
    }

    #[test]
    fn clamping_prevents_overflow() {
        // Both axes maxed should clamp to 1.0, not overflow
        let m = compute_arcade_drive(1.0, 1.0);
        assert_eq!(m.left_pwm, 255);
        // right = 1.0 - 1.0 = 0.0
        assert_eq!(m.right_pwm, 0);
    }
}
