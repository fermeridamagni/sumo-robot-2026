import { useEffect, useRef, useState } from "react";

/**
 * Head-Up Display overlay showing real-time telemetry statistics.
 *
 * Displays commands per second (CPS), the raw hex bytes of the last
 * packet sent, and a running frame counter. All values use tabular
 * numeric formatting for stable column alignment at 60Hz refresh.
 */

interface TelemetryHudProps {
  /** Whether the gamepad is connected */
  gamepadConnected: boolean;
  /** Whether the serial connection is active */
  isConnected: boolean;
  /** Round-trip latency of the motor command IPC (ms) */
  latencyMs?: number;
  /** Direction for left motor (0=fwd, 1=rev) */
  leftDir: number;
  /** PWM value for left motor (0-255) */
  leftPwm: number;
  /** Direction for right motor (0=fwd, 1=rev) */
  rightDir: number;
  /** PWM value for right motor (0-255) */
  rightPwm: number;
}

/**
 * Formats a number as a two-character uppercase hex string.
 * Used to display raw packet bytes in the telemetry overlay.
 */
const toHex = (n: number): string =>
  n.toString(16).toUpperCase().padStart(2, "0");

/** Derives the system status label from connection flags. */
const getStatusLabel = (
  isConnected: boolean,
  gamepadConnected: boolean
): string => {
  if (isConnected && gamepadConnected) {
    return "TRANSMITTING";
  }
  if (isConnected) {
    return "AWAITING GAMEPAD";
  }
  return "OFFLINE";
};

export function TelemetryHud({
  isConnected,
  gamepadConnected,
  leftPwm,
  leftDir,
  rightPwm,
  rightDir,
  latencyMs,
}: TelemetryHudProps) {
  const [cps, setCps] = useState(0);
  const frameCountRef = useRef(0);
  const lastResetRef = useRef(Date.now());

  /* Calculate the XOR checksum matching the Rust backend packet format.
   * Bitwise XOR is intentional here — this mirrors the Arduino receiver's
   * checksum validation logic exactly. */
  // biome-ignore lint/suspicious/noBitwiseOperators: XOR checksum is intentional binary protocol logic
  const checksum = leftDir ^ leftPwm ^ rightDir ^ rightPwm;

  /* Count commands per second using a 1-second sliding window */
  useEffect(() => {
    if (!(isConnected && gamepadConnected)) {
      setCps(0);
      frameCountRef.current = 0;
      return;
    }

    frameCountRef.current += 1;

    const now = Date.now();
    const elapsed = now - lastResetRef.current;

    if (elapsed >= 1000) {
      setCps(Math.round((frameCountRef.current / elapsed) * 1000));
      frameCountRef.current = 0;
      lastResetRef.current = now;
    }
  }, [isConnected, gamepadConnected]);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <h2 className="font-heading font-semibold text-foreground text-sm uppercase tracking-wider">
        Telemetry
      </h2>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-2">
        {/* Commands per second */}
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Cmd/s
          </span>
          <span className="font-telemetry text-foreground text-lg">
            {isConnected && gamepadConnected ? cps : "—"}
          </span>
        </div>

        {/* Latency */}
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Latency
          </span>
          <span
            className={`font-telemetry text-lg ${
              isConnected && gamepadConnected && latencyMs && latencyMs > 20
                ? "text-amber-500"
                : "text-foreground"
            }`}
          >
            {isConnected && gamepadConnected ? `${latencyMs ?? 0}ms` : "—"}
          </span>
        </div>

        {/* Connection mode */}
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Protocol
          </span>
          <span className="font-telemetry text-foreground text-lg">
            {isConnected ? "115.2k" : "—"}
          </span>
        </div>
      </div>

      {/* Packet visualization */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Last Packet
        </span>

        <div className="flex items-center gap-1 font-telemetry text-xs">
          {isConnected && gamepadConnected ? (
            <>
              {/* Header byte */}
              <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                {toHex(0xff)}
              </span>
              {/* Left direction */}
              <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                {toHex(leftDir)}
              </span>
              {/* Left PWM */}
              <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                {toHex(leftPwm)}
              </span>
              {/* Right direction */}
              <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                {toHex(rightDir)}
              </span>
              {/* Right PWM */}
              <span className="rounded bg-muted px-1.5 py-0.5 text-foreground">
                {toHex(rightPwm)}
              </span>
              {/* Checksum */}
              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                {toHex(checksum)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground/50">No data</span>
          )}
        </div>

        {/* Packet field labels */}
        {isConnected && gamepadConnected && (
          <div className="flex items-center gap-1 text-[8px] text-muted-foreground/50">
            <span className="w-7.5 text-center">HDR</span>
            <span className="w-7.5 text-center">LDIR</span>
            <span className="w-7.5 text-center">LPWM</span>
            <span className="w-7.5 text-center">RDIR</span>
            <span className="w-7.5 text-center">RPWM</span>
            <span className="w-7.5 text-center">CHK</span>
          </div>
        )}
      </div>

      {/* System status footer */}
      <div className="flex items-center gap-2 border-border border-t pt-2">
        <div
          className={`aspect-square size-1.5 rounded-full ${
            isConnected && gamepadConnected
              ? "animate-pulse-status bg-foreground"
              : "bg-muted-foreground/30"
          }`}
        />
        <span className="text-muted-foreground text-xs">
          {getStatusLabel(isConnected, gamepadConnected)}
        </span>
      </div>
    </div>
  );
}
