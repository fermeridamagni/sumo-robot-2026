import { Channel, invoke } from "@tauri-apps/api/core";

// --- Types ---

/** Motor command output matching the Rust backend's MotorOutput struct. */
export interface MotorOutput {
  /** Direction for the left motor: 0 = forward, 1 = reverse */
  leftDir: number;
  /** PWM duty cycle for the left motor (0–255) */
  leftPwm: number;
  /** Direction for the right motor: 0 = forward, 1 = reverse */
  rightDir: number;
  /** PWM duty cycle for the right motor (0–255) */
  rightPwm: number;
}

/** Gamepad stick positions and connection state from the Rust gilrs backend. */
export interface GamepadState {
  /** Whether a gamepad is currently connected */
  connected: boolean;
  /** Horizontal axis of the left stick (-1.0 to 1.0) */
  leftX: number;
  /** Vertical axis of the left stick (-1.0 to 1.0) */
  leftY: number;
  /** Human-readable name of the connected gamepad */
  name: string;
  /** Horizontal axis of the right stick (-1.0 to 1.0) */
  rightX: number;
  /** Vertical axis of the right stick (-1.0 to 1.0) */
  rightY: number;
}

/** Identifies a gamepad controller discovered by the Rust backend. */
export interface ControllerInfo {
  /** Unique identifier for the controller */
  id: string;
  /** Human-readable controller name */
  name: string;
}

/** Current connection status returned by `get_status`. */
export interface StatusInfo {
  /** Whether the UDP connection to the robot is active */
  connected: boolean;
  /** The IP:port target, or null if not connected */
  target: string | null;
}

/**
 * Discriminated union of telemetry messages streamed from the Rust backend
 * via the Tauri Channel API at ~250Hz.
 *
 * - `ControlState`: Gamepad inputs, computed motor output, and raw packet bytes.
 * - `RobotTelemetry`: Round-trip UDP latency and Arduino uptime.
 * - `StatusChange`: Connection or controller state transitions.
 */
export type TelemetryPayload =
  | {
      type: "ControlState";
      gamepad: GamepadState;
      motor: MotorOutput;
      packet: number[];
      cps: number;
    }
  | {
      type: "RobotTelemetry";
      latency_us: number;
      arduino_uptime_ms: number;
    }
  | {
      type: "StatusChange";
      connected: boolean;
      controller_connected: boolean;
      controller_name: string | null;
    };

// --- IPC Functions ---

/**
 * Initiates a WiFi UDP connection to the robot at the given IP and port.
 *
 * The Rust backend binds a UDP socket and starts sending motor commands
 * to the Arduino's WiFi AP. Only one connection can be active at a time.
 *
 * @param ip   — Target IP address (default: 192.168.4.1)
 * @param port — Target UDP port (default: 4210)
 */
export const connectRobot = (ip: string, port: number): Promise<void> =>
  invoke("connect", { ip, port });

/**
 * Closes the active UDP connection to the robot.
 *
 * Safe to call even when no connection is open — the Rust backend
 * treats a redundant disconnect as a no-op.
 */
export const disconnectRobot = (): Promise<void> => invoke("disconnect");

/**
 * Queries the current UDP connection status from the Rust backend.
 *
 * Returns whether the socket is bound and the target address string,
 * used by the UI to reflect connection state without client-side tracking.
 */
export const getStatus = (): Promise<StatusInfo> => invoke("get_status");

/**
 * Lists all gamepad controllers currently detected by the Rust gilrs backend.
 *
 * Unlike the Browser Gamepad API, gilrs has access to the full system HID
 * layer, so controllers are visible even without a prior user interaction.
 */
export const listControllers = (): Promise<ControllerInfo[]> =>
  invoke("list_controllers");

/**
 * Starts the Rust-side control loop and streams telemetry to the frontend.
 *
 * Creates a Tauri Channel that receives `TelemetryPayload` messages at ~250Hz.
 * The Rust backend handles gamepad polling, Arcade Drive computation, and
 * UDP command dispatch — the frontend is purely a display layer.
 *
 * @param onTelemetry — Callback invoked for each telemetry message
 */
export const startControlLoop = (
  onTelemetry: (payload: TelemetryPayload) => void
): Promise<void> => {
  const channel = new Channel<TelemetryPayload>();
  channel.onmessage = onTelemetry;
  return invoke("start_control_loop", { channel });
};
