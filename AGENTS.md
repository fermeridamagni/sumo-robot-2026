# Project Guidelines

## Rules

- Always use Bun as the package manager and runtime environment.
- Always use TypeScript instead of Javascript.
- Always use Ultracite (Biome's zero-config preset) for code formatting and linting.
- Get up-to-date info with the Context7 MCP.
- Document and explain why the code is for.

## Architecture

- Follow the existing architecture patterns.

```txt
apps/
  - desktop-control-center - Cross-platform desktop app (macOS + Windows) that controls the sumo-robot.
    - Built with Tauri v2, React, TypeScript and Tailwind CSS.
    - Rust backend handles gamepad input (gilrs) and WiFi UDP communication.
    - Frontend is display-only: shows telemetry, joystick visualization, and motor gauges.
    - Streams telemetry to the frontend via Tauri Channel API at 250Hz.

  - arduino-r4-firmware - Arduino UNO R4 WiFi firmware for the sumo robot.
    - Creates a WiFi Access Point and listens for UDP motor commands.
    - Supports both AP mode (competition) and Station mode (development) via #define.
    - Same 6-byte binary protocol: [0xFF, left_dir, left_pwm, right_dir, right_pwm, checksum].
    - 150ms watchdog fail-safe with emergency stop.
```

## References

- [Ultracite Code Standards](ULTRACITE.md).