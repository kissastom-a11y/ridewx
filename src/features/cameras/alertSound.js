/**
 * Audio alerts via Web Audio (no sound files to cache) + speech + vibration.
 * Browsers block audio until a user gesture: call unlockAudio() from the
 * "Start ride" button tap, otherwise the first alert will be silent.
 * Speech output goes through to a Bluetooth helmet intercom like any media audio.
 */
import { say, unlockVoice, GR } from '../../lib/voice.js';

let ctx = null;

/** Shared AudioContext (created in the Start-ride tap) – the engine monitor reuses it. */
export const getAudioContext = () => ctx;

export function unlockAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  // iOS also needs speechSynthesis primed inside a gesture.
  unlockVoice();
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

export function playCameraAlert(cam) {
  if (ctx) {
    const t = ctx.currentTime;
    // Three rising tones – distinct from typical phone notification sounds.
    [880, 1100, 1320].forEach((f, i) => beep(f, t + i * 0.2));
  }
  navigator.vibrate?.([200, 100, 200]);
  setTimeout(() => say(GR.camera(cam.distance, cam.maxspeed), { urgent: true }), 700);
}

/** Short two-tone chime + spoken message (tunnel / dirt-road warnings). */
export function announce(text) {
  if (ctx) {
    const t = ctx.currentTime;
    beep(660, t, 0.18);
    beep(990, t + 0.22, 0.25);
  }
  navigator.vibrate?.([150, 80, 150]);
  setTimeout(() => say(text, { urgent: true }), 550);
}
