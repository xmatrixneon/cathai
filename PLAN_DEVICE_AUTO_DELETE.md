# Plan: Auto-Delete Devices Offline for 24+ Hours

## Overview
Automatically delete devices that have been offline for 24 hours or more to keep the database clean and remove inactive devices.

## Current State Analysis

### Existing Device Deletion Logic
- **Location**: `/var/www/manager/app/api/device/[deviceId]/route.js:103-126`
- **Current behavior**: Manual DELETE endpoint
  - Deletes device from database
  - Deletes associated messages (`Message.deleteMany`)
  - **Does NOT delete associated numbers** (they remain in database but become inactive)

### Status Sync Script
- **Location**: `/var/www/manager/script/status.mjs`
- **Runs**: Every 15 seconds
- **Current offline handling**:
  - Devices with `lastHeartbeat < 60 seconds ago` are marked offline
  - Offline devices have their numbers deactivated (`active: false`)
  - Numbers are NOT deleted when devices go offline

### Data Relationships
```
Device (deviceId)
  ├─> Messages (metadata.deviceId)  ← Deleted when device deleted
  └─> Numbers (port: "{deviceId}-SIM{1,2}")  ← NOT deleted, just deactivated
```

## Implementation Options

### Option 1: Add to Status Sync Script (Recommended)
**Pros:**
- Runs every 15 seconds, quick cleanup
- Reuses existing database connection
- Centralized device status management
- Simple to implement

**Cons:**
- Runs frequently (every 15s) - may be wasteful for 24h check
- Mixes concerns (sync + cleanup)

### Option 2: Separate Cron Job
**Pros:**
- Runs on appropriate schedule (e.g., hourly or daily)
- Separation of concerns
- Can run at different frequency

**Cons:**
- Additional process to manage
- Additional database connection

### Option 3: Add to Existing Device Cleanup
**Pros:**
- Centralized cleanup logic

**Cons:**
- No existing cleanup mechanism to extend

## Recommended Implementation: Option 1

### Implementation Details

#### 1. Add Cleanup Function to `status.mjs`

```javascript
async function cleanupStaleDevices() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Find devices offline for 24+ hours
  const staleDevices = await Device.find({
    lastHeartbeat: { $lt: twentyFourHoursAgo },
    isActive: true  // Only consider active devices
  });

  if (staleDevices.length === 0) return;

  console.log(`\n🧹 CLEANUP: Found ${staleDevices.length} devices offline for 24+ hours`);

  for (const device of staleDevices) {
    try {
      // Delete associated messages
      await Message.deleteMany({ 'metadata.deviceId': device.deviceId });

      // Deactivate all numbers from this device
      await Numbers.updateMany(
        { port: { $regex: `^${device.deviceId}-SIM` } },
        { $set: { active: false, signal: 0 } }
      );

      // Delete the device
      await Device.deleteOne({ _id: device._id });

      console.log(`🗑️ DELETED  ${device.deviceId} (${device.name || 'unnamed'}) - offline 24+ hours`);
    } catch (err) {
      console.error(`❌ Failed to delete device ${device.deviceId}:`, err.message);
    }
  }
}
```

#### 2. Call Cleanup Function in Sync Loop

```javascript
async function syncDeviceNumbers() {
  // ... existing sync logic ...

  // Run cleanup at the end of each sync cycle
  await cleanupStaleDevices();

  // ... rest of function ...
}
```

### Configuration Considerations

#### Environment Variables (Optional but Recommended)
```env
# .env
DEVICE_AUTO_DELETE_ENABLED=true
DEVICE_AUTO_DELETE_HOURS=24
```

#### Configurable Implementation
```javascript
const AUTO_DELETE_ENABLED = process.env.DEVICE_AUTO_DELETE_ENABLED !== 'false';
const AUTO_DELETE_HOURS = parseInt(process.env.DEVICE_AUTO_DELETE_HOURS || '24');

async function cleanupStaleDevices() {
  if (!AUTO_DELETE_ENABLED) {
    return;
  }

  const cutoffTime = new Date(Date.now() - AUTO_DELETE_HOURS * 60 * 60 * 1000);
  // ... rest of logic
}
```

## Safety Features

### 1. Grace Period
- **Default**: 24 hours
- **Configurable**: Via environment variable
- **Rationale**: Gives devices time to reconnect after temporary network issues

### 2. Logging
- Log all deletions with device details
- Log errors if deletion fails
- Summary count of deleted devices

### 3. Active Device Filter
- Only delete devices with `isActive: true`
- Prevents deletion of already soft-deleted devices

### 4. Error Handling
- Individual device failures don't stop the batch
- Continue processing other devices if one fails
- Log all errors for debugging

## Data Cleanup Strategy

### What Gets Deleted:
1. ✅ **Device record** - From `Device` collection
2. ✅ **Messages** - All messages from `Message` collection with matching `deviceId`

### What Gets Deactivated (Not Deleted):
1. ⚠️ **Numbers** - Set `active: false`, keep in database
   - **Rationale**: Numbers may be reused on other devices
   - Historical data (usage stats, rotation history) is preserved
   - Number can be reactivated if device reconnects

### Alternative: Delete Numbers Too
If numbers should also be deleted:

```javascript
// Instead of deactivating, delete numbers
await Numbers.deleteMany({
  port: { $regex: `^${device.deviceId}-SIM` }
});
```

## Testing Plan

### 1. Manual Testing
```javascript
// Set a device's lastHeartbeat to 25 hours ago
await Device.findOneAndUpdate(
  { deviceId: 'test-device-id' },
  { $set: { lastHeartbeat: new Date(Date.now() - 25 * 60 * 60 * 1000) } }
);

// Run sync and verify deletion
```

### 2. Verification Steps
- [ ] Device is deleted after 24+ hours offline
- [ ] Associated messages are deleted
- [ ] Numbers are deactivated (or deleted, based on choice)
- [ ] No errors in logs
- [ ] Console output shows deletion details

### 3. Edge Cases to Test
- Device with no messages
- Device with no numbers
- Device that reconnects during cleanup
- Multiple devices being cleaned up simultaneously

## Alternative Approaches Considered

### Soft Delete (Mark as Inactive)
Instead of hard delete, set `isActive: false`:

```javascript
await Device.updateOne(
  { _id: device._id },
  { $set: { isActive: false } }
);
```

**Pros:**
- Data is recoverable
- Historical records preserved
- Can audit deleted devices

**Cons:**
- Database continues to grow
- Need separate cleanup for truly old records

**Recommendation**: Use hard delete for now, can add soft delete later if needed.

## Rollback Plan

If issues arise:
1. Set `DEVICE_AUTO_DELETE_ENABLED=false` in `.env`
2. Restart the manager process
3. Restoration would require database backup

## Summary

### Files to Modify:
1. `/var/www/manager/script/status.mjs` - Add cleanup function

### Optional Files:
2. `/var/www/manager/.env` - Add configuration variables

### Implementation Steps:
1. Add `cleanupStaleDevices()` function to `status.mjs`
2. Import `Message` model
3. Call cleanup function in sync loop
4. Add optional environment variables for configuration
5. Test with manual timestamp manipulation
6. Monitor logs for first few hours

### Estimated Complexity: Low
- ~50 lines of code
- Uses existing patterns
- No database schema changes
