/** (v4.1) If anything crashes while rendering, show what happened and a reset button – never a blank page. */
import { t } from '../lib/i18n.js';
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  reset = async () => {
    try {
      const rs = (await navigator.serviceWorker?.getRegistrations()) || [];
      await Promise.all(rs.map((r) => r.unregister()));
      const ks = (await window.caches?.keys()) || [];
      await Promise.all(ks.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-slate-900 p-6 text-center text-slate-100">
        <div className="text-5xl">🛠️</div>
        <h1 className="text-lg font-bold">{t('Oops – something went wrong')}</h1>
        <p className="max-w-sm text-sm text-slate-400">{t('Send a screenshot of this screen so it can be fixed:')}</p>
        <pre className="max-w-full overflow-auto rounded bg-slate-800 p-3 text-left text-xs text-red-300">{String(this.state.error?.message || this.state.error)}</pre>
        <button onClick={this.reset} className="rounded-lg bg-sky-600 px-5 py-2.5 font-semibold">{t('Reset app')}</button>
      </div>
    );
  }
}
