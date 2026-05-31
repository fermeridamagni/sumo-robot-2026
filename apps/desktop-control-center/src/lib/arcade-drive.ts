// --- Types ---

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

// --- Helpers ---

/** Clamps a value to the [-1, 1] range. */
const clamp = (value: number): number => Math.max(-1, Math.min(1, value));

/**
 * Decomposes a signed motor value into a direction flag and unsigned PWM byte.
 *
 * The Arduino motor driver expects a direction pin (LOW/HIGH) and a PWM duty
 * cycle (0–255). This function converts the -1..1 float into that format.
 */
const toMotorComponents = (value: number): { pwm: number; dir: number } => ({
  pwm: Math.round(Math.abs(value) * 255),
  dir: value < 0 ? 1 : 0,
});

// --- Public API ---

/**
 * Computes Arcade Drive output from joystick axes.
 *
 * Arcade Drive uses a single joystick to control a differential-drive robot:
 * - Y-axis (throttle): Controls forward/reverse speed for both motors
 * - X-axis (steering): Reduces power on one side to turn
 *
 * The Gamepad API reports Y-axis as negative-up, so we negate it:
 * - Pushing stick UP → negative Y → we want FORWARD
 *
 * Mixing formula:
 *   left  = -Y + X  (throttle + turn)
 *   right = -Y - X  (throttle - turn)
 *
 * Results are clamped to [-1, 1], then decomposed into:
 * - direction (sign → 0 = forward, 1 = reverse)
 * - magnitude (|value| × 255 → PWM duty cycle)
 */
export const computeArcadeDrive = (x: number, y: number): MotorOutput => {
  // Negate Y because the Gamepad API uses an inverted Y-axis (up is negative).
  const throttle = -y;
  const steering = x;

  const leftRaw = clamp(throttle + steering);
  const rightRaw = clamp(throttle - steering);

  const left = toMotorComponents(leftRaw);
  const right = toMotorComponents(rightRaw);

  return {
    leftPwm: left.pwm,
    leftDir: left.dir,
    rightPwm: right.pwm,
    rightDir: right.dir,
  };
};
