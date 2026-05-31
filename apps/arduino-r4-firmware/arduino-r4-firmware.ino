// =============================================================
// MAGNI Sumo Robot — Arduino UNO R4 WiFi Firmware
// =============================================================
//
// This firmware runs on an Arduino UNO R4 WiFi and controls a
// two-motor sumo robot. It replaces the old R3 + HC-05 Bluetooth
// setup with the R4's built-in WiFi, using UDP for real-time
// motor commands from the desktop control center.
//
// PROTOCOL (6-byte binary packet):
//   [0xFF, left_dir, left_pwm, right_dir, right_pwm, XOR_checksum]
//   - Header: 0xFF
//   - left_dir / right_dir: 0x00 = forward, 0x01 = reverse
//   - left_pwm / right_pwm: 0–254 (0xFF is reserved as header)
//   - Checksum: XOR of bytes 1–4 (the four payload bytes)
//
// TELEMETRY REPLY (4-byte heartbeat, sent after each valid command):
//   [0xFE, sequence_number, uptime_low, uptime_high]
//
// SAFETY: 150ms watchdog — if no valid packet is received within
// 150ms the motors are killed via emergencyStop().
//
// =============================================================

#include <Arduino.h>
#include <WiFiS3.h>
#include <WiFiUdp.h>

// =============================================================
// WiFi Mode Selection
// =============================================================
// Uncomment ONE of the following lines to select the WiFi mode:
//
//   WIFI_MODE_AP      — The robot creates its own WiFi network.
//                       Use this for competition or standalone use.
//                       The desktop app connects directly to the
//                       robot's network (SSID: MAGNI_SUMO).
//
//   WIFI_MODE_STATION — The robot joins an existing WiFi network.
//                       Use this during development so both the
//                       robot and your PC share the same network.
//                       Set STA_SSID and STA_PASSWORD below.
//
// Default: AP mode (competition-ready out of the box).
// =============================================================
#define WIFI_MODE_AP
// #define WIFI_MODE_STATION

// --- AP Mode credentials (robot creates this network) ---
const char AP_SSID[]     = "MAGNI_SUMO";
const char AP_PASSWORD[] = "magni2026";

// --- Station Mode credentials (robot joins this network) ---
// Only used when WIFI_MODE_STATION is defined.
const char STA_SSID[]     = "YOUR_NETWORK_NAME";
const char STA_PASSWORD[] = "YOUR_NETWORK_PASSWORD";

// =============================================================
// Network Configuration
// =============================================================
const uint16_t UDP_PORT = 4210;

WiFiUDP udp;

// =============================================================
// Motor Pin Mapping (L298N H-Bridge)
// =============================================================
// Left motor
const uint8_t ENA = 5;   // PWM speed control
const uint8_t IN1 = 6;   // Direction pin A
const uint8_t IN2 = 7;   // Direction pin B

// Right motor
const uint8_t IN3 = 8;   // Direction pin A
const uint8_t IN4 = 9;   // Direction pin B
const uint8_t ENB = 10;  // PWM speed control

// =============================================================
// Protocol Constants
// =============================================================
const uint8_t HEADER_BYTE    = 0xFF;  // Packet start marker
const uint8_t TELEMETRY_HEADER = 0xFE;  // Telemetry reply marker
const uint8_t PACKET_SIZE    = 6;     // Total bytes per command packet

// =============================================================
// Watchdog / Fail-Safe
// =============================================================
// If no valid command is received within this window, the motors
// are killed. 150ms is aggressive enough to stop quickly if the
// controller disconnects, but tolerant enough for WiFi jitter.
const uint32_t WATCHDOG_TIMEOUT_MS = 150;

// =============================================================
// Status LED
// =============================================================
// The built-in LED provides quick visual feedback:
//   - Blinking: WiFi setup in progress
//   - Solid ON: Connected and receiving commands
//   - OFF:      Idle (no recent commands)
const uint8_t STATUS_LED = LED_BUILTIN;

// =============================================================
// State Machine for Packet Parsing
// =============================================================
// We parse byte-by-byte from the UDP payload using the same
// state machine as the old serial parser. This makes it resilient
// to partial reads and keeps the protocol identical.
enum ParserState {
  WAITING_FOR_HEADER,
  READING_L_DIR,
  READING_L_PWM,
  READING_R_DIR,
  READING_R_PWM,
  READING_CHECKSUM
};

// =============================================================
// Global State
// =============================================================
ParserState parserState = WAITING_FOR_HEADER;

// Temporary storage for the packet being parsed
uint8_t lDir = 0;
uint8_t lPwm = 0;
uint8_t rDir = 0;
uint8_t rPwm = 0;

// Timing
unsigned long lastValidPacketTime = 0;

// Telemetry
uint8_t telemetrySeqNum = 0;  // Wraps 0–255 automatically

