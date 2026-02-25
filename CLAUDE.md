# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**No build step.** This is pure vanilla JS (ES modules) served as static files.

```bash
# Serve locally (required — file:// won't work for ES modules or sensors)
npx serve .          # or: python3 -m http.server 8080
npx live-server .    # auto-reload variant
```

Open on Android Chrome (or via `chrome://inspect` USB debugging) for full sensor access. Desktop Chrome supports DeviceMotion only in some configurations.

**Deploy:** Push to `main` → GitHub Actions triggers Vercel auto-deploy (requires `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` secrets).

**Force SW update after changes:**
```bash
# Bump CACHE name in sw.js (e.g. phoneway-v2.1 → phoneway-v2.2)
# or hard-refresh in browser DevTools → Application → Service Workers → "Update"
```

## Architecture

### Data Flow (signal chain)
```
Device sensors
  ├── DeviceMotionEvent → MotionSensor
  │     └── KalmanFilter2D → MedianFilter → MovingAverageFilter → ParticleFilter
  ├── Generic Sensor API → GenericSensorManager
  │     ├── LinearAccelerationSensor → injects into MotionSensor pipeline
  │     └── Magnetometer → onMagAnomaly callback
  ├── VibrationHammer: navigator.vibrate() → accel ring-down → FFT → resonant freq
  ├── AudioAnalyzer: getUserMedia → FFT (16384-pt, 16-frame avg) → resonant freq
  └── TouchSensor: touch events → contact force/area

All sensors call BayesianFusion.update(name, grams, confidence)
  └── BayesianFusion._fuse() → ExpSmooth → onFused(grams, confidence)
        └── PhonewayApp._onFused() → display + stability + accuracy + verify panel
```

### Module Responsibilities

| File | Responsibility |
|------|---------------|
| `js/app.js` | `PhonewayApp` class — boots everything, owns state machine, calibration wizard, UI event binding, verify panel |
| `js/sensors.js` | `MotionSensor` (DeviceMotion + filter pipeline), `TouchSensor`, `BayesianFusion`, `BaselineRecorder` |
| `js/kalman.js` | All math primitives: `AdaptiveKalmanFilter`, `ParticleFilter`, `MovingAverageFilter`, `MedianFilter`, `ExpSmooth`, `KalmanFilter2D`, `FFT`, `WindowFn` |
| `js/audio.js` | `AudioAnalyzer` — mic → Blackman-Harris windowed FFT → resonant frequency → mass estimate |
| `js/vibrationHammer.js` | `VibrationHammer` — vibration motor excite → accel ring-down capture → FFT → resonant freq → mass |
| `js/genericSensors.js` | `GenericSensorManager` — Generic Sensor API: `LinearAccelerationSensor`, `Magnetometer`, `Gyroscope`; gyroscope tilt mass via `ComplementaryFilter` |
| `js/cameraSensor.js` | `CameraSensor` — camera optical-flow MAD → FFT → resonant freq → mass; hammer-sync capture; audio sonar cross-validation |
| `js/display.js` | `SevenSegmentDisplay`, `StabilityBar`, `LED`, `AccuracyDisplay` — all pure DOM, no external deps |
| `js/referenceWeights.js` | `REF_WEIGHTS` database (14 everyday objects), `ReferenceWeightVerifier` — live compare + history |
| `css/style.css` | All styling — gold/black head-shop aesthetic, neon green 7-seg display |
| `sw.js` | Cache-first service worker — bump `CACHE` constant when assets change |

### State Machine (`PhonewayApp.state`)
`IDLE` → `CALIBRATING` → `READY` ↔ `MEASURING` ↔ `STABLE`
Also: `ZEROING` (tare in progress), `OFF` (power button)

Stability detection: rolling buffer of `STABLE_WIN=30` fused readings; declared stable when variance < `STABLE_THR=0.15` g.

### Calibration Flow
3-step wizard in `_runFullCalibration()`:
1. **Zero baseline** — 200 accelerometer samples → `BaselineRecorder` → `MotionSensor.setBaseline()`; + vibration hammer calibration (6 strikes) + audio baseline
2. **First weight** — 4-second average of `deltaA`; `MotionSensor.addCalPoint(grams, deltaA)`
3. **Second weight** (optional) — prompts for a complementary coin; least-squares fit for sensitivity

