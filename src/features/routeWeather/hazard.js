/**
 * Hazard classification for a single waypoint weather sample.
 * Level 0 = clear, 1 = caution, 2 = warning, 3 = danger. Thresholds are tuned
 * for two-wheelers (the more vulnerable case); a car driver can read level 1
 * as informational.
 */
export const HAZARD_COLORS = ['#22c55e', '#eab308', '#f97316', '#dc2626'];
export const HAZARD_LABELS = ['Clear', 'Caution', 'Warning', 'Danger'];

// WMO weather-interpretation codes used by Open-Meteo.
const isFogCode = (c) => c === 45 || c === 48; // 48 = depositing rime fog
const isSnowCode = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const isFreezingCode = (c) => c === 56 || c === 57 || c === 66 || c === 67;
const isThunderCode = (c) => c >= 95;

export function classifyHazard(w) {
  const reasons = [];
  let level = 0;
  const bump = (l, why) => { level = Math.max(level, l); reasons.push(why); };

  // Precipitation (mm/h)
  if (w.precipitation >= 4) bump(3, `Heavy rain ${w.precipitation.toFixed(1)} mm/h`);
  else if (w.precipitation >= 1) bump(2, `Rain ${w.precipitation.toFixed(1)} mm/h`);
  else if (w.precipitation >= 0.2) bump(1, 'Light rain / wet road');

  // Visibility (m) – fog
  if (w.visibility != null) {
    if (w.visibility < 200) bump(3, `Dense fog, vis ${Math.round(w.visibility)} m`);
    else if (w.visibility < 1000) bump(2, `Fog, vis ${Math.round(w.visibility)} m`);
    else if (w.visibility < 3000) bump(1, 'Reduced visibility');
  }
  if (isFogCode(w.weatherCode) && level < 2) bump(2, w.weatherCode === 48 ? 'Freezing fog' : 'Fog');

  // Temperature – road ice. Road surface can freeze with air temp up to ~+3 °C.
  if (w.temperature <= 0) bump(3, `Freezing ${w.temperature.toFixed(0)} °C – ice risk`);
  else if (w.temperature <= 3) bump(2, `${w.temperature.toFixed(0)} °C – possible black ice`);
  else if (w.temperature <= 7) bump(1, `Cold ${w.temperature.toFixed(0)} °C – low tyre grip`);

  // Codes that are dangerous on their own
  if (isFreezingCode(w.weatherCode)) bump(3, 'Freezing rain/drizzle');
  if (isSnowCode(w.weatherCode)) bump(3, 'Snow');
  if (isThunderCode(w.weatherCode)) bump(3, 'Thunderstorm');

  // Gusts (route-level; the heading-aware crosswind check is Feature 2)
  if (w.windGusts >= 60) bump(3, `Gusts ${Math.round(w.windGusts)} km/h`);
  else if (w.windGusts >= 45) bump(2, `Gusts ${Math.round(w.windGusts)} km/h`);

  return { level, reasons };
}