// Packet statistics (for serial debug output)
uint32_t packetsReceived  = 0;
uint32_t packetsValid     = 0;
uint32_t packetsCorrupted = 0;

// Track whether motors are currently active (for LED control)
bool motorsActive = false;

// =============================================================
// Forward Declarations
// =============================================================
void setMotors(uint8_t leftDir, uint8_t leftPwm, uint8_t rightDir, uint8_t rightPwm);
void emergencyStop();
void setupWiFiAP();
void setupWiFiStation();
void blinkLED(int count, int delayMs);
void processByte(uint8_t b);
void sendTelemetry();
void printWiFiStatus();

// =============================================================
// setup()
// =============================================================
void setup() {
  // --- Serial debug output over USB ---
  Serial.begin(115200);
  // Brief pause so the serial monitor can connect after upload
  delay(1000);
  Serial.println(F(""));
  Serial.println(F("========================================"));
  Serial.println(F("  MAGNI Sumo Robot — R4 WiFi Firmware"));
  Serial.println(F("========================================"));

  // --- Configure motor pins ---
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENB, OUTPUT);

  // Start with motors stopped for safety
  emergencyStop();

  // --- Status LED ---
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  // --- WiFi setup (mode selected by #define) ---
#ifdef WIFI_MODE_AP
  setupWiFiAP();
#elif defined(WIFI_MODE_STATION)
  setupWiFiStation();
#else
  #error "Please define either WIFI_MODE_AP or WIFI_MODE_STATION"
#endif

  // --- Start UDP listener ---
  udp.begin(UDP_PORT);
  Serial.print(F("[UDP] Listening on port "));
  Serial.println(UDP_PORT);
  Serial.println(F("[SYS] Ready — waiting for commands..."));
  Serial.println(F(""));

  // Mark the initial time so the watchdog doesn't trigger immediately
  // during the brief window before the first packet arrives.
  lastValidPacketTime = millis();
}

// =============================================================
// loop()
// =============================================================
void loop() {
  // ---------------------------------------------------------
  // 1. Read and parse incoming UDP packets
  // ---------------------------------------------------------
  int packetSize = udp.parsePacket();
  if (packetSize > 0) {
    packetsReceived++;

    // Read the entire UDP payload and feed each byte into
    // the state machine parser. A single UDP packet may contain
    // exactly one 6-byte command or could theoretically contain
    // multiple commands back-to-back.
    while (udp.available() > 0) {
      uint8_t b = udp.read();
      processByte(b);
    }
  }

  // ---------------------------------------------------------
  // 2. Watchdog fail-safe
  // ---------------------------------------------------------
  // If we haven't received a valid command recently, kill the
  // motors. This protects against WiFi disconnects, controller
  // crashes, or signal loss during a match.
  if (millis() - lastValidPacketTime > WATCHDOG_TIMEOUT_MS) {
    if (motorsActive) {
      emergencyStop();
      motorsActive = false;
      digitalWrite(STATUS_LED, LOW);  // LED off when idle
      Serial.println(F("[WATCHDOG] Timeout — emergency stop!"));
    }
  }
}

// =============================================================
// Byte-by-byte State Machine Parser
// =============================================================
// Identical logic to the old serial parser. Parses the 6-byte
// binary protocol one byte at a time, validating the checksum
// before applying motor commands.
void processByte(uint8_t b) {
  switch (parserState) {

    case WAITING_FOR_HEADER:
      // Only advance when we see the 0xFF header byte.
      // Any other byte is silently discarded (re-sync).
      if (b == HEADER_BYTE) {
        parserState = READING_L_DIR;
      }
      break;

    case READING_L_DIR:
      lDir = b;
      parserState = READING_L_PWM;
      break;

    case READING_L_PWM:
      lPwm = b;
      parserState = READING_R_DIR;
      break;

    case READING_R_DIR:
      rDir = b;
      parserState = READING_R_PWM;
      break;

    case READING_R_PWM:
      rPwm = b;
      parserState = READING_CHECKSUM;
      break;

    case READING_CHECKSUM: {
      uint8_t received   = b;
      uint8_t calculated = lDir ^ lPwm ^ rDir ^ rPwm;

      if (calculated == received) {
        // Valid packet — apply motor commands
        setMotors(lDir, lPwm, rDir, rPwm);
        lastValidPacketTime = millis();
        motorsActive = true;
        packetsValid++;

        // Turn LED on to show we're actively receiving commands
        digitalWrite(STATUS_LED, HIGH);

        // Send telemetry heartbeat back to the sender
        sendTelemetry();
      } else {
        // Checksum mismatch — discard this packet
        packetsCorrupted++;
        Serial.print(F("[PROTO] Checksum mismatch — expected 0x"));
        Serial.print(calculated, HEX);
        Serial.print(F(", got 0x"));
        Serial.println(received, HEX);
      }

      // Always reset to wait for the next packet header
      parserState = WAITING_FOR_HEADER;
      break;
    }
  }
}

