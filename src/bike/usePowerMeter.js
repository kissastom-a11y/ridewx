/**
 * Optional real power meter over Bluetooth LE (Cycling Power Service 0x1818,
 * characteristic Cycling Power Measurement 0x2A63: flags uint16, then
 * instantaneous power sint16 in watts). Web Bluetooth works in Chrome/Edge on
 * Android & desktop – not in iOS Safari. When connected, the measured watts
 * are shown next to the estimate, and the gap is used to suggest a CdA fix.
 */
import { useCallback, useRef, useState } from 'react';

export const bluetoothSupported = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

export function usePowerMeter() {
  const [state, setState] = useState({ status: 'off', name: null, watts: null, t: null, error: null });
  const dev = useRef(null);

  const connect = useCallback(async () => {
    try {
      setState((s) => ({ ...s, status: 'connecting', error: null }));
      const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x1818] }] });
      dev.current = device;
      device.addEventListener('gattserverdisconnected', () => setState((s) => ({ ...s, status: 'off', watts: null })));
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(0x1818);
      const ch = await svc.getCharacteristic(0x2a63);
      ch.addEventListener('characteristicvaluechanged', (e) => {
        const dv = e.target.value;
        const watts = dv.getInt16(2, true);
        setState((s) => ({ ...s, watts, t: Date.now() }));
      });
      await ch.startNotifications();
      setState((s) => ({ ...s, status: 'on', name: device.name || 'Power meter' }));
    } catch (e) {
      setState((s) => ({ ...s, status: 'off', error: e.name === 'NotFoundError' ? null : e.message }));
    }
  }, []);

  const disconnect = useCallback(() => {
    dev.current?.gatt?.disconnect();
    setState({ status: 'off', name: null, watts: null, t: null, error: null });
  }, []);

  // stale reading (no packet in 4 s) → treat as missing
  const fresh = state.watts != null && Date.now() - state.t < 4000;
  return { ...state, watts: fresh ? state.watts : null, connect, disconnect };
}
