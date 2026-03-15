# RunForm Analyser
## Wearable Running Gait Analysis System
### Project Implementation Document (PID) — v1.0

| Field | Value |
|---|---|
| Document Status | Draft — For Development |
| Prepared For | Claude Code Agent |
| Target Platform | Arduino Nano + MATLAB/Simulink |
| Sensor | MMA8452Q @ I2C 0x1C |
| UI Target | Local Web App (HTML/CSS/JS) |

---

## 1. Project Overview

RunForm Analyser is a real-time wearable gait analysis system that mounts on a running shoe and provides evidence-based feedback to help runners improve their form, reduce injury risk, and run more efficiently. The system uses an MMA8452Q 3-axis MEMS accelerometer attached to the shoe to capture raw foot motion data, which is processed through a MATLAB/Simulink pipeline and displayed on a locally-hosted web application connected via USB cable.

### 1.1 Objectives

- Continuously stream 3-axis acceleration data from shoe-mounted sensor to host PC
- Detect and classify foot strike pattern: heel, midfoot, or forefoot
- Measure sagittal foot angle at ground contact (optimal: 0–10° plantarflexion)
- Detect lateral sidestep / crossover gait (X-axis cumulative displacement)
- Calculate and display real-time foot path trajectory vs. optimal reference path
- Measure cadence (target: 160–180 steps/min) and ground contact time
- Quantify pronation/supination severity during stance phase
- Deliver clear, actionable, plain-English feedback to the user in real time
- Provide toggleable signal scope views for engineering debugging

### 1.2 System Architecture

The system is split into three tightly coupled layers:

| Layer | Component | Role |
|---|---|---|
| Layer 1 — Hardware | Arduino Nano + MMA8452Q | Reads I2C sensor, streams CSV over USB serial at 115200 baud, 100 Hz |
| Layer 2 — Processing | MATLAB / Simulink | Signal filtering, gait algorithm, metrics computation, JSON export |
| Layer 3 — UI | HTML / CSS / JS (local) | Live dashboard, foot path overlay, feedback panel, served locally |

---

## 2. Hardware Specification

### 2.1 Component List

| Component | Purpose / Note |
|---|---|
| Arduino Nano (ATmega328P) | Microcontroller; I2C master; USB-serial bridge to MATLAB |
| MMA8452Q Breakout Board | 3-axis, 12-bit MEMS accelerometer, I2C interface |
| USB-A to Mini-USB Cable | Power and serial data link between Nano and PC |
| 3.3 V Power Line | MMA8452Q is 3.3 V only — use Nano 3V3 pin |
| Pull-up Resistors | 4.7 kΩ on SDA and SCL lines (if not on breakout board) |
| Shoe Mounting Tape/Velcro | Securely mount sensor to laces area of shoe |

### 2.2 MMA8452Q Sensor Configuration

The MMA8452Q SA0 pin must be pulled LOW to set the I2C address to 0x1C. This is the required address for this project.

> **I2C Address Configuration**
> - SA0 pin = GND → I2C address = **0x1C** ✔ Required for this project
> - SA0 pin = VCC → I2C address = 0x1D ✘ Do NOT use
> - WHO_AM_I register (0x0D) returns 0x2A as device identifier — verify on startup

### 2.3 Key MMA8452Q Registers

| Register Address | Description |
|---|---|
| 0x00 (STATUS) | Data ready flags |
| 0x01–0x06 (OUT_X/Y/Z MSB+LSB) | Raw 12-bit acceleration data (read 6 bytes burst) |
| 0x0D (WHO_AM_I) | Device ID = 0x2A |
| 0x0E (XYZ_DATA_CFG) | Full-scale range: 0x00=±2g, 0x01=±4g, 0x02=±8g |
| 0x2A (CTRL_REG1) | ODR, mode: write 0x00 (standby) then 0x25 (active, 100 Hz ODR) |

### 2.4 Sensor Orientation on Shoe

Mount the breakout board flat on the shoe tongue / laces area, component side up, with the short sensor axis aligned with the toe.

| Axis | Direction on Foot | Primary Use |
|---|---|---|
| X-axis | Medial ↔ Lateral | Detects sideways (crossover) gait deviation |
| Y-axis | Heel ↔ Toe (anterior–posterior) | Detects forward/backward rocking |
| Z-axis | Vertical (up–down) | Detects impact transients; primary step detection axis |

