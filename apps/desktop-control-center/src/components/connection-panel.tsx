import { Button } from "@ui/button";
import {
  Bluetooth,
  BluetoothOff,
  ChevronDown,
  JoystickIcon,
  Plug,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectSerial,
  disconnectSerial,
  getConnectionStatus,
  listSerialPorts,
} from "@/lib/serial-ipc";

/**
 * Serial port connection management panel.
 *
 * Provides a dropdown to select from available serial ports (auto-refreshed),
 * connect/disconnect controls, and live status indicators for both the
 * serial connection and gamepad detection.
 */

interface ConnectionPanelProps {
  /** Whether a gamepad is currently detected by the Gamepad API */
  gamepadConnected: boolean;
  /** Name/ID of the connected gamepad (empty if none) */
  gamepadId: string;
  /** Callback invoked when serial connection state changes */
  onConnectionChange?: (connected: boolean) => void;
}

export function ConnectionPanel({
  gamepadConnected,
  gamepadId,
  onConnectionChange,
}: ConnectionPanelProps) {
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /** Refresh the list of available serial ports from the Rust backend. */
  const refreshPorts = useCallback(async () => {
    try {
      const available = await listSerialPorts();
      setPorts(available);

      /* Auto-select the first port if none is selected */
      if (available.length > 0 && !selectedPort) {
        setSelectedPort(available[0]);
      }
    } catch {
      setPorts([]);
    }
  }, [selectedPort]);

  /** Poll connection status periodically to stay in sync with backend. */
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const status = await getConnectionStatus();
        setIsConnected(status);
      } catch {
        setIsConnected(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  /** Refresh ports on mount */
  useEffect(() => {
    refreshPorts();
  }, [refreshPorts]);

  /** Close dropdown when clicking outside */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleConnect = async () => {
    if (!selectedPort) {
      return;
    }
    setIsLoading(true);
    try {
      await connectSerial(selectedPort);
      setIsConnected(true);
      onConnectionChange?.(true);
    } catch {
      setIsConnected(false);
      onConnectionChange?.(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setIsLoading(true);
    try {
      await disconnectSerial();
      setIsConnected(false);
      onConnectionChange?.(false);
    } catch {
      /* Disconnect failed — try to re-check status */
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="font-heading font-semibold text-foreground text-sm uppercase tracking-wider">
          Connection
        </h2>
      </div>

      {/* Serial Port Selector */}
      <div className="flex flex-col gap-2">
        <label
          className="text-muted-foreground text-xs uppercase tracking-wider"
          htmlFor="port-selector"
        >
          Serial Port
        </label>

        <div className="flex gap-2">
          {/* Custom dropdown (no native select for monochrome styling control) */}
          <div className="relative flex-1" ref={dropdownRef}>
            <button
              className="flex h-8 w-full items-center justify-between rounded-lg border border-border bg-muted px-3 font-telemetry text-foreground text-xs disabled:opacity-50"
              disabled={isConnected}
              id="port-selector"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              type="button"
            >
              <span className="truncate">
                {selectedPort || "No ports found"}
              </span>
              <ChevronDown className="size-3 shrink-0 opacity-50" />
            </button>

            {dropdownOpen && ports.length > 0 && (
              <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl">
                {ports.map((port) => (
                  <button
                    className={`flex w-full items-center px-3 py-2 font-telemetry text-xs transition-colors hover:bg-muted ${
                      port === selectedPort
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                    key={port}
                    onClick={() => {
                      setSelectedPort(port);
                      setDropdownOpen(false);
                    }}
                    type="button"
                  >
                    {port}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Refresh button */}
          <Button
            aria-label="Refresh serial ports"
            disabled={isConnected}
            onClick={refreshPorts}
            size="icon"
            variant="outline"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Connect / Disconnect */}
      <Button
        disabled={isLoading || !(isConnected || selectedPort)}
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
        {/* Serial status */}
        <div className="flex items-center gap-2">
          <div
            className={`aspect-square size-2 rounded-full ${
              isConnected
                ? "animate-pulse-status bg-foreground"
                : "bg-muted-foreground/30"
            }`}
          />
          {isConnected ? (
            <Bluetooth className="size-3 text-foreground" />
          ) : (
            <BluetoothOff className="size-3 text-muted-foreground" />
          )}
          <span className="text-muted-foreground text-xs">
            {isConnected ? "Serial Connected" : "Serial Disconnected"}
          </span>
        </div>

        {/* Gamepad status */}
        <div className="flex items-center gap-2">
          <div
            className={`aspect-square size-2 rounded-full ${
              gamepadConnected
                ? "animate-pulse-status bg-foreground"
                : "bg-muted-foreground/30"
            }`}
          />

          <JoystickIcon className="size-5 text-muted-foreground" />

          <span className="text-muted-foreground text-xs">
            {gamepadConnected
              ? `Gamepad: ${gamepadId.split("(")[0].trim()}`
              : "No Gamepad Detected"}
          </span>
        </div>
      </div>
    </div>
  );
}
