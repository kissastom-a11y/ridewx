/**
 * voice.js – one Greek, friendly female voice for everything the app says.
 *
 * Browsers expose the phone's own text-to-speech voices. We pick, in order:
 *   1. a Greek (el-*) voice whose name is a known female voice
 *      (iOS "Melina", Microsoft "Athina", Google voices labelled female)
 *   2. any Greek voice that is NOT a known male voice ("Nikos", "Stefanos")
 *   3. any Greek voice
 * and speak with a slightly raised pitch and an unhurried rate – clear over
 * engine and wind noise, without sounding robotic.
 *
 * If the phone has no Greek voice installed, speech falls back to the
 * default voice (still reading Greek text) and the app shows a tip to install
 * one (Android: Settings → Text-to-speech → Google → Greek; iOS: Settings →
 * Accessibility → Spoken Content → Voices → Greek → Melina).
 *
 * A small queue with priorities: urgent messages (turn now, camera, speeding)
 * cut in front; routine ones wait. `isSpeaking()` lets the engine-sound monitor
 * ignore the app's own voice.
 */
import { lang } from './i18n.js';

// Known female / male system voices (iOS, Android/Google, Windows/Edge).
const FEMALE = /melina|μελίνα|athina|αθηνά|samantha|karen|serena|moira|tessa|victoria|fiona|kate|zira|aria|jenny|libby|sonia|hazel|susan|female|γυναίκα|#female|-f-/i;
const MALE = /nikos|νίκος|stefanos|στέφανος|daniel|alex|fred|david|mark|guy|ryan|george|oliver|thomas|arthur|male(?!.*female)/i;

let chosen = null;
let enabled = true;
let speaking = false;
const queue = [];

function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const re = lang() === 'el' ? /^el(-|_|$)/i : /^en(-|_|$)/i;
  const mine = voices.filter((v) => re.test(v.lang));
  // English: prefer British/US voices in that order after the female check.
  return mine.find((v) => FEMALE.test(v.name)) || mine.find((v) => !MALE.test(v.name)) || mine[0] || null;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  chosen = pickVoice();
  window.speechSynthesis.onvoiceschanged = () => { chosen = pickVoice(); };
}

export const hasGreekVoice = () => !!(chosen || pickVoice());
export const voiceName = () => (chosen || pickVoice())?.name || null;
export const isSpeaking = () => speaking || (typeof window !== 'undefined' && window.speechSynthesis?.speaking);
export function setVoiceEnabled(on) {
  enabled = on;
  if (!on) { queue.length = 0; window.speechSynthesis?.cancel(); speaking = false; }
}

function next() {
  if (speaking || !queue.length) return;
  const { text } = queue.shift();
  const u = new SpeechSynthesisUtterance(text);
  chosen = chosen || pickVoice();
  if (chosen) u.voice = chosen;
  u.lang = lang() === 'el' ? 'el-GR' : 'en-GB';
  u.rate = 0.98;
  u.pitch = 1.12;
  u.volume = 1;
  speaking = true;
  const done = () => { speaking = false; setTimeout(next, 150); };
  u.onend = done;
  u.onerror = done;
  window.speechSynthesis.speak(u);
}

/**
 * Say something in Greek.
 * @param {string} text
 * @param {{urgent?: boolean}} opts urgent = jump the queue and interrupt routine speech
 */
export function say(text, { urgent = false, force = false } = {}) {
  if ((!enabled && !force) || !text || !('speechSynthesis' in window)) return;
  if (urgent) {
    queue.length = 0;
    if (speaking) { window.speechSynthesis.cancel(); speaking = false; }
    queue.unshift({ text });
  } else {
    if (queue.length > 3) queue.shift(); // stale routine messages are worth less than fresh ones
    queue.push({ text });
  }
  next();
}

/** Must run inside a tap once (iOS) so later speech is allowed. */
export function unlockVoice() {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
  chosen = chosen || pickVoice();
}

// ─────────────────────────── Greek phrasing ───────────────────────────

