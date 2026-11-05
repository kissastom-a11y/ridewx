/** Spoken answers to voice questions, in the chosen language. */
import { lang } from '../../lib/i18n.js';
import { distText } from '../../lib/voice.js';

const el = () => lang() === 'el';
const num = (x, d = 1) => (el() ? x.toFixed(d).replace('.', ',') : x.toFixed(d));
const time = (unix) => new Date(unix * 1000).toLocaleTimeString(el() ? 'el-GR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const REPLY = {
  goingTo: (name, min, id) => {
    if (el()) {
      const where = id === 'home' ? 'Πάμε σπίτι!' : id === 'work' ? 'Πάμε για δουλειά!' : `Πάμε για ${name}.`;
      return `${where} Περίπου ${min} λεπτά.`;
    }
    const where = id === 'home' ? 'Heading home!' : id === 'work' ? 'Heading to work!' : `Heading to ${name}.`;
    return `${where} About ${min} minutes.`;
  },
  searching: (q) => (el() ? `Ψάχνω διαδρομή για ${q}.` : `Finding a route to ${q}.`),
  notFound: (q) => (el() ? `Δεν βρήκα το ${q}. Δοκιμάστε ξανά.` : `I couldn't find ${q}. Please try again.`),
  placeUnset: (id) => (el()
    ? `Δεν έχετε ορίσει ${id === 'home' ? 'σπίτι' : 'δουλειά'}. Ορίστε το στην καρτέλα Σχεδίαση.`
    : `You haven't set ${id === 'home' ? 'home' : 'work'} yet. Set it in the Plan tab.`),
  fuel: (f) => {
    if (!f) return el() ? 'Επιλέξτε πρώτα το όχημά σας στην καρτέλα Διαδρομή.' : 'Choose your vehicle first in the Ride tab.';
    const now = f.overrun ? (el() ? 'Αυτή τη στιγμή δεν καίτε καύσιμο' : "Right now you're using no fuel")
      : f.l100 != null ? (el() ? `Τώρα καίτε ${num(f.l100)} λίτρα στα 100` : `Right now you're using ${num(f.l100)} litres per 100`)
        : (el() ? `Στο ρελαντί καίτε ${num(f.lph, 2)} λίτρα την ώρα` : `At idle you're using ${num(f.lph, 2)} litres an hour`);
    const trip = f.avgL100 != null
      ? (el() ? `. Σε αυτή τη διαδρομή ${num(f.tripL, 1)} λίτρα, μέσος όρος ${num(f.avgL100)}.` : `. This trip ${num(f.tripL, 1)} litres, average ${num(f.avgL100)}.`)
      : '.';
    return now + trip;
  },
  weatherDest: (name, unix, w, text) => (el()
    ? `Στον προορισμό στις ${time(unix)}: ${Math.round(w.temperature)} βαθμοί, ${text.toLowerCase()}. Άνεμος ${Math.round(w.windSpeed)}, ριπές ${Math.round(w.windGusts)}.`
    : `At your destination at ${time(unix)}: ${Math.round(w.temperature)} degrees, ${text.toLowerCase()}. Wind ${Math.round(w.windSpeed)}, gusts ${Math.round(w.windGusts)}.`),
  weatherHere: (w) => (el()
    ? `Εδώ ${Math.round(w.temperature)} βαθμοί, άνεμος ${Math.round(w.speed)} με ριπές ${Math.round(w.gusts)}.`
    : `Here it's ${Math.round(w.temperature)} degrees, wind ${Math.round(w.speed)} gusting ${Math.round(w.gusts)}.`),
  rainAhead: (km) => (el() ? ` Βροχή σε ${km} χιλιόμετρα.` : ` Rain in ${km} kilometres.`),
  wind: (a, w) => {
    const from = { head: el() ? 'από μπροστά' : 'from ahead', tail: el() ? 'από πίσω' : 'from behind', cross: a.side === 'left' ? (el() ? 'από αριστερά' : 'from the left') : (el() ? 'από δεξιά' : 'from the right') }[a.quadrant];
    return el() ? `Άνεμος ${Math.round(w.speed)} ${from}, ριπές ${Math.round(w.gusts)}.` : `Wind ${Math.round(w.speed)} ${from}, gusts ${Math.round(w.gusts)}.`;
  },
  noWind: () => (el() ? 'Δεν έχω ακόμη στοιχεία ανέμου. Ξεκινήστε διαδρομή.' : "I don't have wind data yet. Start a ride."),
  eta: (unix, leftM) => (el() ? `Φτάνετε περίπου στις ${time(unix)}, σε ${distText(leftM)}.` : `You'll arrive around ${time(unix)}, in ${distText(leftM)}.`),
  noRoute: () => (el() ? 'Δεν υπάρχει ενεργή διαδρομή. Πείτε για παράδειγμα «πάμε σπίτι».' : 'No active route. Try saying "take me home".'),
  limit: (k) => (k ? (el() ? `Το όριο εδώ είναι ${k}.` : `The limit here is ${k}.`) : (el() ? 'Δεν ξέρω το όριο σε αυτόν τον δρόμο.' : "I don't know the limit on this road.")),
  ok: () => (el() ? 'Εντάξει.' : 'OK.'),
  muted: () => (el() ? 'Σίγαση.' : 'Muted.'),
  stopped: () => (el() ? 'Τέλος διαδρομής. Καλή συνέχεια!' : 'Ride ended. See you next time!'),
  help: () => (el()
    ? 'Μπορείτε να πείτε: πάμε σπίτι, πήγαινε στην Κηφισιά, πόση βενζίνη καίω, τι καιρό έχει, πόσο αέρα έχει, πότε φτάνω, πού στρίβω, σίγαση, σταμάτα.'
    : 'You can say: take me home, go to Kifisia, how much fuel, what is the weather, how windy is it, when do I arrive, where do I turn, mute, stop.'),
  unknown: (heard) => (el() ? `Δεν κατάλαβα «${heard}». Πείτε «βοήθεια» για παραδείγματα.` : `I didn't catch "${heard}". Say "help" for examples.`),
};
