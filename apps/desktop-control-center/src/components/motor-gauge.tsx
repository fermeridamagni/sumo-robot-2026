/**
 * Vertical bar gauge that visualizes PWM power output for a single motor.
 *
 * The gauge is bidirectional: the bar extends upward for forward motion
 * and downward for reverse. A subtle pulse animation activates at high
 * power (>200 PWM) to draw the operator's attention.
 */

interface MotorGaugeProps {
  /** Motor direction: 0 = forward, 1 = reverse */
  direction: number;
  /** Display label (e.g. "Left Motor", "Right Motor") */
  label: string;
  /** PWM duty cycle value from 0 to 255 */
  pwm: number;
}

const GAUGE_HEIGHT = 200;
const GAUGE_WIDTH = 40;
const HALF_HEIGHT = GAUGE_HEIGHT / 2;

export function MotorGauge({ label, pwm, direction }: MotorGaugeProps) {
  /* Normalize PWM to a 0..1 fraction for bar height calculation */
  const fraction = pwm / 255;
  const barHeight = fraction * HALF_HEIGHT;
  const isForward = direction === 0;
  const isHighPower = pwm > 200;

  /* Bar brightness scales with power: dim at low PWM, full white at max */
  const barOpacity = 0.2 + fraction * 0.8;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Motor label */}
      <span className="font-heading text-muted-foreground text-xs uppercase tracking-widest">
        {label}
      </span>

      <svg
        aria-label={`${label}: ${isForward ? "Forward" : "Reverse"} at PWM ${pwm}`}
        className="select-none"
        height={GAUGE_HEIGHT + 20}
        role="img"
        viewBox={`0 0 ${GAUGE_WIDTH + 40} ${GAUGE_HEIGHT + 20}`}
        width={GAUGE_WIDTH + 40}
      >
        {/* Background */}
        <rect
          fill="black"
          height={GAUGE_HEIGHT + 20}
          rx="8"
          width={GAUGE_WIDTH + 40}
        />

        {/* Gauge track (subtle outline) */}
        <rect
          fill="none"
          height={GAUGE_HEIGHT}
          rx="4"
          stroke="white"
          strokeOpacity={0.1}
          strokeWidth={1}
          width={GAUGE_WIDTH}
          x={20}
          y={10}
        />

        {/* Center line (zero point) */}
        <line
          stroke="white"
          strokeOpacity={0.25}
          strokeWidth={1}
          x1={16}
          x2={20 + GAUGE_WIDTH + 4}
          y1={10 + HALF_HEIGHT}
          y2={10 + HALF_HEIGHT}
        />

        {/* Graduation marks (every 25% of half) */}
        {[0.25, 0.5, 0.75, 1.0].map((tick) => {
          const yUp = 10 + HALF_HEIGHT - tick * HALF_HEIGHT;
          const yDown = 10 + HALF_HEIGHT + tick * HALF_HEIGHT;
          return (
            <g key={tick}>
              <line
                stroke="white"
                strokeOpacity={0.15}
                strokeWidth={0.5}
                x1={20 + GAUGE_WIDTH + 2}
                x2={20 + GAUGE_WIDTH + 6}
                y1={yUp}
                y2={yUp}
              />
              <line
                stroke="white"
                strokeOpacity={0.15}
                strokeWidth={0.5}
                x1={20 + GAUGE_WIDTH + 2}
                x2={20 + GAUGE_WIDTH + 6}
                y1={yDown}
                y2={yDown}
              />
            </g>
          );
        })}

        {/* Power bar — extends from center up (forward) or down (reverse) */}
        {pwm > 0 && (
          <rect
            className={isHighPower ? "animate-pulse-status" : ""}
            fill="white"
            fillOpacity={barOpacity}
            height={barHeight}
            rx="2"
            style={{ transition: "y 16ms linear, height 16ms linear" }}
            width={GAUGE_WIDTH - 4}
            x={22}
            y={isForward ? 10 + HALF_HEIGHT - barHeight : 10 + HALF_HEIGHT}
          />
        )}

        {/* Direction labels */}
        <text
          fill="white"
          fillOpacity={isForward && pwm > 0 ? 0.7 : 0.2}
          fontFamily="var(--font-mono)"
          fontSize={8}
          textAnchor="middle"
          x={20 + GAUGE_WIDTH / 2}
          y={18}
        >
          FWD
        </text>
        <text
          fill="white"
          fillOpacity={!isForward && pwm > 0 ? 0.7 : 0.2}
          fontFamily="var(--font-mono)"
          fontSize={8}
          textAnchor="middle"
          x={20 + GAUGE_WIDTH / 2}
          y={GAUGE_HEIGHT + 8}
        >
          REV
        </text>
      </svg>

      {/* Numeric PWM readout */}
      <div className="flex flex-col items-center font-telemetry text-xs">
        <span className="text-base text-foreground">
          {String(pwm).padStart(3, "0")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {isForward ? "FORWARD" : "REVERSE"}
        </span>
      </div>
    </div>
  );
}