/** "300 μέτρα", "1 χιλιόμετρο", "1,5 χιλιόμετρα" – rounded the way people speak. */
export function distGreek(m) {
  if (m < 1000) {
    const r = m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50;
    return `${r} μέτρα`;
  }
  const km = Math.round(m / 100) / 10;
  if (km === 1) return '1 χιλιόμετρο';
  return `${String(km).replace('.', ',')} χιλιόμετρα`;
}

const ORD = ['πρώτη', 'δεύτερη', 'τρίτη', 'τέταρτη', 'πέμπτη', 'έκτη', 'έβδομη', 'όγδοη'];

const DIR = {
  uturn: 'κάντε αναστροφή',
  'sharp right': 'στρίψτε απότομα δεξιά',
  right: 'στρίψτε δεξιά',
  'slight right': 'κρατήστε δεξιά',
  straight: 'συνεχίστε ευθεία',
  'slight left': 'κρατήστε αριστερά',
  left: 'στρίψτε αριστερά',
  'sharp left': 'στρίψτε απότομα αριστερά',
};
const SIDE = (mod) => (mod && mod.includes('left') ? 'αριστερά' : 'δεξιά');

/**
 * OSRM maneuver → Greek instruction (without the distance prefix).
 * @param {{type:string, modifier?:string, exit?:number, name?:string}} m
 */
export function maneuverGreek(m) {
  const to = m.name ? ` προς ${m.name}` : '';
  switch (m.type) {
    case 'depart': return `Ξεκινάμε${to}. Καλό ταξίδι!`;
    case 'arrive': return 'Φτάσατε στον προορισμό σας. Καλή συνέχεια!';
    case 'roundabout':
    case 'rotary':
      return m.exit ? `στον κυκλικό κόμβο, πάρτε τη ${ORD[m.exit - 1] || `${m.exit}η`} έξοδο${to}` : `μπείτε στον κυκλικό κόμβο${to}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `βγείτε από τον κυκλικό κόμβο${to}`;
    case 'fork': return `στη διχάλα, κρατήστε ${SIDE(m.modifier)}${to}`;
    case 'merge': return `ενωθείτε με την κυκλοφορία ${SIDE(m.modifier)}${to}`;
    case 'on ramp': return `πάρτε την είσοδο ${SIDE(m.modifier)}${to}`;
    case 'off ramp': return `πάρτε την έξοδο ${SIDE(m.modifier)}${to}`;
    case 'end of road': return `στο τέλος του δρόμου, ${DIR[m.modifier] || 'στρίψτε'}${to}`;
    case 'continue':
    case 'new name':
      return m.modifier && m.modifier !== 'straight' ? `${DIR[m.modifier]}${to}` : `συνεχίστε ευθεία${to}`;
    default: // turn, notification, …
      return `${DIR[m.modifier] || 'συνεχίστε'}${to}`;
  }
}

/** Full sentence with a distance prefix, e.g. "Σε 300 μέτρα, στρίψτε δεξιά προς Κηφισίας." */
export function instructionGreek(m, distM) {
  const core = maneuverGreek(m);
  if (m.type === 'arrive' || m.type === 'depart') return core;
  const cap = core.charAt(0).toUpperCase() + core.slice(1);
  if (distM == null || distM < 40) return `${cap}.`;
  return `Σε ${distGreek(distM)}, ${core}.`;
}

// ─────────────────────────── English phrasing ───────────────────────────

export function distEnglish(m) {
  if (m < 1000) {
    const r = m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50;
    return `${r} metres`;
  }
  const km = Math.round(m / 100) / 10;
  return km === 1 ? '1 kilometre' : `${km} kilometres`;
}

const ORD_EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const DIR_EN = {
  uturn: 'make a U-turn', 'sharp right': 'turn sharp right', right: 'turn right', 'slight right': 'keep right',
  straight: 'continue straight', 'slight left': 'keep left', left: 'turn left', 'sharp left': 'turn sharp left',
};
const SIDE_EN = (mod) => (mod && mod.includes('left') ? 'left' : 'right');

export function maneuverEnglish(m) {
  const to = m.name ? ` onto ${m.name}` : '';
  switch (m.type) {
    case 'depart': return `Let's go${m.name ? ` along ${m.name}` : ''}. Have a good trip!`;
    case 'arrive': return 'You have arrived at your destination. Enjoy!';
    case 'roundabout':
    case 'rotary':
      return m.exit ? `at the roundabout, take the ${ORD_EN[m.exit - 1] || `${m.exit}th`} exit${to}` : `enter the roundabout${to}`;
    case 'exit roundabout':
    case 'exit rotary': return `exit the roundabout${to}`;
    case 'fork': return `at the fork, keep ${SIDE_EN(m.modifier)}${to}`;
    case 'merge': return `merge ${SIDE_EN(m.modifier)}${to}`;
    case 'on ramp': return `take the ramp on the ${SIDE_EN(m.modifier)}${to}`;
    case 'off ramp': return `take the exit on the ${SIDE_EN(m.modifier)}${to}`;
    case 'end of road': return `at the end of the road, ${DIR_EN[m.modifier] || 'turn'}${to}`;
    case 'continue':
    case 'new name':
      return m.modifier && m.modifier !== 'straight' ? `${DIR_EN[m.modifier]}${to}` : `continue straight${to}`;
    default: return `${DIR_EN[m.modifier] || 'continue'}${to}`;
  }
}

