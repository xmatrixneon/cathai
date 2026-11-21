/**
 * Firebase Realtime Database (RTDB) Module
 *
 * Server side of the device presence channel (prototype, 2026-11-21).
 *
 * Android devices (planeapk >= 1.2) mirror their liveness into
 * presence/{deviceId} in the project's Realtime Database:
 *
 *   presence/{deviceId} = {
 *     online: boolean,        // flipped to false BY FIREBASE when the
 *                             // device socket dies (onDisconnect) - instant,
 *                             // no heartbeat threshold guessing
 *     lastSeen: number,       // server timestamp of last write
 *     wentOfflineAt: number,  // server timestamp of the drop
 *     wsConnected: boolean,   // is the app's own WebSocket also alive
 *     appVersion: string
 *   }
 *
 * The admin SDK bypasses security rules, so no rule changes are needed for
 * the server to read. The channel is optional: without RTDB_DATABASE_URL
 * set, every helper here is a safe no-op.
 */

import { initializeApp, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { cert } from 'firebase-admin/app';
import { readFileSync } from 'fs';

const APP_NAME = 'rtdb-presence';

let dbInstance = null;
let initAttempted = false;

/**
 * Initialize a named Firebase app carrying databaseURL and return the
 * Database instance. The default app (lib/fcm) is initialized without a
 * databaseURL, so a separate named app is required to attach RTDB.
 *
 * Returns null (never throws) when unconfigured or misconfigured so
 * callers can treat presence as a bonus signal, never a hard dependency.
 */
export function getRtdb() {
  if (dbInstance) return dbInstance;
  if (initAttempted) return null;
  initAttempted = true;

  try {
    const databaseURL = process.env.RTDB_DATABASE_URL;
    const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_KEY;

    if (!databaseURL) {
      console.warn('[RTDB] RTDB_DATABASE_URL not set - presence channel disabled');
      return null;
    }
    if (!serviceAccountPath) {
      console.warn('[RTDB] FCM_SERVICE_ACCOUNT_KEY not set - presence channel disabled');
      return null;
    }

    const existing = getApps().find((a) => a.name === APP_NAME);
    const app = existing ||
      initializeApp(
        {
          credential: cert(JSON.parse(readFileSync(serviceAccountPath, 'utf8'))),
          databaseURL,
        },
        APP_NAME,
      );

    dbInstance = getDatabase(app);
    console.log('[RTDB] Admin SDK initialized for', databaseURL);
    return dbInstance;
  } catch (error) {
    console.error('[RTDB] Failed to initialize:', error.message);
    return null;
  }
}

/** True when the presence channel is configured and usable. */
export function isRtdbEnabled() {
  return Boolean(process.env.RTDB_DATABASE_URL) && getRtdb() !== null;
}

/** Reference to the presence root (null when disabled). */
export function presenceRef() {
  const db = getRtdb();
  return db ? db.ref('presence') : null;
}

export default { getRtdb, isRtdbEnabled, presenceRef };
