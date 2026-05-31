// UDP socket management for Arduino ↔ Desktop communication.
//
// The sumo robot's Arduino R4 WiFi creates a WiFi Access Point and
// listens for UDP motor commands. This module wraps `std::net::UdpSocket`
// with ergonomic helpers that convert IO errors into `String` for Tauri
// command compatibility.
//
// We use blocking UDP from the standard library rather than an async
// runtime because:
// 1. The control loop already runs in its own dedicated thread.
// 2. UDP send is essentially non-blocking (no TCP handshake).
// 3. Fewer dependencies = smaller binary and simpler debugging.

use std::net::{SocketAddr, UdpSocket};
use std::time::Duration;

/// Creates a new UDP socket bound to an ephemeral port on all interfaces.
///
/// Binding to `0.0.0.0:0` lets the OS pick a free port. We don't need a
/// fixed port because the Arduino identifies us by the source address of
/// incoming packets, not by a pre-configured port number.
pub fn create_socket() -> Result<UdpSocket, String> {
    let socket =
        UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("Failed to bind UDP socket: {e}"))?;

    // Set a short read timeout so the telemetry listener thread doesn't
    // block forever when no data arrives. 50ms is short enough to keep
    // the thread responsive to shutdown signals while not busy-spinning.
    socket
        .set_read_timeout(Some(Duration::from_millis(50)))
        .map_err(|e| format!("Failed to set read timeout: {e}"))?;

    Ok(socket)
}

/// Sends a 6-byte motor command packet to the Arduino.
///
/// # HOT PATH — called at 250Hz
///
/// `send_to` on a UDP socket is essentially a single syscall with no
/// handshake overhead, so this is extremely fast (~1µs on macOS).
#[inline]
pub fn send_command(
    socket: &UdpSocket,
    target: &SocketAddr,
    packet: &[u8; 6],
) -> Result<(), String> {
    socket
        .send_to(packet, target)
        .map_err(|e| format!("UDP send failed: {e}"))?;
    Ok(())
}

/// Receives a datagram from the socket into the provided buffer.
///
/// Returns the number of bytes received and the sender's address.
/// Will return `Err` if the read times out (configured in `create_socket`)
/// — callers should treat timeout errors as "no data available" rather
/// than fatal.
pub fn recv_telemetry(
    socket: &UdpSocket,
    buf: &mut [u8],
) -> Result<(usize, SocketAddr), String> {
    socket
        .recv_from(buf)
        .map_err(|e| format!("UDP recv failed: {e}"))
}