// =============================================================
// Telemetry Heartbeat
// =============================================================
// Sends a 4-byte reply to the most recent UDP sender so the
// desktop app knows the robot is alive and responsive.
void sendTelemetry() {
  uint16_t uptime = (uint16_t)(millis() & 0xFFFF);

  uint8_t reply[4];
  reply[0] = TELEMETRY_HEADER;          // 0xFE
  reply[1] = telemetrySeqNum++;         // Wraps at 255 → 0
  reply[2] = (uint8_t)(uptime & 0xFF);  // Uptime low byte
  reply[3] = (uint8_t)(uptime >> 8);    // Uptime high byte

  // Reply to whoever sent us the last packet
  udp.beginPacket(udp.remoteIP(), udp.remotePort());
  udp.write(reply, sizeof(reply));
  udp.endPacket();
}

// =============================================================
// Motor Control
// =============================================================
// Drives both motors with the specified direction and PWM speed.
//   dir = 0x00 → forward (IN_A = HIGH, IN_B = LOW)
//   dir = 0x01 → reverse (IN_A = LOW,  IN_B = HIGH)
void setMotors(uint8_t leftDir, uint8_t leftPwm, uint8_t rightDir, uint8_t rightPwm) {
  // Left motor direction
  if (leftDir == 0x00) {
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
  } else {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
  }
  analogWrite(ENA, leftPwm);

  // Right motor direction
  if (rightDir == 0x00) {
    digitalWrite(IN3, HIGH);
    digitalWrite(IN4, LOW);
  } else {
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, HIGH);
  }
  analogWrite(ENB, rightPwm);
}

// =============================================================
// Emergency Stop
// =============================================================
// Immediately kills all motor outputs. Called by the watchdog
// on timeout and during setup for a known-safe initial state.
void emergencyStop() {
  // Cut PWM first for fastest stop
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);

  // Then clear direction pins
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
}

// =============================================================
// WiFi Setup — Access Point Mode
// =============================================================
// The robot creates its own WiFi network. The desktop app
// connects to this network directly. Best for competition
// where no external infrastructure is available.
void setupWiFiAP() {
  Serial.println(F("[WiFi] Starting Access Point mode..."));
  Serial.print(F("[WiFi] SSID: "));
  Serial.println(AP_SSID);

  // Blink LED while setting up
  blinkLED(3, 200);

  // Create the access point
  int status = WiFi.beginAP(AP_SSID, AP_PASSWORD);
  if (status != WL_AP_LISTENING) {
    Serial.println(F("[WiFi] FATAL: Failed to create Access Point!"));
    Serial.println(F("[WiFi] Check that the WiFi module is working."));
    // Rapid blink to signal error — this is unrecoverable
    while (true) {
      blinkLED(1, 100);
    }
  }

  // Brief delay for the AP to stabilize
  delay(500);

  Serial.println(F("[WiFi] Access Point created successfully."));
  printWiFiStatus();
}

// =============================================================
// WiFi Setup — Station Mode
// =============================================================
// The robot joins an existing WiFi network. Use this during
// development so the robot and your PC are on the same LAN.
void setupWiFiStation() {
  Serial.println(F("[WiFi] Starting Station mode..."));
  Serial.print(F("[WiFi] Connecting to: "));
  Serial.println(STA_SSID);

  int attempts = 0;
  const int maxAttempts = 20;  // ~10 seconds total

  while (WiFi.status() != WL_CONNECTED && attempts < maxAttempts) {
    // Blink LED on each attempt so we can see it's trying
    blinkLED(1, 250);

    WiFi.begin(STA_SSID, STA_PASSWORD);
    delay(500);
    attempts++;

    Serial.print(F("[WiFi] Attempt "));
    Serial.print(attempts);
    Serial.print(F("/"));
    Serial.println(maxAttempts);
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[WiFi] FATAL: Could not connect to network!"));
    Serial.print(F("[WiFi] SSID: "));
    Serial.println(STA_SSID);
    Serial.println(F("[WiFi] Check credentials and network availability."));
    // Rapid blink to signal error — this is unrecoverable
    while (true) {
      blinkLED(1, 100);
    }
  }

  Serial.println(F("[WiFi] Connected to network successfully."));
  printWiFiStatus();
}

// =============================================================
// Print WiFi Status
// =============================================================
void printWiFiStatus() {
  Serial.print(F("[WiFi] IP Address: "));
  Serial.println(WiFi.localIP());

  Serial.print(F("[WiFi] Signal strength (RSSI): "));
  Serial.print(WiFi.RSSI());
  Serial.println(F(" dBm"));
}

// =============================================================
// LED Utility
// =============================================================
void blinkLED(int count, int delayMs) {
  for (int i = 0; i < count; i++) {
    digitalWrite(STATUS_LED, HIGH);
    delay(delayMs);
    digitalWrite(STATUS_LED, LOW);
    delay(delayMs);
  }
}
