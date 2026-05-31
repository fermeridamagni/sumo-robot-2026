import { useCallback, useEffect, useRef, useState } from "react";

// --- Types ---

export interface GamepadAxes {
  /** Horizontal axis of the left stick (-1.0 = full left, 1.0 = full right) */
  leftX: number;
  /** Vertical axis of the left stick (-1.0 = full up, 1.0 = full down) */
  leftY: number;
  /** Horizontal axis of the right stick */
  rightX: number;
  /** Vertical axis of the right stick */
  rightY: number;
}

export interface GamepadState {
  /** Current stick positions with deadzone applied */
  axes: GamepadAxes;
  /** Whether a gamepad is currently connected */
  connected: boolean;
  /** Human-readable identifier of the connected gamepad */
  id: string;
  /** High-resolution timestamp of the last gamepad reading */
  timestamp: number;
}

// --- Helpers ---

/**
 * Applies a deadzone to a raw axis value and rescales the remaining range.
 *
 * Without rescaling, there would be a hard jump from 0 to `deadzone` at the
 * boundary. By subtracting the deadzone and dividing by the remaining range,
 * the output smoothly transitions from 0 at the edge of the deadzone to ±1
 * at full deflection.
 */
const applyDeadzone = (value: number, deadzone: number): number => {
  if (Math.abs(value) < deadzone) {
    return 0;
  }

  const sign = Math.sign(value);
  return sign * ((Math.abs(value) - deadzone) / (1 - deadzone));
};

const DEFAULT_STATE: GamepadState = {
  connected: false,
  id: "",
  axes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
  timestamp: 0,
};

// --- Hook ---

/**
 * Polls the first connected gamepad at the display refresh rate (~60 Hz)
 * and returns its current stick positions with deadzone filtering.
 *
 * @param deadzone — axis values below this threshold snap to 0 (default 0.08)
 */
export const useGamepad = (deadzone = 0.08): GamepadState => {
  const [state, setState] = useState<GamepadState>(DEFAULT_STATE);

  // Mutable ref survives re-renders so we can cancel the rAF loop on cleanup.
  const rafIdRef = useRef<number>(0);

  /**
   * Reads axes from the first gamepad that uses "standard" mapping.
   * Called once per animation frame — kept stable via useCallback so the
   * rAF loop identity never changes and we avoid stale-closure issues.
   */
  const poll = useCallback(() => {
    const gamepads = navigator.getGamepads();

    // Find the first connected gamepad with standard mapping so we can
    // reliably read axes[0–3] as left-stick X/Y and right-stick X/Y.
    let activeGamepad: Gamepad | null = null;
    for (const gp of gamepads) {
      if (gp?.connected && gp.mapping === "standard") {
        activeGamepad = gp;
        break;
      }
    }

    if (activeGamepad) {
      setState({
        connected: true,
        id: activeGamepad.id,
        axes: {
          leftX: applyDeadzone(activeGamepad.axes[0] ?? 0, deadzone),
          leftY: applyDeadzone(activeGamepad.axes[1] ?? 0, deadzone),
          rightX: applyDeadzone(activeGamepad.axes[2] ?? 0, deadzone),
          rightY: applyDeadzone(activeGamepad.axes[3] ?? 0, deadzone),
        },
        timestamp: activeGamepad.timestamp,
      });
    } else {
      setState(DEFAULT_STATE);
    }

    // Continue the polling loop on the next display frame.
    rafIdRef.current = requestAnimationFrame(poll);
  }, [deadzone]);

  useEffect(() => {
    /**
     * Browser fires `gamepadconnected` only after the user interacts with
     * the controller for the first time (a security/fingerprinting measure).
     * We start the rAF polling loop on connect so we don't burn frames
     * when no gamepad is present.
     */
    const handleConnected = (_event: GamepadEvent): void => {
      // Kick off the polling loop (idempotent — cancelAnimationFrame(0)
      // is a no-op if no frame was scheduled).
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = requestAnimationFrame(poll);
    };

    const handleDisconnected = (_event: GamepadEvent): void => {
      cancelAnimationFrame(rafIdRef.current);
      setState(DEFAULT_STATE);
    };

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);

    // If a gamepad is already connected when the hook mounts (e.g. hot-reload),
    // start polling immediately so we don't wait for a re-plug event.
    const gamepads = navigator.getGamepads();
    for (const gp of gamepads) {
      if (gp?.connected) {
        rafIdRef.current = requestAnimationFrame(poll);
        break;
      }
    }

    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
      cancelAnimationFrame(rafIdRef.current);
    };
  }, [poll]);

  return state;
};