---

## 3. Arduino Nano Firmware

### 3.1 Required Libraries

- `Wire.h` — Built-in I2C library
- No external libraries required — all I2C communication is done via direct register access

### 3.2 Firmware Architecture

The firmware is a straightforward read-and-transmit loop. It must initialise the sensor, verify the WHO_AM_I register, then stream data over serial as fast as the processing layer requires (100 Hz nominal).

> **Arduino Firmware Specification**
> - Baud rate: 115200 (USB serial to MATLAB)
> - Output format: `"AX,AY,AZ\n"` where values are raw 12-bit signed integers (no floating point on Arduino)
> - Sample rate: 100 Hz (MMA8452Q CTRL_REG1 ODR = 100 Hz, loop timing via `millis()`)
> - Startup handshake: send `"READY\n"` after sensor init, then begin streaming
> - Error handling: if WHO_AM_I ≠ 0x2A, send `"ERR:SENSOR\n"` and halt

### 3.3 Firmware Implementation Steps

**In `setup()`:**

1. `Wire.begin()` — initialise I2C as master
2. `Serial.begin(115200)` — open USB serial
3. Read WHO_AM_I register at address `0x0D` from device `0x1C` — verify == `0x2A`
4. Write `0x00` to `CTRL_REG1` (0x2A) to enter standby mode
5. Write `0x00` to `XYZ_DATA_CFG` (0x0E) to set ±2g range
6. Write `0x25` to `CTRL_REG1`: sets ODR=100 Hz, fast-read off, active mode
7. `Serial.println("READY")` to signal MATLAB that streaming is about to begin

**In `loop()`:**

1. Check `millis()` to enforce 10 ms interval (100 Hz)
2. Burst-read 7 bytes from register `0x00` (STATUS + OUT_X/Y/Z)
3. Reconstruct 12-bit signed values: `val = (int16_t)((rawData[i]<<8 | rawData[i+1])) >> 4`
4. Print `"ax,ay,az\n"` via `Serial.print` / `Serial.println`

```c
// CTRL_REG1 bit pattern for 100 Hz active mode:
// Bits [5:3] = ODR: 010 = 100 Hz
// Bit  [1]   = F_READ = 0 (12-bit mode)
// Bit  [0]   = ACTIVE = 1
// 0b00100101 = 0x25

// Data reconstruction (burst read bytes 1-6 = OUT_X_MSB..OUT_Z_LSB):
int16_t ax = (int16_t)((raw[1] << 8) | raw[2]) >> 4;
int16_t ay = (int16_t)((raw[3] << 8) | raw[4]) >> 4;
int16_t az = (int16_t)((raw[5] << 8) | raw[6]) >> 4;
```

---

## 4. MATLAB / Simulink Processing Layer

### 4.1 Architecture Overview

The processing layer consists of two coordinated components: a MATLAB script (`main.m`) that handles serial I/O, signal processing, gait analysis, and JSON export; and a Simulink model (`RunForm.slx`) that provides live scope visualisation of all signals for engineering debug purposes.

> **Recommended MATLAB Toolboxes**
> - Signal Processing Toolbox — Butterworth filter design (`butter`, `filtfilt`/`filter`)
> - Simulink Support Package for Arduino Hardware — for Simulink scope visualisation
> - Instrument Control Toolbox — `serialport()` function for robust serial I/O
> - MATLAB App Designer (optional) — if a MATLAB-native GUI panel is required alongside web UI

### 4.2 MATLAB Serial Reader (`main.m`)

This script is the entry point. It manages the serial connection, pre-processes each incoming sample, runs all gait algorithms, accumulates session data into MATLAB workspace variables, and writes a JSON file read by the web UI.

#### 4.2.1 Serial Initialisation

- Use `serialport(portName, 115200)` (Instrument Control Toolbox) for robust, non-blocking reads
- Wait for `"READY\n"` handshake from Arduino before starting the processing loop
- Set `configureTerminator(s, "LF")` and `readline()` for line-by-line parsing
- Detect and display COM port automatically using `serialportlist("available")`

#### 4.2.2 Signal Processing Pipeline

