import { Button } from "@ui/button";
import { JoystickIcon, Plug, Unplug, Wifi, WifiOff } from "lucide-react";
import { useCallback, useState } from "react";
import { connectRobot, disconnectRobot, getStatus } from "@/lib/robot-ipc";

/**
 * WiFi UDP connection management panel.
 *
 * Provides IP address and port inputs for the robot's WiFi AP,
 * connect/disconnect controls, and live status indicators for both
 * the UDP connection and the gamepad (reported by the Rust backend).
 */

interface ConnectionPanelProps {
  /** Whether a controller is detected by the Rust gilrs backend */
  controllerConnected: boolean;
  /** Name of the connected controller (empty if none) */
  controllerName: string;
  /** Callback invoked when UDP connection state changes */
  onConnectionChange?: (connected: boolean) => void;
}

export function ConnectionPanel({
  controllerConnected,
  controllerName,
  onConnectionChange,
}: ConnectionPanelProps) {
  const [ip, setIp] = useState("192.168.4.1");
  const [port, setPort] = useState(4210);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  /** Connect to the robot over WiFi UDP. */
  const handleConnect = useCallback(async () => {
    setIsLoading(true);
    try {
      await connectRobot(ip, port);
      setIsConnected(true);
      onConnectionChange?.(true);
    } catch {
      setIsConnected(false);
      onConnectionChange?.(false);
    } finally {
      setIsLoading(false);
    }
  }, [ip, port, onConnectionChange]);

  /** Disconnect from the robot and verify backend state. */
  const handleDisconnect = useCallback(async () => {
    setIsLoading(true);
    try {
      await disconnectRobot();
      setIsConnected(false);
      onConnectionChange?.(false);
    } catch {
      /* Disconnect failed — re-check backend status */
      try {
        const status = await getStatus();
        setIsConnected(status.connected);
      } catch {
        /* Swallow — UI will show stale state until next poll */
      }
    } finally {
      setIsLoading(false);
    }
  }, [onConnectionChange]);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="font-heading font-semibold text-foreground text-sm uppercase tracking-wider">
          Connection
        </h2>
      </div>

      {/* IP Address Input */}
      <div className="flex flex-col gap-2">
        <label
          className="text-muted-foreground text-xs uppercase tracking-wider"
          htmlFor="robot-ip"
        >
          Robot IP
        </label>
        <input
          className="h-8 w-full rounded-lg border border-border bg-muted px-3 font-telemetry text-foreground text-xs placeholder:text-muted-foreground/50 disabled:opacity-50"
          disabled={isConnected}
          id="robot-ip"
          onChange={(e) => setIp(e.target.value)}
          placeholder="192.168.4.1"
          type="text"
          value={ip}
        />
      </div>

      {/* Port Input */}
      <div className="flex flex-col gap-2">
        <label
          className="text-muted-foreground text-xs uppercase tracking-wider"
          htmlFor="robot-port"
        >
          UDP Port
        </label>
        <input
          className="h-8 w-full rounded-lg border border-border bg-muted px-3 font-telemetry text-foreground text-xs placeholder:text-muted-foreground/50 disabled:opacity-50"
          disabled={isConnected}
          id="robot-port"
          max={65_535}
          min={1}
          onChange={(e) => setPort(Number(e.target.value))}
          placeholder="4210"
          type="number"
          value={port}
        />
      </div>

      {/* Connect / Disconnect */}
      <Button
        disabled={isLoading || !(isConnected || ip)}
        onClick={isConnected ? handleDisconnect : handleConnect}
        size="default"
        variant={isConnected ? "outline" : "default"}
      >
        {isConnected ? (
          <>
            <Unplug className="size-3.5" />
            Disconnect
          </>
        ) : (
          <>
            <Plug className="size-3.5" />
            {isLoading ? "Connecting..." : "Connect"}
          </>
        )}
      </Button>

      {/* Status Indicators */}
      <div className="flex flex-col gap-2 border-border border-t pt-3">
        {/* WiFi status */}
        <div className="flex items-center gap-2">
          <div
            className={`aspect-square size-2 rounded-full ${
              isConnected
                ? "animate-pulse-status bg-foreground"
                : "bg-muted-foreground/30"
            }`}
          />
          {isConnected ? (
            <Wifi className="size-3 text-foreground" />
          ) : (
            <WifiOff className="size-3 text-muted-foreground" />
          )}
          <span className="text-muted-foreground text-xs">
            {isConnected ? "UDP Connected" : "UDP Disconnected"}
          </span>
        </div>

        {/* Controller status */}
        <div className="flex items-center gap-2">
          <div
            className={`aspect-square size-2 rounded-full ${
              controllerConnected
                ? "animate-pulse-status bg-foreground"
                : "bg-muted-foreground/30"
            }`}
          />

          <JoystickIcon className="size-5 text-muted-foreground" />

          <span className="text-muted-foreground text-xs">
            {controllerConnected
              ? `Gamepad: ${controllerName}`
              : "No Gamepad Detected"}
          </span>
        </div>
      </div>
    </div>
  );
}
