#include "RoboCore_MMA8452Q.h"
#include <EEPROM.h>

MMA8452Q accelerometer;

const int SAMPLE_COUNT = 17;

int rawX[SAMPLE_COUNT];
int rawY[SAMPLE_COUNT];
int rawZ[SAMPLE_COUNT];

int indexSample = 0;

bool calibrationDone = false;
bool sampling = false;
bool measurementDone = false;

void setup(){
  Serial.begin(115200);
  Serial.println("--- MMA8452Q Demo ---");

  accelerometer.init();
  pinMode(2, INPUT_PULLUP);

  Serial.println("Recording calibration batch...");
}

void loop(){

  // ---- CALIBRATION (first 500 ms after start) ----
  if (!calibrationDone) {

    accelerometer.read();

    rawX[indexSample] = accelerometer.raw_x;
    rawY[indexSample] = accelerometer.raw_y;
    rawZ[indexSample] = accelerometer.raw_z;

    indexSample++;

    if (indexSample >= SAMPLE_COUNT) {

      int addr = 0;

      for (int i = 0; i < SAMPLE_COUNT; i++) {

        EEPROM.put(addr, rawX[i]); addr += sizeof(int);
        EEPROM.put(addr, rawY[i]); addr += sizeof(int);
        EEPROM.put(addr, rawZ[i]); addr += sizeof(int);
      }

      Serial.println("Calibration stored.");

      calibrationDone = true;
      indexSample = 0;
    }

    delay(29);
    return;
  }

  // ---- START MEASUREMENT WHEN PIN 2 LOW ----
  if (!measurementDone && !sampling && digitalRead(2) == LOW) {

    Serial.println("Trigger detected. Recording measurement batch...");
    sampling = true;
    indexSample = 0;
  }

  // ---- MEASUREMENT BATCH ----
  if (sampling) {

    accelerometer.read();

    rawX[indexSample] = accelerometer.raw_x;
    rawY[indexSample] = accelerometer.raw_y;
    rawZ[indexSample] = accelerometer.raw_z;

    indexSample++;

    if (indexSample >= SAMPLE_COUNT) {

      int addr = 102; // start after calibration

      for (int i = 0; i < SAMPLE_COUNT; i++) {

        EEPROM.put(addr, rawX[i]); addr += sizeof(int);
        EEPROM.put(addr, rawY[i]); addr += sizeof(int);
        EEPROM.put(addr, rawZ[i]); addr += sizeof(int);
      }

      Serial.println("Measurement batch stored.");

      sampling = false;
      measurementDone = true;
    }

    delay(29);
  }

  // ---- SERIAL COMMANDS ----
  if (Serial.available()) {

    char cmd = Serial.read();

    if (cmd == '1') {

      Serial.println("Calibration batch:");

      int addr = 0;
      int x,y,z;

      for (int i = 0; i < SAMPLE_COUNT; i++) {

        EEPROM.get(addr,x); addr+=sizeof(int);
        EEPROM.get(addr,y); addr+=sizeof(int);
        EEPROM.get(addr,z); addr+=sizeof(int);

        Serial.print(x);
        Serial.print(",");
        Serial.print(y);
        Serial.print(",");
        Serial.println(z);
      }

      Serial.println("Measurement batch:");

      addr = 102;

      for (int i = 0; i < SAMPLE_COUNT; i++) {

        EEPROM.get(addr,x); addr+=sizeof(int);
        EEPROM.get(addr,y); addr+=sizeof(int);
        EEPROM.get(addr,z); addr+=sizeof(int);

        Serial.print(x);
        Serial.print(",");
        Serial.print(y);
        Serial.print(",");
        Serial.println(z);
      }
    }
  }
}