For each received sample, apply the following processing chain in order:

| Step | Process | Implementation Detail |
|---|---|---|
| Step 1 | Unit Conversion | Multiply raw 12-bit counts by (2/2048) to get acceleration in g. Scale = ±2g, LSB = 1 mg. |
| Step 2 | Low-Pass Filter | 4th-order Butterworth LPF at 20 Hz (use `butter(4, 20/(fs/2))` once at start). Apply using a rolling buffer for real-time operation. |
| Step 3 | High-Pass Filter (impact) | 2nd-order HPF at 0.5 Hz applied to Z-axis only for impact transient extraction (removes gravity and slow drift). |
| Step 4 | Gravity Removal | Subtract static gravity component from Z-axis: `gz_dynamic = gz_raw - mean(gz_recent_1s)` |
| Step 5 | Tilt Estimation | Foot angle from accelerometer: `pitch = atan2d(ay, az)`, `roll = atan2d(-ax, az)`. Apply moving average (50-sample window) to smooth. |
| Step 6 | Step Detection | Peak-detect on vertical (Z) impact signal. Threshold: 1.5 g above baseline. Min inter-step gap: 200 ms. Each peak = one step event. |
| Step 7 | Cadence | Compute rolling cadence: `cadence_spm = 60 / mean(diff(step_timestamps_recent_5_steps)) * 2` (×2 for both feet). |
| Step 8 | Sidestep Detection | For each step window, integrate X-axis acceleration twice using trapezoidal method to get lateral displacement per step. Threshold: >5 cm = crossover alert. |
| Step 9 | Foot Path | Integrate Y (AP) and X (ML) axes to generate relative 2D foot trajectory during swing phase. Store as (x_path, y_path) vector for web UI overlay. |
| Step 10 | Pronation | Compute peak roll angle magnitude during each stance phase (between consecutive step events). >15° = overpronation; <−5° = supination. |

#### 4.2.3 Foot Strike Classification

Use the shape of the Z-axis impact transient to classify foot strike. After step detection triggers:

- Extract 50-sample window centred on impact peak
- Compute impact transient ratio (ITR): `ITR = peak_value / value_at_10ms_before_peak`
- ITR > 3.0 = **heel strike** (sharp, sudden spike)
- ITR 1.5–3.0 = **midfoot strike** (moderate slope)
- ITR < 1.5 = **forefoot strike** (gradual loading)

#### 4.2.4 JSON Data Export

After each step event is processed, write an updated `data.json` file to the `www/` directory served by the local HTTP server. This is the sole interface between MATLAB and the web UI.

```matlab
% JSON structure to write after each update:
data.timestamp        = posixtime(datetime('now'));
data.ax = ax_g; data.ay = ay_g; data.az = az_g;      % live filtered values
data.cadence          = cadence_spm;                  % steps/min
data.footStrike       = footStrikeType;               % 'heel'|'midfoot'|'forefoot'
data.impactAngle      = impactAngle_deg;              % sagittal foot angle at contact
data.rollAngle        = rollAngle_deg;                % pronation/supination
data.lateralDisp      = lateralDisp_m;                % sidestep displacement
data.isSidestep       = isSidestep;                   % bool
data.footPath.x       = footPath_x;                   % array, relative coords (m)
data.footPath.y       = footPath_y;                   % array, relative coords (m)
data.optimalPath.x    = optPath_x;                    % array, reference coords
data.optimalPath.y    = optPath_y;
data.feedback         = feedbackMessages;             % cell array of strings
data.scores.overall   = overallScore;                 % 0-100
data.scores.cadence   = cadenceScore;
data.scores.strike    = strikeScore;
data.scores.pronation = pronationScore;
data.scores.lateral   = lateralScore;
jsonStr = jsonencode(data);
fid = fopen('www/data.json', 'w'); fprintf(fid, '%s', jsonStr); fclose(fid);
```

### 4.3 Simulink Model (`RunForm.slx`)

The Simulink model exists entirely for signal visualisation during development and debugging. It does NOT control the Arduino or process the data — that is MATLAB's role. The model reads from MATLAB workspace variables (using From Workspace blocks) and displays them on Scope blocks.

#### 4.3.1 Model Structure

