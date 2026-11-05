/**
 * Vehicle presets – typical values incl. driver/rider. Pick the closest once;
 * fill-up calibration then tunes it to YOUR vehicle.
 *   CdA  = drag area (m²)  ·  Crr = rolling-resistance coefficient
 *   idle = fuel at idle (L/h)  ·  acc = accessories (kW: alternator, A/C average)
 *   kind = which microphone band the engine monitor listens to
 */
export const PRESETS = [
  { id: 'scooter', icon: '🛵', label: 'Scooter 125–300', kind: 'moto', massKg: 190, CdA: 0.55, Crr: 0.016, fuel: 'petrol', etaEngine: 0.25, etaDrive: 0.85, accKw: 0.1, idleLph: 0.15 },
  { id: 'naked', icon: '🏍️', label: 'Naked / commuter bike', kind: 'moto', massKg: 260, CdA: 0.6, Crr: 0.017, fuel: 'petrol', etaEngine: 0.27, etaDrive: 0.92, accKw: 0.15, idleLph: 0.3 },
  { id: 'touring', icon: '🏍️', label: 'Sport / touring bike 1000+', kind: 'moto', massKg: 340, CdA: 0.5, Crr: 0.018, fuel: 'petrol', etaEngine: 0.28, etaDrive: 0.92, accKw: 0.2, idleLph: 0.45 },
  { id: 'smallcar', icon: '🚗', label: 'Small car (petrol)', kind: 'car', massKg: 1150, CdA: 0.62, Crr: 0.010, fuel: 'petrol', etaEngine: 0.30, etaDrive: 0.90, accKw: 0.5, idleLph: 0.6 },
  { id: 'compact', icon: '🚗', label: 'Compact / family car (petrol)', kind: 'car', massKg: 1400, CdA: 0.65, Crr: 0.010, fuel: 'petrol', etaEngine: 0.30, etaDrive: 0.90, accKw: 0.6, idleLph: 0.7 },
  { id: 'compactd', icon: '🚗', label: 'Compact / family car (diesel)', kind: 'car', massKg: 1450, CdA: 0.65, Crr: 0.010, fuel: 'diesel', etaEngine: 0.36, etaDrive: 0.90, accKw: 0.6, idleLph: 0.6 },
  { id: 'suv', icon: '🚙', label: 'SUV (petrol)', kind: 'car', massKg: 1700, CdA: 0.85, Crr: 0.011, fuel: 'petrol', etaEngine: 0.30, etaDrive: 0.88, accKw: 0.7, idleLph: 0.9 },
  { id: 'suvd', icon: '🚙', label: 'SUV (diesel)', kind: 'car', massKg: 1800, CdA: 0.85, Crr: 0.011, fuel: 'diesel', etaEngine: 0.36, etaDrive: 0.88, accKw: 0.7, idleLph: 0.8 },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || null;
