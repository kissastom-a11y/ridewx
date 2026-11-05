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
const FEMALE = /melina|μελίνα|athina|αθηνά|female|γυναίκα|el-gr-x-.*#female|elf|-f-/i;
const MALE = /nikos|νίκος|stefanos|στέφανος|male(?!.*female)/i;

let chosen = null;
let enabled = true;
let speaking = false;
const queue = [];

function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const greek = voices.filter((v) => /^el(-|_|$)/i.test(v.lang));
  return greek.find((v) => FEMALE.test(v.name)) || greek.find((v) => !MALE.test(v.name)) || greek[0] || null;
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
  u.lang = 'el-GR';
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
export function say(text, { urgent = false } = {}) {
  if (!enabled || !text || !('speechSynthesis' in window)) return;
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
