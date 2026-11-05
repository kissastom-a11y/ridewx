/**
 * Tap-to-talk speech recognition (Web Speech API).
 * Chrome on Android and Safari on iPhone support it; speech is turned into text
 * by the phone's own recogniser service (Google / Apple), in Greek or English.
 * We stop the app's own voice first so it doesn't hear itself.
 */
import { useCallback, useRef, useState } from 'react';
import { lang } from '../../lib/i18n.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const speechCommandsSupported = !!SR;

export function useSpeechCommands(onCommand) {
  const [state, setState] = useState({ listening: false, interim: '', heard: '', error: null });
  const recRef = useRef(null);
  const cbRef = useRef(onCommand);
  cbRef.current = onCommand;

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch { /* idle */ } }, []);

  const start = useCallback(() => {
    if (!SR) { setState((s) => ({ ...s, error: 'unsupported' })); return; }
    if (recRef.current) { stop(); return; } // second tap = cancel
    window.speechSynthesis?.cancel();
    const rec = new SR();
    rec.lang = lang() === 'el' ? 'el-GR' : 'en-GB';
    rec.interimResults = true;
    rec.maxAlternatives = 4;
    rec.continuous = false;
    rec.onstart = () => setState({ listening: true, interim: '', heard: '', error: null });
    rec.onresult = (e) => {
      const res = e.results[e.results.length - 1];
      const alts = Array.from(res).map((a) => a.transcript);
      if (res.isFinal) {
        setState((s) => ({ ...s, interim: '', heard: alts[0] }));
        setTimeout(() => setState((s) => (s.heard === alts[0] ? { ...s, heard: '' } : s)), 4000);
        cbRef.current?.(alts);
      } else {
        setState((s) => ({ ...s, interim: alts[0] }));
      }
    };
    rec.onerror = (e) => setState((s) => ({ ...s, error: e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' ? 'nospeech' : e.error }));
    rec.onend = () => { recRef.current = null; setState((s) => ({ ...s, listening: false, interim: '' })); };
    recRef.current = rec;
    try { rec.start(); } catch { recRef.current = null; }
  }, [stop]);

  return { ...state, start, stop };
}
