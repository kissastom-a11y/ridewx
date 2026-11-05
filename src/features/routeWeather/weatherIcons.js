/** WMO weather code → emoji + short text. Night variants between 19:00 and 07:00 local. */
import { t, lang } from '../../lib/i18n.js';
export function weatherIcon(code, unix) {
  const h = unix ? new Date(unix * 1000).getHours() : 12;
  const night = h < 7 || h >= 19;
  if (code === 0) return night ? '🌙' : '☀️';
  if (code === 1 || code === 2) return night ? '☁️' : '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

export function weatherText(code) {
  if (code === 0) return t('Clear sky');
  if (code === 1) return t('Mostly clear');
  if (code === 2) return t('Partly cloudy');
  if (code === 3) return t('Overcast');
  if (code === 45 || code === 48) return t('Fog');
  if (code >= 51 && code <= 57) return t('Drizzle');
  if (code >= 61 && code <= 67) return t('Rain');
  if (code >= 71 && code <= 77) return t('Snow');
  if (code >= 80 && code <= 82) return t('Showers');
  if (code === 85 || code === 86) return t('Snow showers');
  if (code >= 95) return t('Thunderstorm');
  return '';
}

/** Compass point for a FROM direction. */
export function compass(deg) {
  return (lang() === 'el' ? ['Β', 'ΒΑ', 'Α', 'ΝΑ', 'Ν', 'ΝΔ', 'Δ', 'ΒΔ'] : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