| Block | Description |
|---|---|
| From Workspace: raw_ax/ay/az | Reads raw accelerometer data from MATLAB workspace at 100 Hz |
| From Workspace: filt_ax/ay/az | Reads filtered signals from MATLAB workspace |
| From Workspace: impact_z | High-pass filtered Z for impact detection |
| From Workspace: step_events | Binary step detection signal (pulse at each step) |
| From Workspace: pitch/roll | Tilt angle signals |
| From Workspace: lateral_disp | Integrated lateral displacement |
| Scope: Raw XYZ | 3-channel scope: raw ax, ay, az (debug mode only) |
| Scope: Filtered XYZ | 3-channel scope: filtered signals |
| Scope: Impact + Steps | 2-channel scope: impact_z + step_events overlay |
| Scope: Angles | 2-channel scope: pitch angle + roll angle |
| Scope: Lateral | 1-channel scope: lateral displacement per step |
| Dashboard Toggle | Boolean constant block: `DEBUG_MODE = true/false`. When false, all scopes are disabled via Enable blocks. |

#### 4.3.2 Debug Mode Toggle Implementation

All scope subsystems must be wrapped in an Enabled Subsystem. A single boolean Constant block named `DEBUG_MODE` feeds the Enable port of every scope subsystem. The user sets `DEBUG_MODE = 1` or `0` in the MATLAB workspace before launching the Simulink model.

```matlab
% Running the Debug Scopes:
DEBUG_MODE = 1;        % Enable all scopes (development mode)
DEBUG_MODE = 0;        % Disable all scopes (production / user mode)
sim('RunForm.slx');    % Launch Simulink model
% MATLAB main.m must be running first to populate workspace variables
% Simulink runs in Normal mode with 0.01s sample time to match 100 Hz data rate
```

### 4.4 Local HTTP Server

MATLAB must start a local HTTP server to serve the web application. The simplest approach is to launch Python's built-in HTTP server as a background process from within MATLAB.

```matlab
% Start local web server (Python 3) in www/ directory
system('python -m http.server 8080 --directory www &');
pause(1);  % Allow server to start
web('http://localhost:8080', '-browser');  % Open web UI in default browser
```

---

## 5. Gait Analysis Algorithms & Biomechanical Reference

### 5.1 Biomechanical Thresholds

All thresholds are derived from peer-reviewed running biomechanics literature (Physiopedia, Mayo Clinic Proceedings, PMC running gait studies).

| Metric | Optimal Range | Deviation Indicator |
|---|---|---|
| Cadence | 160–180 steps/min | <150 = significantly too slow; >190 = too fast |
| Foot Strike (sagittal angle) | 0–10° plantarflexion at contact | Negative = dorsiflexion (heel strike); >20° = forefoot only |
| Pronation (peak roll) | 4–12° eversion | >15° = overpronation; <0° = supination / underpronation |
| Lateral Deviation / Step | <5 cm | >8 cm = crossover gait; >12 cm = severe crossover |
| Impact Transient (g) | 1.5–2.5 g above baseline | >3.5 g = heavy heel striking; indicates overstriding |
| Ground Contact Time | 200–280 ms (recreational) | >300 ms = slow cadence / overstriding |

### 5.2 Foot Path Overlay

The foot path overlay shows the actual trajectory of the sensor-side foot relative to the runner's body during one complete stride cycle (swing phase). The reference optimal path is a smooth, straight-line projection with a slight arc matching normal running mechanics.

- **Swing phase detection:** foot is in swing when `|az| < 0.5 g` (no ground reaction) AND peak step event has just fired
- **During swing phase:** double-integrate filtered ax (medial-lateral) and ay (anterior-posterior) to get x(t) and y(t) relative displacement
- **Normalise path** to start at (0,0) and end at approximately (0, stride_length) for display
- **Optimal path:** straight line from (0,0) to (0, stride_length) with standard deviation corridor (±2 cm wide)
- **Deviation score:** mean absolute deviation from optimal path, capped at 100 for scoring

### 5.3 Feedback Engine

The feedback engine maps detected metric violations to plain-English messages, severity level, and corrective cues. Each message is short (max 2 sentences) and non-technical.