Sensitivity (g per m/s²) stored to `localStorage` key `phoneway_v2`.

`phoneMass` defaults to 170 g when not yet calibrated (used by both `VibrationHammer` and `AudioAnalyzer` for the resonance formula).

Append `?cal` to the URL to force the calibration onboard flow immediately on load.

### Sensor Fusion Weights (prior reliability)
`accel=1.0`, `hammer=0.9`, `audio=0.8`, `gyro=0.75`, `cam=0.60`, `touch=0.35`, `mag=0.3`

Confidence from each sensor multiplied by its prior → weighted average in `BayesianFusion._fuse()`.

### Accuracy % Formula
```
accuracy = conf*0.40 + stability*0.35 + calScore*0.15 + surfaceScore*0.10
```
Surface quality (`poor`/`ok`/`good`/`excellent`) derived from calibration sensitivity value.

## Key Patterns

**Sensor callbacks** — all sensors use `onWeight(grams, confidence)` and `onRaw(ax, ay, az)` callbacks set by `app.js`. Never call display code from sensor modules.

**Sensor mode cycling** — the mode button cycles through `MODES = ['FUSION', 'ACCEL', 'AUDIO', 'HAMMER', 'TOUCH', 'GYRO', 'CAM']`. `FUSION` uses all sources; the others isolate a single source for diagnostics.

**Generic Sensor confidence boost** — when `LinearAccelerationSensor` is available (Android Chrome), its readings are injected into the `accel` fusion slot at confidence 0.85, bypassing the software gravity-removal baseline.

**Camera sensor** — `CameraSensor` is started alongside mic in `_startAllSensors()`. It runs a background `setInterval` at 30 fps. `beginHammerCapture()` / `endHammerCapture()` are called in `_runHammerMeasure()` to sync optical flow analysis with the hammer window (camera+vibration combo). `validateWithAudio(freq)` is called from `audio.onWeight` for mic+camera sonar cross-validation.

**Gyroscope tilt mass** — `GenericSensorManager._updateGyroDerived()` fuses gyro angular velocity with gravity sensor using `ComplementaryFilter` (α=0.96) to get a clean tilt estimate. Tilt delta from baseline → mass via `motionSensitivity × 9.81`. Only fires `onGyroMass` when both gyroscope AND GravitySensor are available.

**Multi-sensor consensus bonus** — in `_onFused()`, if 3+ sensors have estimates within 20% of each other, accuracy display gets a +5% bonus. This rewards genuine multi-sensor agreement.

**localStorage keys:**
- `phoneway_v2` — calibration settings (includes `cameraBaselineFreq`)
- `phoneway_savedRef` — user-locked reference weight (grams)
- `phoneway_verifyHistory` — last 10 verify sessions

**ES modules only** — `index.html` loads `js/app.js` as `type="module"`; all other JS files are imported from there. No bundler, no transpilation.


**Permissions required at runtime:** `devicemotion` (iOS needs explicit request), `microphone` (audio), `accelerometer`/`gyroscope`/`magnetometer` (Generic Sensor API). `vercel.json` sets the `Permissions-Policy` header to allow all of these.

**Service worker** — cache-first strategy for full offline support. Must increment `CACHE` constant in `sw.js` whenever JS/CSS/HTML files change to force clients to update.

## Physics Background

**Accelerometer method** — phone on soft surface = spring-mass system. Added mass compresses surface → phone tilts → horizontal acceleration change `ΔA`. With calibration: `weight = ΔA × sensitivity`.

**Resonance methods (audio + hammer)** — both use: `m_added = m_phone × ((f_empty/f_loaded)² − 1)`. VibrationHammer searches 1–28 Hz; AudioAnalyzer searches 20–1200 Hz.

**Surface quality** — measured by calibration sensitivity. Higher sensitivity = softer surface = better deflection detection. Ratings: `<30` = poor, `<100` = ok, `<300` = good, `≥300` = excellent.
