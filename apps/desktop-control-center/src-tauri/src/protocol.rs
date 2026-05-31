// Binary protocol encoding/decoding for Arduino ↔ Desktop communication.
//
// Two packet formats exist on the wire:
//
// **Command packet** (desktop → Arduino, 6 bytes):
//   [0xFF, left_dir, left_pwm, right_dir, right_pwm, xor_checksum]
//
// **Telemetry packet** (Arduino → desktop, 4 bytes):
//   [0xFE, sequence, uptime_lo, uptime_hi]
//
// The XOR checksum covers bytes 1‥4 of the command packet.
// All encode/decode functions are zero-allocation — they operate on
// fixed-size stack arrays only, which matters because `encode_command`
// sits on the 250Hz hot path.

use serde::Serialize;

/// Sync header byte that marks the start of a motor command packet.
/// The Arduino receiver scans for this byte to align on packet boundaries.
pub const HEADER: u8 = 0xFF;

/// Header byte for telemetry response packets sent back from the Arduino.
pub const TELEMETRY_HEADER: u8 = 0xFE;

/// Decomposed motor output: direction + PWM for each motor.
///
/// Direction encoding matches the Arduino firmware:
/// - `0` = forward
/// - `1` = reverse
///
/// PWM range is 0–255 (full 8-bit duty cycle).
#[derive(Serialize, Clone, Copy, Debug)]
pub struct MotorOutput {
    pub left_dir: u8,
    pub left_pwm: u8,
    pub right_dir: u8,
    pub right_pwm: u8,
}

impl Default for MotorOutput {
    fn default() -> Self {
        Self {
            left_dir: 0,
            left_pwm: 0,
            right_dir: 0,
            right_pwm: 0,
        }
    }
}

/// Encodes a `MotorOutput` into a 6-byte command packet ready for UDP
/// transmission. Returns a stack-allocated array — **zero heap allocation**.
///
/// # HOT PATH — called at 250Hz
///
/// # Packet layout
///
/// | Byte | Field       | Description                      |
/// |------|-------------|----------------------------------|
/// | 0    | `0xFF`      | Sync header for Arduino receiver |
/// | 1    | `left_dir`  | Left motor direction (0 or 1)    |
/// | 2    | `left_pwm`  | Left motor speed (0–255)         |
/// | 3    | `right_dir` | Right motor direction (0 or 1)   |
/// | 4    | `right_pwm` | Right motor speed (0–255)        |
/// | 5    | checksum    | XOR of bytes 1–4                 |
#[inline]
pub fn encode_command(output: &MotorOutput) -> [u8; 6] {
    let checksum = output.left_dir ^ output.left_pwm ^ output.right_dir ^ output.right_pwm;
    [
        HEADER,
        output.left_dir,
        output.left_pwm,
        output.right_dir,
        output.right_pwm,
        checksum,
    ]
}

/// Telemetry heartbeat sent back from the Arduino over UDP.
///
/// The Arduino increments `sequence` on each response so the desktop
/// can detect dropped packets. `uptime_ms` is the Arduino's `millis()`
/// value, useful for diagnosing firmware restarts.
#[derive(Serialize, Clone, Debug)]
pub struct TelemetryResponse {
    pub sequence: u8,
    pub uptime_ms: u16,
}

/// Attempts to decode a telemetry response from a raw byte buffer.
///
/// Returns `None` if the buffer is too short or the header byte doesn't
/// match `TELEMETRY_HEADER`. The uptime is encoded little-endian by the
/// Arduino (native AVR/ARM byte order).
pub fn decode_telemetry(buf: &[u8]) -> Option<TelemetryResponse> {
    if buf.len() < 4 {
        return None;
    }
    if buf[0] != TELEMETRY_HEADER {
        return None;
    }

    let sequence = buf[1];
    // Little-endian u16: low byte first, then high byte.
    let uptime_ms = u16::from_le_bytes([buf[2], buf[3]]);

    Some(TelemetryResponse {
        sequence,
        uptime_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_produces_correct_checksum() {
        let output = MotorOutput {
            left_dir: 0,
            left_pwm: 128,
            right_dir: 1,
            right_pwm: 64,
        };
        let packet = encode_command(&output);
        assert_eq!(packet[0], HEADER);
        assert_eq!(packet[5], 0 ^ 128 ^ 1 ^ 64);
    }

    #[test]
    fn decode_valid_telemetry() {
        let buf = [TELEMETRY_HEADER, 42, 0xE8, 0x03]; // uptime = 1000
        let resp = decode_telemetry(&buf).unwrap();
        assert_eq!(resp.sequence, 42);
        assert_eq!(resp.uptime_ms, 1000);
    }

    #[test]
    fn decode_rejects_wrong_header() {
        let buf = [0x00, 42, 0xE8, 0x03];
        assert!(decode_telemetry(&buf).is_none());
    }

    #[test]
    fn decode_rejects_short_buffer() {
        let buf = [TELEMETRY_HEADER, 42];
        assert!(decode_telemetry(&buf).is_none());
    }
}
