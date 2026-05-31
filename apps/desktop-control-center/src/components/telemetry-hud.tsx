/**
 * Head-Up Display overlay showing real-time telemetry statistics.
 *
 * All values are now driven by props from the Rust backend's Channel API,
 * making this component a pure display layer with no internal computation.
 * Uses tabular numeric formatting for stable column alignment at 250Hz.
 */

interface TelemetryHudProps {
  /** Whether a controller is connected (from Rust gilrs backend) */
  controllerConnected: boolean;
  /** Commands per second computed by the Rust control loop */
  cps?: number;
  /** Whether the UDP connection to the robot is active */
  isConnected: boolean;
  /** UDP round-trip latency in microseconds (from Rust backend) */
  latencyUs?: number;
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

/**
 * Formats microsecond latency into a human-readable string.
 * Values under 1000μs show as microseconds, above as milliseconds.
 */
const formatLatency = (us: number): string => {
  if (us < 1000) {
    return `${us}μs`;
  }
  return `${(us / 1000).toFixed(1)}ms`;
};

/** Derives the system status label from connection flags. */
const getStatusLabel = (
  isConnected: boolean,
  controllerConnected: boolean
): string => {
  if (isConnected && controllerConnected) {
    return "TRANSMITTING";
  }
  if (isConnected) {
    return "AWAITING GAMEPAD";
  }
  return "OFFLINE";
};

export function TelemetryHud({
  isConnected,
  controllerConnected,
  leftPwm,
  leftDir,
  rightPwm,
  rightDir,
  latencyUs,
  cps,
}: TelemetryHudProps) {
  /* Calculate the XOR checksum matching the Arduino receiver's validation.
   * Bitwise XOR is intentional here — this mirrors the binary protocol. */
  // biome-ignore lint/suspicious/noBitwiseOperators: XOR checksum is intentional binary protocol logic
  const checksum = leftDir ^ leftPwm ^ rightDir ^ rightPwm;

  const isActive = isConnected && controllerConnected;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <h2 className="font-heading font-semibold text-foreground text-sm uppercase tracking-wider">
        Telemetry
      </h2>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-2">
        {/* Commands per second — driven by Rust backend counter */}
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Cmd/s
          </span>
          <span className="font-telemetry text-foreground text-lg">
            {isActive ? (cps ?? "—") : "—"}
          </span>
        </div>

        {/* Latency — UDP round-trip in microseconds, amber above 5ms */}
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Latency
          </span>
          <span
            className={`font-telemetry text-lg ${
              isActive && latencyUs && latencyUs > 5000
                ? "text-amber-500"
                : "text-foreground"
            }`}
          >
            {isActive ? formatLatency(latencyUs ?? 0) : "—"}
          </span>
        </div>

        {/* Protocol indicator */}
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Protocol
          </span>
          <span className="font-telemetry text-foreground text-lg">
            {isConnected ? "UDP" : "—"}
          </span>
        </div>
      </div>

      {/* Packet visualization */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Last Packet
        </span>

        <div className="flex items-center gap-1 font-telemetry text-xs">
          {isActive ? (
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
        {isActive && (
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
            isActive
              ? "animate-pulse-status bg-foreground"
              : "bg-muted-foreground/30"
          }`}
        />
        <span className="text-muted-foreground text-xs">
          {getStatusLabel(isConnected, controllerConnected)}
        </span>
      </div>
    </div>
  );
}
