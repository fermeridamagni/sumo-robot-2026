import React, { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ConnectionPanel } from "@/components/connection-panel";
import { JoystickVisualizer } from "@/components/joystick-visualizer";
import { MotorGauge } from "@/components/motor-gauge";
import { TelemetryHud } from "@/components/telemetry-hud";
import type { GamepadState, MotorOutput } from "@/lib/robot-ipc";
import { startControlLoop } from "@/lib/robot-ipc";
import "@/styles/globals.css";

/** Derives the top-bar status label from UDP and controller connection flags. */
const getSystemStatus = (
  udpConnected: boolean,
  controllerConnected: boolean
): string => {
  if (udpConnected && controllerConnected) {
    return "Live";
  }
  if (udpConnected) {
    return "Awaiting Input";
  }
  return "Offline";
};

/**
 * Main telemetry dashboard — displays data streamed from the Rust backend.
 *
 * The control loop (gamepad polling → Arcade Drive → UDP dispatch) runs
 * entirely in Rust at ~250Hz. This component subscribes to telemetry via
 * the Tauri Channel API and distributes state to child visualizers.
 * No control logic lives on the frontend — it's purely a display layer.
 */
function ControllerApp() {
  const [controlState, setControlState] = useState<{
    gamepad: GamepadState;
    motor: MotorOutput;
    packet: number[];
    cps: number;
  } | null>(null);
  const [robotTelemetry, setRobotTelemetry] = useState<{
    latency_us: number;
    arduino_uptime_ms: number;
  } | null>(null);
  const [udpConnected, setUdpConnected] = useState(false);
  const [controllerConnected, setControllerConnected] = useState(false);
  const [controllerName, setControllerName] = useState("");

  /**
   * Subscribe to telemetry when the UDP connection becomes active.
   *
   * The Channel stays open for the lifetime of the connection — the Rust
   * backend pushes messages at ~250Hz without the frontend polling.
   */
  useEffect(() => {
    if (!udpConnected) {
      return;
    }

    startControlLoop((payload) => {
      switch (payload.type) {
        case "ControlState":
          setControlState(payload);
          break;
        case "RobotTelemetry":
          setRobotTelemetry(payload);
          break;
        case "StatusChange":
          setControllerConnected(payload.controller_connected);
          setControllerName(payload.controller_name ?? "");
          break;
        default:
          break;
      }
    });
  }, [udpConnected]);

  const handleConnectionChange = useCallback((connected: boolean) => {
    setUdpConnected(connected);

    /* Reset telemetry state on disconnect so stale data doesn't linger */
    if (!connected) {
      setControlState(null);
      setRobotTelemetry(null);
    }
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
            Sumo Control Center
          </span>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
          <div
            className={`size-2 rounded-full ${
              udpConnected && controllerConnected
                ? "animate-pulse-status bg-foreground"
                : "bg-muted-foreground/30"
            }`}
          />
          <span className="font-telemetry text-[10px] text-muted-foreground uppercase">
            {getSystemStatus(udpConnected, controllerConnected)}
          </span>
        </div>
      </header>

      {/* Main dashboard grid */}
      <div className="grid flex-1 grid-cols-[280px_1fr_280px] gap-6">
        {/* Left sidebar — Connection & Telemetry */}
        <aside className="flex flex-col gap-4">
          <ConnectionPanel
            controllerConnected={controllerConnected}
            controllerName={controllerName}
            onConnectionChange={handleConnectionChange}
          />

          <TelemetryHud
            controllerConnected={controllerConnected}
            cps={controlState?.cps}
            isConnected={udpConnected}
            latencyUs={robotTelemetry?.latency_us}
            leftDir={controlState?.motor.leftDir ?? 0}
            leftPwm={controlState?.motor.leftPwm ?? 0}
            rightDir={controlState?.motor.rightDir ?? 0}
            rightPwm={controlState?.motor.rightPwm ?? 0}
          />
        </aside>

        {/* Center — Joystick & Motor Visualization */}
        <section className="flex flex-col items-center justify-center gap-8">
          {/* Joystick visualizers row */}
          <div className="flex gap-12">
            <JoystickVisualizer
              label="Left Stick"
              motorOutput={
                controlState?.motor ?? {
                  leftPwm: 0,
                  leftDir: 0,
                  rightPwm: 0,
                  rightDir: 0,
                }
              }
              x={controlState?.gamepad.leftX ?? 0}
              y={controlState?.gamepad.leftY ?? 0}
            />

            <JoystickVisualizer
              label="Right Stick"
              x={controlState?.gamepad.rightX ?? 0}
              y={controlState?.gamepad.rightY ?? 0}
            />
          </div>

          {/* Motor gauges row */}
          <div className="flex items-center gap-16">
            <MotorGauge
              direction={controlState?.motor.leftDir ?? 0}
              label="Left Motor"
              pwm={controlState?.motor.leftPwm ?? 0}
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
              direction={controlState?.motor.rightDir ?? 0}
              label="Right Motor"
              pwm={controlState?.motor.rightPwm ?? 0}
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
