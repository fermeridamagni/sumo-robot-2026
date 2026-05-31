import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { ConnectionPanel } from "@/components/connection-panel";
import { JoystickVisualizer } from "@/components/joystick-visualizer";
import { MotorGauge } from "@/components/motor-gauge";
import { TelemetryHud } from "@/components/telemetry-hud";
import { useGamepad } from "@/hooks/use-gamepad";
import type { MotorOutput } from "@/lib/arcade-drive";
import { computeArcadeDrive } from "@/lib/arcade-drive";
import { sendMotorCommand } from "@/lib/serial-ipc";
import "@/styles/globals.css";

/** Derives the top-bar status label from serial and gamepad connection flags. */
const getSystemStatus = (
  serialConnected: boolean,
  gamepadConnected: boolean
): string => {
  if (serialConnected && gamepadConnected) {
    return "Live";
  }
  if (serialConnected) {
    return "Awaiting Input";
  }
  return "Offline";
};

/**
 * Main controller application — composes the full telemetry dashboard.
 *
 * This component integrates the Gamepad API polling loop, Arcade Drive
 * computation, and serial IPC dispatch into a single 60Hz control loop.
 * Motor commands are sent to the Rust backend on every animation frame
 * when both a gamepad and serial connection are active.
 */
function ControllerApp() {
  const gamepad = useGamepad(0.08);
  const [motorOutput, setMotorOutput] = useState<MotorOutput>({
    leftPwm: 0,
    leftDir: 0,
    rightPwm: 0,
    rightDir: 0,
  });
  const [serialConnected, setSerialConnected] = useState(false);
  const [latency, setLatency] = useState(0);
  const lastLatencyUpdateRef = useRef(0);

  /**
   * Track whether we should be sending commands.
   * Uses a ref to avoid re-creating the rAF callback when connection
   * state changes — the callback reads the ref instead.
   */
  const serialConnectedRef = useRef(false);
  useEffect(() => {
    serialConnectedRef.current = serialConnected;
  }, [serialConnected]);

  /**
   * Core control loop: compute Arcade Drive output and dispatch to backend.
   *
   * This runs in sync with the gamepad polling (via useGamepad's rAF loop)
   * but we also react to axis changes here. The useGamepad hook updates
   * state each frame, which triggers this effect and keeps the motor
   * output in sync.
   */
  useEffect(() => {
    const output = computeArcadeDrive(gamepad.axes.leftX, gamepad.axes.leftY);
    setMotorOutput(output);

    /* Only send commands when both gamepad and serial are active */
    if (gamepad.connected && serialConnectedRef.current) {
      /*
       * Fire-and-forget: we intentionally don't await the IPC call.
       * At 60Hz, waiting for each response would halve throughput.
       * Errors are silently ignored — a dropped frame is acceptable
       * for a real-time control loop.
       */
      const start = performance.now();
      sendMotorCommand(
        output.leftPwm,
        output.leftDir,
        output.rightPwm,
        output.rightDir
      ).then(() => {
        const currentLatency = performance.now() - start;
        const now = performance.now();
        if (now - lastLatencyUpdateRef.current >= 500) {
          setLatency(Math.round(currentLatency));
          lastLatencyUpdateRef.current = now;
        }
      });
    }
  }, [gamepad.axes.leftX, gamepad.axes.leftY, gamepad.connected]);

  const handleConnectionChange = useCallback((connected: boolean) => {
    setSerialConnected(connected);
  }, []);

  return (
    <main className="flex h-screen w-screen flex-col bg-background p-6">
      {/* Top bar — Branding */}
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-bold font-heading text-foreground text-xl uppercase tracking-[0.2em]">
            Magni
          </h1>
          <div className="h-4 w-px bg-border" />
          <span className="font-heading text-muted-foreground text-xs uppercase tracking-widest">
            Sumo Controller
          </span>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
          <div
            className={`size-2 rounded-full ${
              serialConnected && gamepad.connected
                ? "animate-pulse-status bg-foreground"
                : "bg-muted-foreground/30"
            }`}
          />
          <span className="font-telemetry text-[10px] text-muted-foreground uppercase">
            {getSystemStatus(serialConnected, gamepad.connected)}
          </span>
        </div>
      </header>

      {/* Main dashboard grid */}
      <div className="grid flex-1 grid-cols-[280px_1fr_280px] gap-6">
        {/* Left sidebar — Connection & Telemetry */}
        <aside className="flex flex-col gap-4">
          <ConnectionPanel
            gamepadConnected={gamepad.connected}
            gamepadId={gamepad.id}
            onConnectionChange={handleConnectionChange}
          />

          <TelemetryHud
            gamepadConnected={gamepad.connected}
            isConnected={serialConnected}
            latencyMs={latency}
            leftDir={motorOutput.leftDir}
            leftPwm={motorOutput.leftPwm}
            rightDir={motorOutput.rightDir}
            rightPwm={motorOutput.rightPwm}
          />
        </aside>

        {/* Center — Joystick & Motor Visualization */}
        <section className="flex flex-col items-center justify-center gap-8">
          {/* Joystick visualizers row */}
          <div className="flex gap-12">
            <JoystickVisualizer
              label="Left Stick"
              motorOutput={motorOutput}
              x={gamepad.axes.leftX}
              y={gamepad.axes.leftY}
            />

            <JoystickVisualizer
              label="Right Stick"
              x={gamepad.axes.rightX}
              y={gamepad.axes.rightY}
            />
          </div>

          {/* Motor gauges row */}
          <div className="flex items-center gap-16">
            <MotorGauge
              direction={motorOutput.leftDir}
              label="Left Motor"
              pwm={motorOutput.leftPwm}
            />

            {/* Center divider with robot icon */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex size-16 items-center justify-center rounded-xl border border-border bg-card">
                <svg
                  aria-hidden="true"
                  className="text-foreground"
                  fill="none"
                  height="32"
                  viewBox="0 0 32 32"
                  width="32"
                >
                  <title>Robot icon</title>
                  {/* Simple robot silhouette */}
                  <rect
                    height="14"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    width="16"
                    x="8"
                    y="10"
                  />
                  <rect
                    height="4"
                    rx="1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    width="8"
                    x="12"
                    y="6"
                  />
                  <circle cx="12" cy="17" fill="currentColor" r="2" />
                  <circle cx="20" cy="17" fill="currentColor" r="2" />
                  <rect
                    height="6"
                    rx="1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    width="4"
                    x="4"
                    y="14"
                  />
                  <rect
                    height="6"
                    rx="1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    width="4"
                    x="24"
                    y="14"
                  />
                  <rect
                    fill="currentColor"
                    height="3"
                    rx="1"
                    width="4"
                    x="10"
                    y="24"
                  />
                  <rect
                    fill="currentColor"
                    height="3"
                    rx="1"
                    width="4"
                    x="18"
                    y="24"
                  />
                </svg>
              </div>
              <span className="font-telemetry text-[8px] text-muted-foreground uppercase tracking-widest">
                Sumo Bot
              </span>
            </div>

            <MotorGauge
              direction={motorOutput.rightDir}
              label="Right Motor"
              pwm={motorOutput.rightPwm}
            />
          </div>
        </section>

        {/* Right sidebar — Instructions */}
        <aside className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
            <h2 className="font-heading font-semibold text-foreground text-sm uppercase tracking-wider">
              Controls
            </h2>
            <div className="flex flex-col gap-2 text-muted-foreground text-xs">
              <div className="flex items-start gap-2">
                <span className="font-telemetry text-foreground">L↕</span>
                <span>Throttle (forward / reverse)</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-telemetry text-foreground">L↔</span>
                <span>Steering (left / right)</span>
              </div>
              <div className="mt-2 border-border border-t pt-2 text-[10px] text-muted-foreground/60">
                Left stick controls both motors via Arcade Drive mixing. Push
                forward for both motors forward, push left to reduce left motor
                power and turn.
              </div>
            </div>
          </div>

          {/* Drive mode indicator */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <h2 className="font-heading font-semibold text-foreground text-sm uppercase tracking-wider">
              Drive Mode
            </h2>
            <div className="flex items-center gap-2">
              <div className="aspect-square size-2 rounded-full bg-foreground" />
              <span className="font-telemetry text-foreground text-xs">
                Arcade Drive
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              Single-stick differential control. Y-axis = throttle, X-axis =
              steering. Deadzone: 8%.
            </p>
          </div>

          {/* Magni branding footer */}
          <div className="mt-auto flex items-center justify-center pt-4">
            <span className="font-heading text-[10px] text-muted-foreground/30 uppercase tracking-[0.3em]">
              Magni Development
            </span>
          </div>
        </aside>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ControllerApp />
  </React.StrictMode>
);