export function instructionEnglish(m, distM) {
  const core = maneuverEnglish(m);
  if (m.type === 'arrive' || m.type === 'depart') return core;
  const cap = core.charAt(0).toUpperCase() + core.slice(1);
  if (distM == null || distM < 40) return `${cap}.`;
  return `In ${distEnglish(distM)}, ${core}.`;
}

// ─────────────────────────── language switch ───────────────────────────

export const distText = (m) => (lang() === 'el' ? distGreek(m) : distEnglish(m));
export const maneuverText = (m) => (lang() === 'el' ? maneuverGreek(m) : maneuverEnglish(m));
export const instructionText = (m, d) => (lang() === 'el' ? instructionGreek(m, d) : instructionEnglish(m, d));

/** Ready-made Greek alert sentences. */
export const GR = {
  camera: (dist, limit) => `Κάμερα ταχύτητας σε ${distGreek(dist)}${limit ? `. Όριο ${limit}` : ''}.`,
  tunnel: (len) => `Τούνελ σε 500 μέτρα, μήκους ${distGreek(len)}. Ανάψτε τα φώτα.`,
  dirt: (len) => `Χωματόδρομος σε 500 μέτρα, για ${distGreek(len)}.`,
  speeding: (limit) => `Προσοχή, το όριο είναι ${limit}.`,
  crosswind: (side, kmh) => `Δυνατός πλευρικός άνεμος από ${side === 'left' ? 'αριστερά' : 'δεξιά'}, ${Math.round(kmh)} χιλιόμετρα την ώρα.`,
  rerouting: 'Υπολογίζω νέα διαδρομή.',
  rideStart: 'Πάμε! Θα σας ενημερώνω στη διαδρομή.',
  engineLearning: 'Μαθαίνω τον ήχο του κινητήρα, για ένα λεπτό.',
  engineReady: 'Έμαθα τον ήχο του κινητήρα.',
};

/** Ready-made English alert sentences. */
export const EN = {
  camera: (dist, limit) => `Speed camera in ${distEnglish(dist)}${limit ? `. Limit ${limit}` : ''}.`,
  tunnel: (len) => `Tunnel in 500 metres, ${distEnglish(len)} long. Lights on, please.`,
  dirt: (len) => `Dirt road in 500 metres, for ${distEnglish(len)}.`,
  speeding: (limit) => `Careful, the limit is ${limit}.`,
  crosswind: (side, kmh) => `Strong crosswind from the ${side}, ${Math.round(kmh)} kilometres an hour.`,
  rerouting: 'Finding a new route.',
  rideStart: "Let's go! I'll keep you posted along the way.",
  engineLearning: "I'm learning your engine's sound, for about a minute.",
  engineReady: "Got it, I've learned your engine's sound.",
  and_then: 'and then',
  arriveIn: (d) => `In ${distEnglish(d)}, you'll reach your destination.`,
};
GR.and_then = 'και μετά';
GR.arriveIn = (d) => `Σε ${distGreek(d)}, φτάνετε στον προορισμό σας.`;

/** Phrases in the chosen language: V().tunnel(len) */
export const V = () => (lang() === 'el' ? GR : EN);
