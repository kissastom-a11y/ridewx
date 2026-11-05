import { t } from '../../lib/i18n.js';
import { ALERT_RADIUS_M } from './cameraEngine.js';

const LABEL = {
  speed_camera: 'SPEED CAMERA',
  redlight_camera: 'RED-LIGHT CAMERA',
  buslane_camera: 'BUS-LANE CAMERA',
  enforcement_zone: 'ENFORCEMENT ZONE',
};

/** Full-width warning banner with a live distance countdown bar. */
export default function CameraAlert({ active }) {
  const cam = active[0];
  if (!cam) return null;
  const pct = Math.max(0, Math.min(100, (cam.distance / Math.max(cam.alertRadius, ALERT_RADIUS_M)) * 100));

  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-[1000] animate-pulse rounded-xl border-2 border-red-400 bg-red-600/95 p-3 text-white shadow-2xl">
      <div className="flex items-center gap-3">
        {cam.maxspeed ? (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[6px] border-red-200 bg-white text-xl font-black text-slate-900">
            {cam.maxspeed}
          </div>
        ) : (
          <div className="text-4xl">📷</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold tracking-widest">{t(LABEL[cam.type] || 'SPEED CAMERA')}</div>
          <div className="text-3xl font-black tabular-nums">{Math.round(cam.distance)} m</div>
          <div className="truncate text-xs opacity-80">{cam.name}</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 rounded bg-red-900">
        <div className="h-1.5 rounded bg-white transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
