# Sumo Robot

This is a school project for the **Instituto Politécnico Nacional (IPN)**, **CECyT 10 "Carlos Vallejo Márquez"**.

## Architecture

The project consists of two main applications located in the `apps/` directory, managed as a monorepo using [Turbo](https://turbo.build/):

### Desktop Control Center (`apps/desktop-control-center`)
A cross-platform desktop application (macOS + Windows) that controls the sumo robot.
- Built with **Tauri v2**, **React**, **TypeScript**, and **Tailwind CSS**.
- A **Rust** backend handles gamepad input (via `gilrs`) and WiFi UDP communication.
- The frontend is a display-only interface that shows telemetry, joystick visualization, and motor gauges.
- Telemetry is streamed to the frontend via the Tauri Channel API at 250Hz.

### Arduino R4 Firmware (`apps/arduino-r4-firmware`)
The firmware for the **Arduino UNO R4 WiFi** onboard the sumo robot.
- Creates a WiFi Access Point and listens for UDP motor commands.
- Supports both AP mode (for competition) and Station mode (for development) via `#define`.
- Uses a 6-byte binary protocol: `[0xFF, left_dir, left_pwm, right_dir, right_pwm, checksum]`.
- Implements a 150ms watchdog fail-safe with emergency stop.

## Getting Started

This project uses [Bun](https://bun.sh) as the package manager and runtime environment.

1. Install dependencies:
   ```bash
   bun install
   ```

2. Start the development server:
   ```bash
   bun run dev
   ```

3. Build the project:
   ```bash
   bun run build
   ```

## Development Guidelines

- **Package Manager:** Always use Bun.
- **Language:** Always use TypeScript instead of JavaScript.
- **Formatting and Linting:** Always use Ultracite (Biome's zero-config preset). Run `bun run check` and `bun run fix`.
