import type { MotorOutput } from "@/lib/arcade-drive";

/**
 * SVG-based joystick position visualizer.
 *
 * Renders a circular boundary with crosshair guides and a dot that
 * tracks the actual joystick position in real-time. The deadzone is
 * visualized as a dimmed inner circle so the operator knows when
 * input actually registers.
 */

interface JoystickVisualizerProps {
  /** Deadzone radius as a fraction of 1.0 (default 0.08) */
  deadzone?: number;
  /** Label displayed above the visualizer (e.g. "Left Stick") */
  label: string;
  /** Optional computed motor output to display below the visualizer */
  motorOutput?: MotorOutput;
  /** Current X-axis value from -1.0 to 1.0 */
  x: number;
  /** Current Y-axis value from -1.0 to 1.0 */
  y: number;
}

const SIZE = 180;
const CENTER = SIZE / 2;
const RADIUS = 72;
const DOT_RADIUS = 7;

export function JoystickVisualizer({
  label,
  x,
  y,
  deadzone = 0.08,
  motorOutput,
}: JoystickVisualizerProps) {
  /* Map joystick float coords (-1..1) to SVG pixel coords */
  const dotX = CENTER + x * RADIUS;
  const dotY = CENTER + y * RADIUS;
  const deadzonePixels = deadzone * RADIUS;

  /* Dot opacity increases with displacement for visual feedback */
  const displacement = Math.min(1, Math.sqrt(x * x + y * y));
  const dotOpacity = 0.4 + displacement * 0.6;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Stick label */}
      <span className="font-heading text-muted-foreground text-xs uppercase tracking-widest">
        {label}
      </span>

      <svg
        aria-label={`${label} position: X ${x.toFixed(2)}, Y ${y.toFixed(2)}`}
        className="select-none"
        height={SIZE}
        role="img"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
      >
        {/* Background fill — pure black for OLED */}
        <rect fill="black" height={SIZE} rx="12" width={SIZE} />

        {/* Outer boundary circle */}
        <circle
          cx={CENTER}
          cy={CENTER}
          fill="none"
          r={RADIUS}
          stroke="white"
          strokeOpacity={0.15}
          strokeWidth={1}
        />

        {/* Deadzone circle */}
        <circle
          cx={CENTER}
          cy={CENTER}
          fill="white"
          fillOpacity={0.04}
          r={deadzonePixels}
          stroke="white"
          strokeDasharray="2 2"
          strokeOpacity={0.1}
          strokeWidth={0.5}
        />

        {/* Crosshair guides */}
        <line
          stroke="white"
          strokeOpacity={0.08}
          strokeWidth={0.5}
          x1={CENTER - RADIUS}
          x2={CENTER + RADIUS}
          y1={CENTER}
          y2={CENTER}
        />
        <line
          stroke="white"
          strokeOpacity={0.08}
          strokeWidth={0.5}
          x1={CENTER}
          x2={CENTER}
          y1={CENTER - RADIUS}
          y2={CENTER + RADIUS}
        />

        {/* Axis trail lines (from center to dot) */}
        {displacement > 0.01 && (
          <line
            stroke="white"
            strokeOpacity={0.15}
            strokeWidth={1}
            x1={CENTER}
            x2={dotX}
            y1={CENTER}
            y2={dotY}
          />
        )}

        {/* Position dot */}
        <circle
          cx={dotX}
          cy={dotY}
          fill="white"
          fillOpacity={dotOpacity}
          r={DOT_RADIUS}
          stroke="white"
          strokeOpacity={0.8}
          strokeWidth={1.5}
          style={{
            transition: "cx 16ms linear, cy 16ms linear",
          }}
        />

        {/* Center reference dot */}
        <circle cx={CENTER} cy={CENTER} fill="white" fillOpacity={0.3} r={2} />
      </svg>

      {/* Numeric readout */}
      <div className="flex gap-4 font-telemetry text-muted-foreground text-xs">
        <span>
          X <span className="text-foreground">{x.toFixed(2)}</span>
        </span>
        <span>
          Y <span className="text-foreground">{y.toFixed(2)}</span>
        </span>
      </div>

      {/* Motor output display (if provided) */}
      {motorOutput && (
        <div className="mt-1 flex gap-3 font-telemetry text-[10px] text-muted-foreground">
          <span>
            L:{" "}
            <span className="text-foreground">
              {motorOutput.leftDir === 0 ? "FWD" : "REV"}{" "}
              {String(motorOutput.leftPwm).padStart(3, "0")}
            </span>
          </span>
          <span>
            R:{" "}
            <span className="text-foreground">
              {motorOutput.rightDir === 0 ? "FWD" : "REV"}{" "}
              {String(motorOutput.rightPwm).padStart(3, "0")}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
