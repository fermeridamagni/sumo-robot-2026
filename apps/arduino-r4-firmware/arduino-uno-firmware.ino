#include <Arduino.h>

// ---------------------------------------------------------
// 4. Abstracción del Hardware
// ---------------------------------------------------------

// Motor Izquierdo (Left)
const uint8_t ENA = 5; // PWM (Cable Verde)
const uint8_t IN1 = 6; // (Cable Amarillo)
const uint8_t IN2 = 7; // (Cable Naranja)

// Motor Derecho (Right)
const uint8_t IN3 = 8;  // (Cable Rojo)
const uint8_t IN4 = 9;  // (Cable Negro)
const uint8_t ENB = 10; // PWM (Cable Rojo)

// ---------------------------------------------------------
// Constantes del Protocolo y Watchdog
// ---------------------------------------------------------
const uint8_t HEADER_BYTE = 0xFF;
const uint32_t TIMEOUT_MS = 150;

// 1. Estados de la máquina de estados serial
enum SerialState {
  WAITING_FOR_HEADER,
  READING_L_DIR,
  READING_L_PWM,
  READING_R_DIR,
  READING_R_PWM,
  READING_CHECKSUM
};

SerialState currentState = WAITING_FOR_HEADER;

// Variables temporales para construir el paquete
uint8_t lDir = 0, lPwm = 0, rDir = 0, rPwm = 0;

// Variable de tiempo para el Fail-Safe
unsigned long lastValidPacketTime = 0;

// Prototipos de funciones
void setMotors(uint8_t leftDir, uint8_t leftPwm, uint8_t rightDir,
               uint8_t rightPwm);
void emergencyStop();

void setup() {
  // Configuración de pines del L298N
  pinMode(ENA, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);

  pinMode(ENB, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  // Asegurarnos de que el robot empiece detenido
  emergencyStop();

  // Iniciar la comunicación serial a 115200 baudios
  // NOTA: Asegúrate de que tu HC-05 esté configurado a 115200 baudios.
  // Por defecto, muchos HC-05 vienen a 9600 baudios.
  Serial.begin(115200);
}

void loop() {
  // ---------------------------------------------------------
  // 1. Máquina de Estados Serial (Lectura No Bloqueante)
  // ---------------------------------------------------------
  while (Serial.available() > 0) {
    uint8_t incomingByte = Serial.read();

    switch (currentState) {
    case WAITING_FOR_HEADER:
      if (incomingByte == HEADER_BYTE) {
        currentState = READING_L_DIR;
      }
      break;

    case READING_L_DIR:
      lDir = incomingByte;
      currentState = READING_L_PWM;
      break;

    case READING_L_PWM:
      lPwm = incomingByte;
      currentState = READING_R_DIR;
      break;

    case READING_R_DIR:
      rDir = incomingByte;
      currentState = READING_R_PWM;
      break;

    case READING_R_PWM:
      rPwm = incomingByte;
      currentState = READING_CHECKSUM;
      break;

    case READING_CHECKSUM:
      uint8_t receivedChecksum = incomingByte;

      // 2. Validación de Integridad (XOR de los datos)
      uint8_t calculatedChecksum = lDir ^ lPwm ^ rDir ^ rPwm;

      if (calculatedChecksum == receivedChecksum) {
        // Paquete válido: actualizamos motores y marca de tiempo
        setMotors(lDir, lPwm, rDir, rPwm);
        lastValidPacketTime = millis();
      }
      // Tanto si es válido como inválido, reiniciamos el estado
      // esperando el próximo paquete
      currentState = WAITING_FOR_HEADER;
      break;
    }
  }

  // ---------------------------------------------------------
  // 3. Sistema Fail-Safe (Watchdog)
  // ---------------------------------------------------------
  if (millis() - lastValidPacketTime > TIMEOUT_MS) {
    emergencyStop();
  }
}

// ---------------------------------------------------------
// Implementación de Abstracción de Hardware
// ---------------------------------------------------------

void setMotors(uint8_t leftDir, uint8_t leftPwm, uint8_t rightDir,
               uint8_t rightPwm) {
  // Motor Izquierdo
  if (leftDir == 0x00) {
    // Adelante
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
  } else {
    // Reversa (asumiendo leftDir == 0x01 u otro valor)
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
  }
  analogWrite(ENA, leftPwm);

  // Motor Derecho
  if (rightDir == 0x00) {
    // Adelante
    digitalWrite(IN3, HIGH);
    digitalWrite(IN4, LOW);
  } else {
    // Reversa
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, HIGH);
  }
  analogWrite(ENB, rightPwm);
}

// Función para detener ambos motores por completo
void emergencyStop() {
  // Ponemos PWM en 0 (basta para detener el motor)
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);

  // Ponemos los pines de dirección en LOW por seguridad
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
}
