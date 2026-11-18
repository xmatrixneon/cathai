# Device Auto-Deletion (30-Day Offline Threshold)

Portable documentation of commit `1452da3` (2026-11-18). Replicate this in any
gateway-style project where Android/IoT devices register and heartbeat, and
abandoned devices otherwise accumulate forever.

## Problem

Without deletion, devices that are uninstalled, factory-reset, or thrown away
stay in the DB forever as "zombie" records. On this fleet, removing the
auto-delete logic caused **41,000+ zombie devices** (each one re-scanned by the
15-second status sync on every run, inflating memory and CPU).

## Solution

A `cleanupStaleDevices()` step that runs at the end of the periodic status-sync
job. It deletes devices whose `lastHeartbeat` is older than a configurable
threshold (default: 30 days), plus their dependent data.

### Deletion semantics (important — keep these)

For each deleted device:

1. **Messages deleted** — `Message.deleteMany({ 'metadata.deviceId': { $in: ids } })`
   (usually already purged by message retention, but delete anyway to be safe)
2. **Numbers deactivated, NOT deleted** — set `{ active: false, signal: 0 }` on
   number docs whose `port` starts with `{deviceId}-SIM`. Number docs are kept
   because they carry quality history; if the SIM returns in another device,
   the history survives.
3. **Device document deleted** — `Device.deleteMany({ deviceId: { $in: ids } })`

### Core code (framework-agnostic, Mongoose)

```js
// Delete devices offline longer than DEVICE_AUTO_DELETE_HOURS (default 720 = 30 days).
// Capped per run so a large backlog can't stall the sync job. Number docs are
// deactivated, not deleted, so quality history survives if a SIM returns.
async function cleanupStaleDevices() {
  const enabled = process.env.DEVICE_AUTO_DELETE_ENABLED !== 'false';
  if (!enabled) {
    return { deleted: 0, enabled: false };
  }
  const hours = parseInt(process.env.DEVICE_AUTO_DELETE_HOURS || '720', 10);
  const maxPerRun = parseInt(process.env.DEVICE_AUTO_DELETE_MAX_PER_RUN || '1000', 10);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const stale = await Device.find({ lastHeartbeat: { $lt: cutoff }, isActive: true })
    .select('deviceId sims.slot')
    .lean()
    .limit(maxPerRun);
  if (stale.length === 0) {
    return { deleted: 0, enabled: true };
  }

  const ids = stale.map(d => d.deviceId);

  await Message.deleteMany({ 'metadata.deviceId': { $in: ids } });

  // Deactivate numbers using exact ports, NOT regex alternation (`^(id1|id2|...)-SIM`).
  // Alternation regexes can't use the port index prefix bounds; the planner picks a
  // full active-index scan and the bad plan gets CACHED for the shared
  // {port: {$regex}, active} query shape used elsewhere every sync cycle —
  // turning sub-ms updates into ~45ms each. Match exact `{deviceId}-SIM{slot}` values.
  const ports = [];
  for (const d of stale) {
    if (Array.isArray(d.sims)) {
      for (const sim of d.sims) {
        if (sim && sim.slot) ports.push(`${d.deviceId}-SIM${sim.slot}`);
      }
    }
  }
  for (let i = 0; i < ports.length; i += 1000) {
    await Numbers.updateMany(
      { port: { $in: ports.slice(i, i + 1000) }, active: true },
      { $set: { active: false, signal: 0 } }
    );
  }

  await Device.deleteMany({ deviceId: { $in: ids } });
  console.log(`[Status] Auto-delete: removed ${ids.length} device(s) offline >${hours}h`);
  return { deleted: ids.length, enabled: true };
}
```

### Integration points

1. **Call it at the END of the periodic sync job** — after status flips and
   number sync — so a slow deletion backlog never delays online/offline
   detection:

   ```js
   // runs after the sync so a slow deletion never delays status flips
   const autoDelete = await cleanupStaleDevices();
   ```

2. **Report the count** in the job result for observability:
   `autoDeletedDevices: autoDelete.deleted`

3. **Imports needed**: the `Message` model (in addition to existing
   `Device`, `Numbers`).

### Why these design choices

| Choice | Reason |
|---|---|
| `limit(maxPerRun)` (1000/run) | After enabling on a dirty DB the backlog can be tens of thousands; a cap keeps each 15s sync fast and drains the backlog gradually |
| `.select('deviceId').lean()` | Don't hydrate full docs — 41k full documents OOM'd the worker before |
| Numbers deactivated, not deleted | Quality history survives SIM reuse |
| `isActive: true` filter | Respect soft-deleted devices separately |
| Exact `$in` on port values | Numbers reference devices only via `{deviceId}-SIM{slot}` port strings (no FK). **Never** use `$regex` alternations on this field — they bypass index prefix bounds and poison the plan cache for every other regex query on the same shape |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DEVICE_AUTO_DELETE_ENABLED` | `true` | Master switch (`'false'` disables) |
| `DEVICE_AUTO_DELETE_HOURS` | `720` (30 days) | Offline hours before deletion |
| `DEVICE_AUTO_DELETE_MAX_PER_RUN` | `1000` | Cap per sync run |

## Manual one-off cleanup script

For catching up a dirty DB immediately (or deleting on a custom cutoff, e.g.
"anything not seen this month") without waiting for the capped worker:
`script/delete-stale-devices.mjs` in this repo. Key differences from the
worker path:

- CLI args: `--hours N` / `--before ISO_DATE` (explicit cutoff) / `--dry-run` / `--batch N`
- Streams devices via cursor in batches (no per-run cap — drains everything)
- Back up the full device docs to a JSON file BEFORE deleting, so the run is
  reversible
- Same semantics: messages deleted, numbers deactivated, devices deleted

Example of a custom-cutoff run used on 2026-11-18 (deleted 3,202 devices not
seen since before Nov 1):

```bash
node script/delete-stale-devices.mjs --dry-run          # preview first
node script/delete-stale-devices.mjs --before 2026-10-31T18:30:00Z
```

## Model fields required

- **Device**: `deviceId` (unique string), `lastHeartbeat` (Date), `isActive` (bool)
- **Message**: `metadata.deviceId` (string)
- **Numbers**: `port` (string, `{deviceId}-SIM{slot}` format), `active` (bool), `signal`

## Operational notes

- Device online threshold is separate (60s on `lastHeartbeat`); deletion
  threshold must be much larger (30 days) or you'll delete temporarily-offline
  devices
- After a fresh enable on a dirty DB, expect `MAX_PER_RUN` deletions per sync
  cycle until the backlog drains (1000/15s ≈ 240k/hour)
- Verify with: oldest remaining `lastHeartbeat` should sit at/just past the
  cutoff once the backlog is drained
