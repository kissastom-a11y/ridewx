/** Customisable presets. Everything here can be overridden per rider in Ρυθμίσεις. */

export const BIKES = [
  { id: 'ostro-vam-2', label: 'Factor Ostro VAM 2', kg: 7.2, aeroFactor: 0.96, note: 'Aero πλαίσιο, ~7,2 kg έτοιμο (με πεντάλ)' },
  { id: 'aero', label: 'Aero road (γενικό)', kg: 7.8, aeroFactor: 0.96 },
  { id: 'allround', label: 'All-round / climbing', kg: 7.4, aeroFactor: 1.0 },
  { id: 'endurance', label: 'Endurance', kg: 8.5, aeroFactor: 1.01 },
  { id: 'alu', label: 'Αλουμίνιο εκκίνησης', kg: 9.5, aeroFactor: 1.02 },
  { id: 'tt', label: 'TT / Triathlon', kg: 8.8, aeroFactor: 0.88 },
  { id: 'custom', label: 'Άλλο (χειροκίνητα)', kg: 8, aeroFactor: 1 },
];

export const SURFACES = [
  { id: 'smooth', label: 'Λεία νέα άσφαλτος', crr: 0.0035 },
  { id: 'good', label: 'Καλή άσφαλτος', crr: 0.0045 },
  { id: 'worn', label: 'Παλιά / τραχιά άσφαλτος', crr: 0.0058 },
  { id: 'rough', label: 'Μπαλώματα / τσιμέντο', crr: 0.0075 },
];

export const DEFAULT_RIDER = {
  id: 'r1',
  name: 'Αναβάτης 1',
  riderKg: 62,
  weightConfirmed: false,
  heightCm: 163,
  ftp: 190,
  bikeId: 'ostro-vam-2',
  bikeKg: 7.2,
  aeroFactor: 0.96,
  kitKg: 1.5, // ρούχα, παπούτσια, κράνος, παγούρια, εργαλεία
  position: 'hoods',
  cdaOverride: 0,
  surface: 'good',
  crr: 0.0045,
  eta: 0.975,
  exposure: 'rural',
  maxPedalKmh: 55,
  maxDescentKmh: 65,
  maxClimbPct: 1.15,
  pacingBeta: 0.3,
  stopsMin: 1,
};

export const DIRECTOR_ROUTE = {
  name: 'Αρτέμιδα → Coffee Berry Πόρτο Ράφτη',
  from: 'Γεωργίου Παπανδρέου 45, Αρτέμιδα',
  via: ['Λεωφόρος Βραυρώνος, Βραυρώνα', 'Λεωφόρος Πόρτο Ράφτη, Μαρκόπουλο'],
  to: 'Αγίας Μαρίνας 1, Πόρτο Ράφτη',
  targetMin: 40,
};