| Condition | Level | User Message |
|---|---|---|
| Heel striking detected | WARNING | "Try landing with your foot directly under your hip. Shorter steps naturally encourage a midfoot landing." |
| Low cadence (<150) | WARNING | "Your steps are quite slow. Try increasing your step rate — aim for 3 steps per second." |
| Overpronation (>15°) | ALERT | "Your foot is rolling inward too much on landing. Focus on landing with a slightly stiffer ankle, or consider supportive insoles." |
| Crossover gait (>8 cm) | WARNING | "Your foot is crossing the centreline as you run. Imagine running along a straight line and landing just inside it each time." |
| Heavy impact (>3.5 g) | ALERT | "You are landing very hard. Try to land softer and quieter — if you can hear your footsteps, that is too much impact." |
| Good form (all OK) | OK | "Great form! Keep it up — your mechanics look efficient." |
| High cadence (>190) | INFO | "Your cadence is very high. This is usually fine unless it feels forced or uncomfortable." |

---

## 6. Web User Interface

### 6.1 Design Principles

- Minimalist and clean — white background, single accent colour, generous whitespace
- Ordinary-person friendly: no jargon, large readable text, icon + colour coding for status
- Mobile-responsive using CSS Grid / Flexbox
- All data fetched from `data.json` via polling (`setInterval` every 100 ms)
- No frameworks required — plain HTML5, CSS3, Vanilla JS only

### 6.2 Page Layout

| Section | Content & Behaviour |
|---|---|
| Header Bar | App name, connection status indicator (green/red dot), live timestamp |
| Metric Cards Row (top) | 4 cards: Cadence, Foot Strike, Impact, Ground Contact Time. Each card shows value, unit, colour-coded status, trend arrow. |
| Foot Path Overlay Panel | Canvas element (400×400 px). Draws actual foot path in blue, optimal reference path in light grey, with shaded deviation corridor. Updates every stride. |
| Angle Gauges Row | Two semicircular SVG gauge charts: Pronation/Supination angle and Impact Angle. Needle indicates live value; coloured zones show optimal/warning/danger regions. |
| Feedback Panel | Scrollable card list. Each entry has icon (tick/warning/alert), short message text, severity colour. Most recent at top. Max 5 shown. |
| Session Summary (bottom) | Overall score 0–100 with ring chart. Four sub-scores: Cadence, Strike, Pronation, Lateral. Shown only after 10+ steps detected. |

### 6.3 Colour Coding Scheme

| Status | Colour Hex | Usage |
|---|---|---|
| Good / OK | `#22C55E` (green) | Metric within optimal range |
| Warning | `#F59E0B` (amber) | Metric slightly outside optimal; monitor |
| Alert / Poor | `#EF4444` (red) | Metric significantly outside optimal; immediate feedback |
| Info / Neutral | `#3B82F6` (blue) | Informational, no action required |
| Background | `#FAFAFA` | Page background — off-white for eye comfort |
| Text Primary | `#111827` | Main labels and values |

### 6.4 File Structure

```
project/
├── arduino/
│   └── RunFormSensor.ino       ← Arduino firmware
├── matlab/
│   ├── main.m                  ← Entry point: serial reader + algorithms
│   ├── RunForm.slx             ← Simulink scope model
│   ├── processGait.m           ← Gait algorithm functions
│   ├── feedbackEngine.m        ← Feedback message mapping
│   └── pathIntegration.m       ← Foot path integration
└── www/
    ├── index.html              ← Web dashboard
    ├── style.css               ← Clean, minimal stylesheet
    ├── app.js                  ← Data polling + chart rendering
    └── data.json               ← Written by MATLAB; read by JS
```

---

## 7. Data & Signal Flow

```
  [MMA8452Q Sensor] ── I2C (0x1C, 100Hz) ──> [Arduino Nano]
        │
        │  USB Serial 115200 baud
        │  Format: "ax,ay,az\n" (raw 12-bit integers)
        ▼
  [MATLAB main.m] ── serialport() reads each line
        │
        ├─> Unit conversion (counts → g)
        ├─> Butterworth LPF 20 Hz
        ├─> HPF 0.5 Hz (impact isolation)
        ├─> Tilt estimation (pitch/roll)
        ├─> Step detection (peak detect on Fz)
        ├─> Cadence calculation
        ├─> Foot strike classification (ITR)
        ├─> Pronation angle (peak roll per stance)
        ├─> Lateral displacement integration
        ├─> Foot path double integration
        ├─> Feedback engine
        ├─> Update MATLAB workspace variables
        └─> Write www/data.json
                  │
        +---------+----------+
        │                    │
  [Simulink RunForm.slx]   [Python HTTP :8080]
  (Debug scopes only)              │
  Reads MATLAB workspace    [index.html polls data.json @ 100ms]
                                   │
                         [Web Dashboard in Browser]
```

