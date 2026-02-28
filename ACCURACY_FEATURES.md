# Phoneway v3.0 — Ultra-Precision Features

## Target Accuracy: ±0.1g (0.05g 1σ)

---

## 🎯 Key Features

### 1. Multi-Sensor Fusion (15+ Sensors)

| Sensor | Purpose | Confidence Weight |
|--------|---------|-------------------|
| Linear Accelerometer | Primary weight detection | 1.0 |
| Vibration Hammer | Resonance frequency shift | 0.9 |
| Audio FFT | Microphone resonance analysis | 0.8 |
| Gyroscope | Tilt-based mass estimation | 0.75 |
| Camera Optical Flow | Visual vibration analysis | 0.6 |
| Touch Force | Contact pressure | 0.35 |
| Magnetometer | Metal object detection | 0.3 |
| Barometer | Environmental stability | 0.15 |
| Battery Monitor | Thermal compensation | 0.1 |
| Orientation Sensor | Positioning quality | 0.2 |

### 2. Advanced Algorithms

#### Particle Filter Fusion
- 500 particles for non-Gaussian noise handling
- Multi-modal distribution support
- Outlier-resistant estimation

#### Neural Network Corrector
- On-device lightweight MLP (12→24→16→1)
- 12 input features from all sensors
- Online learning from verified measurements
- Self-improving with each verification

#### Sensor Agreement Detection
- Real-time outlier detection
- Multi-sensor consensus voting
- Automatic sensor weight adjustment

#### Environmental Compensation
- Barometric pressure tracking
- Battery thermal drift compensation
- Orientation quality scoring
- Time-based drift correction

### 3. Self-Learning System

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  User Verifies  │───→│  Error Logged   │───→│  ML Training    │
│  Known Weight   │    │  Global + Local │    │  NN + Ensemble  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                                            │
         └────────────────────────────────────────────┘
                            │
                    ┌───────▼────────┐
                    │  Auto-Correct  │
                    │  Future Reads  │
                    └────────────────┘
```

### 4. Accuracy Grading System

| Grade | Precision | Description |
|-------|-----------|-------------|
| A+ | ±0.03g | Laboratory quality |
| A | ±0.05g | Target achieved |
| B+ | ±0.1g | Excellent |
| B | ±0.2g | Good |
| C | ±0.5g | Fair |
| D | >0.5g | Needs calibration |

---

## 📊 How to Achieve 0.1g Accuracy

### 1. Optimal Setup
- **Surface**: Mouse pad or thick notebook (soft, compliant)
- **Position**: Phone flat, not tilted (>95% orientation quality)
- **Environment**: Stable temperature, no charging
- **Rest**: 5 minutes after charging

### 2. Calibration
1. Use a **US Nickel (5.00g)** as primary reference
2. Add a **Dollar Bill (1.00g)** for 2-point calibration
3. Perform calibration on intended weighing surface
4. Re-calibrate weekly or when accuracy degrades

### 3. Verification
- Use known weights periodically
- At least 5 verifications trains the neural network
- Each verification improves future accuracy

### 4. Ultra-Precision Mode
- Press **0.1g** button for extended measurement
- Waits for optimal environmental conditions
- Targets ±0.05g precision
- May take 5-15 seconds

---

## 🧠 Machine Learning Features

### Error Logging
Every verified measurement logs:
- Expected vs measured weight
- Error magnitude and direction
- Sensor modes active
- Environmental conditions
- Battery level and thermal state

### Adaptive Calibration
- Learns device-specific response curves
- Corrects for non-linearity
- Compensates for sensor drift
- Temperature-aware corrections

### Community Priors
- Phone mass buckets (60-300g)
- Suggested sensitivity values
- Surface recommendations
- Regional coin specifications

---

## 🔧 Technical Architecture

### New Modules

```
js/
├── mlCalibration.js       # Neural network + ensemble
├── advancedFusion.js      # Particle filter + agreement
├── environmentalSensors.js # Barometer + battery + orientation
├── ultraPrecision.js      # High-precision measurement engine
└── app.js                 # Main app (updated)

data/
├── error-logger.js        # Global error logging system
└── community-priors.json  # Crowd-sourced calibration data
```

### Data Flow

```
Raw Sensors → Kalman Filter → Feature Extraction
                                    ↓
Particle Filter ← Sensor Agreement ← Fusion
        ↓
Neural Network Correction
        ↓
Environmental Compensation
        ↓
Final Weight (0.1g accuracy target)
```

---

## 📈 Performance Metrics

### Tracking
- Real-time precision (σ) display
- Accuracy grade indicator
- ML training sample count
- Environmental stability score
- Per-sensor reliability ratings

### Reports
Access via **STATS** button:
- Current accuracy grade
- Precision statistics
- Systematic error tracking
- ML model status
- Environmental status
- Recommendations for improvement
- Export data as JSON

---

## 🌍 Self-Learning & Crowd Intelligence

### Local Learning
- Device-specific calibration curves
- User behavior adaptation
- Error pattern recognition
- Continuous improvement

### Global Learning (Optional)
- Anonymous error aggregation
- Regional accuracy patterns
- Surface quality database
- Phone model correlations

---

## 🎮 UI Elements

### New Buttons
- **0.1g**: Ultra-precision measurement
- **STATS**: Accuracy report panel
- **VERIFY**: Known-weight verification

### Status Indicators
- **σ**: Real-time precision (mg/g)
- **ML**: Verification count
- **GRADE**: A+ to D accuracy grade
- **SURFACE**: Quality assessment

### Panels
- **Accuracy Report**: Comprehensive metrics
- **Verify Panel**: Known-weight testing
- **Calibration**: Step-by-step setup

---

## 🔬 Validation Testing

Recommended test protocol:
1. Calibrate with nickel (5g) + bill (1g)
2. Verify with 10 different known weights
3. Check environmental stability >90%
4. Run ultra-precision mode 5 times
5. Confirm grade A or A+

---

## ⚠️ Limitations

### Physical Constraints
- Maximum weight: ~100-200g (phone-dependent)
- Minimum weight: ~0.1g (surface-dependent)
- Requires compliant (springy) surface
- Not for commercial/legal trade

### Environmental
- Temperature changes affect accuracy
- Air currents can disturb small weights
- Phone must remain flat
- Avoid during charging

---

## 🚀 Future Enhancements

Planned features for v3.1:
- Multiple phone networking (distributed sensors)
- Cloud-based model training
- Advanced thermal modeling
- Magnetic interference compensation
- Weight prediction from partial data

---

## 📚 References

- Spring-mass physics model
- Kalman filtering techniques
- Particle filter estimation
- Neural network regression
- Sensor fusion algorithms

---

**Created**: 2026-02-28  
**Version**: 3.0 Ultra-Precision  
**Target**: ±0.1g accuracy through machine learning
