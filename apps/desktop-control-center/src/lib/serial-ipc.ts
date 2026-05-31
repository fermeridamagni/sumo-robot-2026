import { invoke } from "@tauri-apps/api/core";

/**
 * Retrieves the list of available serial ports filtered for macOS Bluetooth devices.
 *
 * The Rust backend scans `/dev/tty.*` entries and returns only those matching
 * known Bluetooth serial profiles, keeping the UI picker clean.
 */
export const listSerialPorts = (): Promise<string[]> =>
  invoke("list_serial_ports");

/**
 * Opens a serial connection to the specified port at 115200 baud.
 *
 * The baud rate is fixed to match the Arduino firmware's `Serial.begin(115200)`.
 * Only one connection can be active at a time — calling this while already
 * connected will return an error from the Rust side.
 */
export const connectSerial = (portName: string): Promise<void> =>
  invoke("connect_serial", { portName });

/**
 * Closes the current serial connection.
 *
 * Safe to call even if no connection is open — the Rust backend treats
 * a redundant disconnect as a no-op.
 */
export const disconnectSerial = (): Promise<void> =>
  invoke("disconnect_serial");

/**
 * Sends a motor command to the Arduino via the open serial port.
 *
 * This is the hot-path function called at 60 Hz from the rAF loop.
 * Data is sent as raw bytes (u8) to minimize IPC overhead — each parameter
 * maps directly to a byte in the serial frame.
 *
 * @param leftPwm  — Left motor PWM duty cycle (0–255)
 * @param leftDir  — Left motor direction (0 = forward, 1 = reverse)
 * @param rightPwm — Right motor PWM duty cycle (0–255)
 * @param rightDir — Right motor direction (0 = forward, 1 = reverse)
 */
export const sendMotorCommand = (
  leftPwm: number,
  leftDir: number,
  rightPwm: number,
  rightDir: number
): Promise<void> =>
  invoke("send_motor_command", { leftPwm, leftDir, rightPwm, rightDir });

/**
 * Returns whether a serial port connection is currently active.
 *
 * Used by the UI to reflect connection state (indicator dot, button labels)
 * without needing to maintain a separate client-side flag.
 */
export const getConnectionStatus = (): Promise<boolean> =>
  invoke("get_connection_status");
