/**
 * Audio alerts via Web Audio (no sound files to cache) + speech + vibration.
 * Browsers block audio until a user gesture: call unlockAudio() from the
 * "Start ride" button tap, otherwise the first alert will be silent.
 * Speech output goes through to a Bluetooth helmet intercom like any media audio.
 */
let ctx = null;

export function unlockAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  // iOS also needs speechSynthesis primed inside a gesture.
  if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
}

function beep(freq, startAt, dur = 0.15) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  // Short attack/release envelope avoids clicks.
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.25, startAt + 0.01);
  gain.gain.linearRampToValueAtTime(0, startAt + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

const SPOKEN = {
  speed_camera: 'Speed camera',
  redlight_camera: 'Red light camera',
  buslane_camera: 'Bus lane camera',
  enforcement_zone: 'Enforcement zone',
};

export function playCameraAlert(cam) {
  if (ctx) {
    const t = ctx.currentTime;
    // Three rising tones – distinct from typical phone notification sounds.
    [880, 1100, 1320].forEach((f, i) => beep(f, t + i * 0.2));
  }
  navigator.vibrate?.([200, 100, 200]);
  if ('speechSynthesis' in window) {
    const dist = Math.round(cam.distance / 50) * 50;
    let text = `${SPOKEN[cam.type] || 'Camera'} in ${dist} metres`;
    if (cam.maxspeed) text += `, limit ${cam.maxspeed}`;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    setTimeout(() => window.speechSynthesis.speak(u), 700);
  }
}