---

## 8. Development Phases

| Phase | Goal & Success Criteria |
|---|---|
| Phase 1: Hardware Validation | Flash firmware to Nano, verify WHO_AM_I returns 0x2A, open Serial Monitor, confirm raw CSV stream at 100 Hz |
| Phase 2: MATLAB Serial Reader | Write main.m serial reader, parse CSV, plot raw ax/ay/az in real time with `plot()` to confirm data integrity |
| Phase 3: Signal Processing | Add Butterworth filter, tilt estimation, verify filtered signals in MATLAB figures before moving to gait algorithms |
| Phase 4: Gait Algorithm Core | Implement step detection, cadence, foot strike classifier. Test by walking/running with sensor, verify step counts |
| Phase 5: Advanced Metrics | Add pronation detection, lateral displacement, foot path integration. Log data to CSV for offline validation |
| Phase 6: Simulink Model | Build RunForm.slx with From Workspace blocks + Scope blocks. Verify DEBUG_MODE toggle works correctly |
| Phase 7: JSON Export + HTTP Server | Write JSON export, start Python HTTP server, verify browser can access data.json |
| Phase 8: Web UI | Build index.html / style.css / app.js. Implement polling, metric cards, foot path canvas, feedback panel |
| Phase 9: Integration Test | Full end-to-end test at slow jog. Verify feedback messages appear correctly. Tune thresholds. |
| Phase 10: Polish + Documentation | UI refinement, code comments, README, wiring diagram, user guide |

---

## 9. Known Risks & Mitigations

| Risk | Mitigation Strategy |
|---|---|
| Double integration drift | Integrating accelerometer twice for foot path accumulates error rapidly. Mitigate: only integrate during detected swing phase windows; reset to zero at each toe-off. |
| Sensor noise / vibration | Shoe impacts generate high-frequency noise. Mitigate: 20 Hz LPF removes most, HPF used only for impact detection (intentionally preserves transient). |
| Sensor orientation ambiguity | Sensor must be mounted consistently each session. Mitigate: document exact placement in user guide; auto-calibration on startup (standing still for 2 s). |
| Serial buffer overflow | If MATLAB cannot read fast enough, Arduino TX buffer fills. Mitigate: use 115200 baud (fast enough for 100 Hz CSV), flush buffer on connect. |
| JSON write race condition | MATLAB writing JSON while JS is reading may cause partial reads. Mitigate: write to temp file then rename (atomic on most OS), or use a simple file lock flag field in JSON. |
| No gyroscope (drift in angle) | Accelerometer-only tilt uses gravity, which is corrupted by motion. Mitigate: use short moving average window; only evaluate angle during quasi-static stance phase. |

---

## 10. Glossary

| Term | Definition |
|---|---|
| ITR (Impact Transient Ratio) | Ratio of peak impact acceleration to pre-impact value; used to classify foot strike type |
| ODR (Output Data Rate) | Sensor sampling frequency; set to 100 Hz via MMA8452Q CTRL_REG1 |
| Pronation | Inward rolling of foot during stance phase; normal up to ~12° eversion |
| Cadence | Step rate in steps per minute; optimal range 160–180 spm for recreational runners |
| Stance Phase | Portion of gait cycle when foot is in contact with ground (~40% of cycle at running pace) |
| Swing Phase | Portion of gait cycle when foot is airborne (~60% of cycle at running pace) |
| Crossover Gait | Pattern where foot lands beyond body centreline; associated with ITB syndrome |
| LPF / HPF | Low-pass / high-pass filter; used to separate slow-varying tilt from impact transients |
| Double Integration | Integrating acceleration twice to obtain position; used for foot path tracking |
| JSON polling | JavaScript technique of repeatedly fetching a file at intervals to get updated data |

---

*End of Project Implementation Document*
