# Device Online-Count Fixes — 2026-08-19

Applies to any deployment of the CattySMS Gateway stack (Next.js manager +
BullMQ workers + Android devices on WebSocket `/gateway`). Written so the same
fixes can be replicated on other deployments.

**Measured result on the source deployment:** online devices 2,759 → ~3,500 (+25%),
FCM ping failure rate 42% → 0%, keepalive worker 894MB crash-loop → 137MB
stable, ping cycle 17 min → 4 min.

---

## Fix 1 — FCM stale tokens never removed (the 42% failure bug)

**File:** `lib/fcm/send.js`

**Symptom:** keepalive logs show a constant ~40% "failed" rate and
`0 stale tokens` forever:

```
[Keepalive] Scan complete: 574 pinged, ... 0 stale tokens, 426 failed (28560ms)
```

**Root cause:** code checked only the legacy error code
`messaging/registration-token-not-registered`. Modern firebase-admin returns
`messaging/unregistered` (plus `invalid-registration-token`,
`sender-id-mismatch`). Dead tokens were classified as generic failures,
never removed, and re-pinged on every cycle forever.

**Fix:** add one shared helper and use it everywhere an FCM send happens:

```js
// lib/fcm/send.js  (add after the imports)

export function isStaleFcmTokenError(error) {
  // firebase-admin exposes the code on error.code and/or error.errorInfo.code
  const code = error?.code || error?.errorInfo?.code;
  if (!code) return false;
  return [
    'messaging/unregistered',                        // modern HTTP v1 API
    'messaging/registration-token-not-registered',   // legacy HTTP API
    'messaging/invalid-registration-token',          // malformed token
    'messaging/sender-id-mismatch',                  // other Firebase project
    'messaging/invalid-argument',
    'messaging/internal-error',
  ].includes(code);
}
```

Then in `sendWakeUpNotification()`'s catch block, replace the whole
if/else-if chain with:

```js
  } catch (error) {
    if (isStaleFcmTokenError(error)) {
      return { success: false, isStaleToken: true };
    }
    console.error(`[FCM] Failed to send wake-up to device ${deviceId}:`, error);
    return { success: false, isStaleToken: false };
  }
```

And in `jobs/handlers/keepalive-handler.js` → `sendKeepAlivePing()` catch:

```js
import { isStaleFcmTokenError } from '../../lib/fcm/send.js';
// ...
  } catch (error) {
    if (isStaleFcmTokenError(error)) {
      return { success: false, isStaleToken: true };
    }
    return { success: false, isStaleToken: false };
  }
```

The stale branch already unsets the token (`$unset: { fcmToken: "" }`) — it
just never triggered before. Android apps re-register their token on next
register/heartbeat, so nothing is lost.

---

## Fix 2 — Duplicate `$ne` object key (null tokens matched)

**File:** `jobs/handlers/keepalive-handler.js` (both device queries)

**Symptom:** failures classified as
`messaging/invalid-payload — "Exactly one of topic, token or condition is required"`
(the token was null when sending).

**Root cause:** this is NOT a valid "not null and not empty" filter:

```js
fcmToken: { $ne: null, $ne: "" }   // ❌ duplicate key — JS keeps only the last one
```

JavaScript object literals cannot repeat a key. The object collapses to
`{ $ne: "" }`, which **matches null tokens** (null ≠ ""), so every null-token
device passed the filter and every ping to it failed.

**Fix:**

```js
fcmToken: { $exists: true, $nin: [null, ""] }   // ✅ correct
```

**Check your other project for the same bug:**

```bash
grep -rn '\$ne: null, *\$ne: ""' --include="*.js" --include="*.mjs" .
# On this deployment the deprecated script/wakeup.mjs and script/keepalive.mjs also
# had it (not running, left unfixed).
```

---

## Fix 3 — Keepalive worker OOM crash-loop

**File:** `jobs/handlers/keepalive-handler.js`

**Symptom:** worker at its `max_memory_restart` ceiling, PM2 restart counter
climbing constantly (170 restarts), ping coverage gaps.

**Root cause:** the TARGET_ALL query loaded **full Device documents** for the
whole fleet (~34k docs with sims arrays, call-forwarding state, etc.) into
memory every cycle.

**Fix:** project only the fields the ping loop uses and use `lean()` (plain
objects, no mongoose wrappers):

```js
const DEVICE_FIELDS = 'deviceId name status fcmToken lastHeartbeat';

// both queries become:
const devices = await Device.find(query).select(DEVICE_FIELDS).lean();
```

Measured: ~945 B/doc full vs ~212 B/doc projected; the array went from
~31MB+overhead to ~2MB. Worker now idles at ~130-160MB.

---

## Fix 4 — Ping cycle dilution (48h recency window)

**File:** `jobs/handlers/keepalive-handler.js` + env

**Symptom:** TARGET_ALL cycles through every token-bearing device (~34k at
1000/job), so a recoverable device only got a ping every ~17-30 minutes.
Long-dead devices (uninstalled apps) made up the majority of the list.

**Fix:** bound targeting to devices actually seen recently:

```js
const MAX_OFFLINE_HOURS = parseInt(process.env.FCM_KEEP_ALIVE_MAX_OFFLINE_HOURS || "48");

const query = {
  isActive: true,
  fcmToken: { $exists: true, $nin: [null, ""] }
};
if (MAX_OFFLINE_HOURS > 0) {
  query.lastHeartbeat = { $gte: new Date(Date.now() - MAX_OFFLINE_HOURS * 60 * 60 * 1000) };
}
```

Env (`.env` and/or ecosystem env block):

