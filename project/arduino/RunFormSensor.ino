// RunFormSensor.ino
// Arduino Nano firmware for RunForm Analyser
// MMA8452Q 3-axis accelerometer via I2C (address 0x1C, SA0 tied LOW)
// Streams CSV: ax,ay,az at 100 Hz over Serial at 115200 baud
//
// Wiring:
//   SDA -> A4
//   SCL -> A5
//   VCC -> 3.3V (NOT 5V — sensor is 3.3V only)
//   GND -> GND
//
// IMPORTANT: Do NOT connect to 5V — will permanently damage sensor.

#include <Wire.h>

// MMA8452Q I2C address (SA0 tied LOW -> 0x1C)
#define MMA8452Q_ADDR   0x1C

// MMA8452Q register addresses
#define REG_STATUS      0x00
#define REG_OUT_X_MSB   0x01
#define REG_WHO_AM_I    0x0D
#define REG_XYZ_DATA_CFG 0x0E
#define REG_CTRL_REG1   0x2A

// Expected WHO_AM_I response
#define WHO_AM_I_VAL    0x2A

// Sampling interval: 10 ms = 100 Hz
#define SAMPLE_INTERVAL_MS 10

// Timing
unsigned long lastSampleTime = 0;

// ---- Helper: write a single byte to a register ----
void writeRegister(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MMA8452Q_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission(true);
}

// ---- Helper: read a single byte from a register ----
uint8_t readRegister(uint8_t reg) {
  Wire.beginTransmission(MMA8452Q_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)MMA8452Q_ADDR, (uint8_t)1);
  return Wire.read();
}

void setup() {
  Wire.begin();
  Serial.begin(115200);

  // 1. WHO_AM_I check — verify correct sensor at correct address
  uint8_t whoAmI = readRegister(REG_WHO_AM_I);
  if (whoAmI != WHO_AM_I_VAL) {
    Serial.println("ERR:SENSOR");
    // Halt: flash LED as error indicator and block forever
    pinMode(LED_BUILTIN, OUTPUT);
    while (true) {
      digitalWrite(LED_BUILTIN, HIGH);
      delay(200);
      digitalWrite(LED_BUILTIN, LOW);
      delay(200);
    }
  }

  // 2. Enter standby mode before configuration
  writeRegister(REG_CTRL_REG1, 0x00);

  // 3. Set full-scale range to ±2g
  //    XYZ_DATA_CFG[1:0] = 00 -> ±2g
  writeRegister(REG_XYZ_DATA_CFG, 0x00);

  // 4. Configure CTRL_REG1:
  //    0b00100101
  //    Bits [7:6] = 00  -> ASLP_RATE = 50 Hz (don't care)
  //    Bits [5:3] = 010 -> ODR = 100 Hz
  //    Bit  [2]   = 0   -> Normal read mode (not fast)
  //    Bit  [1]   = 0   -> Normal power mode
  //    Bit  [0]   = 1   -> Active mode
  writeRegister(REG_CTRL_REG1, 0x25);

  // Signal MATLAB that sensor is ready
  Serial.println("READY");
}

void loop() {
  unsigned long now = millis();

  // Enforce 100 Hz sample rate with millis() timing
  if ((now - lastSampleTime) < SAMPLE_INTERVAL_MS) {
    return;
  }
  lastSampleTime = now;

  // Burst-read 7 bytes: STATUS + OUT_X_MSB + OUT_X_LSB + OUT_Y_MSB + OUT_Y_LSB + OUT_Z_MSB + OUT_Z_LSB
  Wire.beginTransmission(MMA8452Q_ADDR);
  Wire.write(REG_STATUS);  // start from STATUS register (0x00)
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)MMA8452Q_ADDR, (uint8_t)7);

  uint8_t raw[7];
  for (int i = 0; i < 7; i++) {
    raw[i] = Wire.read();
  }

  // Reconstruct 12-bit signed values from left-justified 16-bit register pairs
  // MMA8452Q stores: MSB in first reg (bits 11-4), LSB in second reg (bits 3-0 in upper nibble)
  // Reconstruct: combine bytes then right-shift 4 to get 12-bit signed value
  int16_t ax = (int16_t)((raw[1] << 8) | raw[2]) >> 4;
  int16_t ay = (int16_t)((raw[3] << 8) | raw[4]) >> 4;
  int16_t az = (int16_t)((raw[5] << 8) | raw[6]) >> 4;

  // Output CSV line: ax,ay,az
  Serial.print(ax);
  Serial.print(",");
  Serial.print(ay);
  Serial.print(",");
  Serial.println(az);
}
