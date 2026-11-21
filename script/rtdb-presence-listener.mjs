/**
 * RTDB Presence Listener - prototype for the device presence channel
 * (see lib/firebase/rtdb.js for the data shape).
 *
 * What it demonstrates:
 *  - instant online/offline transitions pushed by Firebase (onDisconnect)
 *    with zero heartbeat infrastructure on our side
 *  - wsConnected split: devices whose RTDB socket is up but whose app
 *    WebSocket is dead - the exact population the wake-up worker should
 *    target, now identifiable in real time
 *
 * Usage:
 *   node script/rtdb-presence-listener.mjs          # listen + periodic stats
 *   node script/rtdb-presence-listener.mjs --sync   # also mirror state into
 *                                                   # Mongo devices.presenceOnline
 *
 * Requires in .env:
 *   RTDB_DATABASE_URL=https://applstroe-default-rtdb.firebaseio.com (or
 *   whatever instance you create) and the existing MONGODB_URI /
 *   FCM_SERVICE_ACCOUNT_KEY.
 */

import { readFileSync } from 'fs';
import mongoose from 'mongoose';

// minimal .env loader (scripts run outside Next.js)
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const SYNC = process.argv.includes('--sync');

const { presenceRef } = await import('../lib/firebase/rtdb.js');

const ref = presenceRef();
if (!ref) {
  console.error('[presence] RTDB not configured - set RTDB_DATABASE_URL in .env');
  process.exit(1);
}

let Device = null;
if (SYNC) {
  await mongoose.connect(process.env.MONGODB_URI);
  const { default: DeviceModel } = await import('../models/Device.js');
  Device = DeviceModel;
  console.log('[presence] --sync: mirroring into devices.presenceOnline');
}

const state = new Map(); // deviceId -> {online, wsConnected, lastSeen}

function upsert(deviceId, val) {
  const prev = state.get(deviceId);
  state.set(deviceId, { ...prev, ...val });
  if (!prev) {
    console.log(`[new] ${deviceId} first seen (online=${val.online}, ws=${val.wsConnected}, v=${val.appVersion || '?'})`);
  }
  if (prev && prev.online !== val.online) {
    console.log(
      `[transition] ${deviceId} ${val.online ? '🟢 ONLINE' : '🔴 offline'}` +
      (val.wentOfflineAt ? ` (wentOfflineAt ${new Date(val.wentOfflineAt).toISOString()})` : ''),
    );
    if (SYNC && Device) {
      Device.updateOne(
        { deviceId },
        { $set: { presenceOnline: val.online, presenceLastSeen: new Date() } },
      ).catch((e) => console.error('[sync] failed:', e.message));
    }
  }
  if (prev && prev.wsConnected !== val.wsConnected) {
    console.log(`[ws-state] ${deviceId} app WebSocket ${val.wsConnected ? 'up' : 'DOWN (RTDB still live - wake-up candidate)'}`);
  }
}

ref.on('child_added', (snap) => upsert(snap.key, snap.val() || {}));
ref.on('child_changed', (snap) => upsert(snap.key, snap.val() || {}));
ref.on('child_removed', (snap) => {
  state.delete(snap.key);
  console.log(`[removed] ${snap.key}`);
});

console.log('[presence] listening on', ref.toString());

setInterval(() => {
  const all = [...state.values()];
  const online = all.filter((d) => d.online).length;
  const rtdbUpWsDown = all.filter((d) => d.online && d.wsConnected === false).length;
  console.log(
    `[stats] tracked=${all.length} online=${online} offline=${all.length - online}` +
    ` | rtdb-up-but-ws-dead=${rtdbUpWsDown} (wake-up candidates)`,
  );
}, 30_000);