```
FCM_KEEP_ALIVE_MAX_OFFLINE_HOURS=48     # 0 = old behavior (ping ALL offline devices)
```

Measured result: 33,993 → 8,662 devices per cycle; full pass ~4 min.
Reactive wake-up of long-offline devices stays the wakeup worker's job.

---

## Fix 5 — Diagnostic logging (how we found fixes 1 & 2)

Added to `sendKeepAlivePing()`'s catch: log each **distinct** FCM error code
once per process lifetime. Without this the failure reason was invisible:

```js
const seenFcmErrorCodes = new Set();
// in catch, after the stale check:
const code = error?.code || error?.errorInfo?.code || 'unknown';
if (!seenFcmErrorCodes.has(code)) {
  seenFcmErrorCodes.add(code);
  console.warn(`[Keepalive] FCM send error code=${code} msg=${(error?.message || '').slice(0, 200)}`);
}
```

NOTE: `console.warn` goes to the PM2 **error** log, not the out log.

---

## Fix 6 — PM2 manager topology (zombie instances)

**File:** `ecosystem.config.cjs`

**Symptom:** `pm2 ls` shows N manager instances in cluster mode, but
`ss -tlnp | grep :3000` shows only ONE pid holding the listener and ALL
sockets — the rest are idle zombies (~75MB each).

**Root cause:** PM2 **cannot cluster a binary wrapper**. With
`script: 'npm', args: 'start', exec_mode: 'cluster'`, PM2 silently forks N
independent `npm → sh → node server.js` chains that race to bind port 3000.
One wins; the rest idle forever. It also misroutes stdout into
`~/.pm2/pm2.log` and breaks PM2 signal delivery.

**Why not real cluster mode instead:** `WebSocketManager` keeps sockets in
per-process memory (`connections` Map, no Redis pub/sub). With multiple
workers, `sendToDevice()` / `isDeviceOnline()` / dashboard broadcasts only
work on the worker holding that device's socket. Multi-instance requires
sticky sessions + a Redis adapter first.

**Fix:**

```js
{
  name: 'manager',
  script: 'server.js',        // direct — no npm wrapper
  exec_mode: 'fork',
  instances: 1,
  env: { NODE_ENV: 'production', PORT: 3000 },
  autorestart: true,
  watch: false,
  kill_timeout: 5000,
  node_args: '--max-old-space-size=4096',
  // wait_ready removed: server.js never calls process.send('ready'),
  // so wait_ready:true causes PM2 restart loops.
},
```

Apply with (a plain `pm2 restart` cannot change script/exec-mode):

```bash
pm2 delete manager
pm2 start ecosystem.config.cjs --only manager
pm2 save
```

**Capacity note:** one fork instance measured 13% of one core at ~3,900
connections (145 heartbeats/sec), ~438MB RSS, fd limit 1M — comfortable
headroom to roughly 30k connections.

---

## Fix 7 — worker:suspend disabled (deployment-specific)

Disabled by user decision (2026-08-19). Three layers so it can't
come back by accident:

1. `worker:suspend` block commented out in `ecosystem.config.cjs`
2. `.env`: `SMS_AUTO_SUSPEND_ENABLED=false`, `BULLMQ_SUSPEND_ENABLED=false`
3. The worker self-exits at boot when `SMS_AUTO_SUSPEND_ENABLED === 'false'`

Re-enable by reverting all three. Only apply to other deployments if you want
number auto-suspension off there too.

---

## Housekeeping also done

- Killed two orphaned `node script/test-fetch-worker.mjs` processes (ppid 1,
  133 days old) that were competing on the `sms:fetch` queue.
- Historical failed-job counters in BullMQ DLQ (`device:keepalive` failed=20
  etc.) are from the OOM era; inspect/clear via `GET/DELETE /api/queues/dlq`.

## Env additions summary

```
FCM_KEEP_ALIVE_MAX_OFFLINE_HOURS=48
# (if suspending disabled on that deployment:)
SMS_AUTO_SUSPEND_ENABLED=false
BULLMQ_SUSPEND_ENABLED=false
```

## Diagnostic commands (run these on the other deployment first)

```bash
# 1. Zombie manager instances? (one pid should hold everything)
ss -tlnp | grep :3000
ps -eo pid,ppid,cmd | grep -E "npm start|server.js" | grep -v grep

# 2. Keepalive failure rate / stale cleanup working?
grep "Scan complete" ~/.pm2/logs/worker-keepalive-out-*.log | tail

# 3. Duplicate-$ne bug present?
grep -rn '\$ne: null, *\$ne: ""' --include="*.js" jobs/ lib/ script/

# 4. Legacy-only stale detection?
grep -rn "registration-token-not-registered" lib/ jobs/

# 5. Online vs total devices
mongosh "$MONGODB_URI" --quiet --eval '
const now = new Date();
print("online(60s): " + db.devices.countDocuments({isActive: true, lastHeartbeat: {$gte: new Date(now-60000)}}));
print("total:       " + db.devices.countDocuments({isActive: true}));'

# 6. Stray test workers competing on queues?
ps -eo pid,ppid,etime,cmd | grep test- | grep -v grep
```

## Verification after applying fixes

```
[Keepalive] Target mode: ALL DEVICES (seen <48h) (NNNN total)   ← window active
[Keepalive] Scan complete: ... 0 failed (NNs)                   ← 0% failures
[Keepalive] ... N stale tokens ...                              ← cleanup working
```

```bash
pm2 ls                       # manager: fork, 1 instance, ↺ stable
ss -tlnp | grep :3000        # manager pid holds the listener directly
pm2 logs manager             # output lands in manager-out-<id>.log now
```
