# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a dual-component SMS Gateway system:

### 1. Manager (`/var/www/manager/`)
Next.js 15 application managing Android devices that act as SMS gateways. Tracks devices, SIM cards, messages, and phone numbers via WebSocket-based real-time architecture.

**Key components:**
- Android devices connect via WebSocket to `/gateway` endpoint
- Dashboard connects via WebSocket to `/gateway?client=dashboard`
- Devices send heartbeats, SMS events, and call forwarding responses
- Background script syncs device status to Numbers collection every 15 seconds
- Device auto-deletion after 24+ hours offline (configurable via `DEVICE_AUTO_DELETE_*` env vars)

### 2. Stubs API (`/var/www/html/stubs/`)
PHP-based SMS activation API that provides external interface for requesting phone numbers and receiving OTP codes. Connects to the same MongoDB database.

**Key components:**
- `handler_api.php` - Main API endpoint (current version with cooldown logic)
- `2handler_api.php` - Alternative version with OTP detection regex
- `handler_api.php.bak` - Backup of previous version
- Actions: `getNumber`, `getStatus`, `setStatus`, `CheckSMS`
- Number allocation with smart cooldown (5-20 minutes randomized)
- OTP extraction using service-specific regex patterns

## Development Commands

```bash
# Development
npm run dev           # Start server on port 3000

# Production
npm run build         # Build Next.js app
npm start             # Start production server (NODE_ENV=production)

# Linting
npm run lint          # Run Next.js linter
```

## Architecture

### Server Entry Point (`server.js`)
- Creates custom HTTP server with Next.js request handler
- Initializes WebSocket server on `/gateway` route
- Creates single `WebSocketManager` instance stored in `global.wsManager`
- **Important**: All API routes must access WebSocket via `getWsManager()` from `lib/websocket/manager.js`, which returns `global.wsManager`

### WebSocket Communication (`lib/websocket/manager.js`)

**Message types from Android devices:**
- `register` - Initial device registration with device info and SIM details
- `heartbeat` - Periodic status updates (battery, signal, sims)
- `sms` - Incoming SMS with sender, content, timestamp, simSlot
- `call_forwarding_response` - Call forwarding action results
- `send_sms_response` - SMS send confirmation with messageId
- `pong` - Response to server ping

**Message types to dashboard:**
- `device_heartbeat` - Broadcast device status (includes sims array)
- `sms_received` - New incoming SMS
- `device_status` - Device online/offline status change
- `call_forwarding_response` - Call forwarding results
- `sms_sent_status` - SMS send confirmation

**Important notes:**
- SIM slots are 1-based (Android converts from 0-based before sending)
- Device `lastHeartbeat` is updated on heartbeat, pong, and register
- Device offline threshold: 60 seconds (to reduce status flip-flopping)
- Call forwarding state is preserved across heartbeats (merged from existing device record)

### Background Sync Script (`script/status.mjs`)

Runs every 15 seconds via `node-cron`:

1. **Device status sync** - Marks devices online/offline based on `lastHeartbeat` (60s threshold)
2. **Number sync** - Syncs active SIM phone numbers to `Numbers` collection
3. **SIM swap detection** - Deactivates old number when SIM changes on same port
4. **Stale number cleanup** - Deactivates numbers not synced in current run
5. **Device auto-deletion** - Deletes devices offline for 24+ hours (configurable)

**Key behaviors:**
- OFFLINE devices: All their numbers are immediately deactivated
- ONLINE devices: Active SIM numbers are synced/upserted to Numbers collection
- Numbers port format: `{deviceId}-SIM{slot}` (e.g., "1a2b3c4d-SIM1")
- Indian phone numbers are normalized (remove "91" prefix, 10 digits)

### Data Models

**Device** (`models/Device.js`):
- `deviceId` (unique) - Device identifier from Android app
- `sims[]` - Array of SIM subdocuments with slot (1-based), phoneNumber, carrier, signalStrength, networkType, callForwardingActive, callForwardingTo, ussdResponse
- `status` - 'online' | 'offline' | 'error'
- `lastHeartbeat` - Last communication timestamp
- `isActive` - Soft-delete flag (default: true)

**Message** (`models/Message.js`):
- `sender`, `receiver`, `port`, `time`, `message`
- `metadata.deviceId`, `metadata.simSlot`, `metadata.simCarrier`, `metadata.simNetworkType`

**Numbers** (`models/Numbers.js`):
- `number` (unique) - Phone number
- `port` - Gateway port like "{deviceId}-SIM1"
- `active`, `locked`, `operator`, `signal`
- `lastRotation`, `iccid`, `imsi`

### API Routes Structure

- `/api/device/*` - Device CRUD, list, stats, send SMS, call forwarding
- `/api/numbers/*` - Number management
- `/api/messages/*` - Message retrieval
- `/api/overview/*` - Dashboard statistics
- `/api/countries/*`, `/api/services/*` - Reference data

## Environment Variables

Required:
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - JWT signing key

Optional:
- `PORT` - Server port (default: 3000)
- `DEVICE_AUTO_DELETE_ENABLED` - Enable auto-delete (default: true)
- `DEVICE_AUTO_DELETE_HOURS` - Offline hours before deletion (default: 24)

## TypeScript Configuration

- Path alias: `@/*` maps to project root
- Build ignores TypeScript errors (`ignoreBuildErrors: true`)
- Images unoptimized for deployment flexibility

## Important Implementation Notes

1. **WebSocket Manager Global State**: Always use `getWsManager()` from `lib/websocket/manager.js` to access the live WebSocket instance. Do not create new instances.

2. **SIM Slot Numbering**: All SIM slots are 1-based throughout the system (Android converts from 0-based before sending).

3. **Device Online Detection**: Uses 60-second threshold on `lastHeartbeat` field. This is applied consistently in WebSocket manager, status sync script, and Device model methods.

4. **Call Forwarding State**: Must be preserved across heartbeats. The manager merges existing call forwarding state with new SIM data during heartbeat processing.

5. **Number Sync Logic**: Offline devices have their numbers deactivated immediately; online devices have their active SIM numbers synced to the Numbers collection.

6. **SIM Swap Detection**: When a phone number changes on the same port, the old number is deactivated and the new one is activated.

## PHP Stubs API (`/var/www/html/stubs/`)

### Overview
The PHP API provides an SMS activation service interface. External services can request phone numbers and receive OTP/SMS messages through REST-like GET endpoints.

### API Endpoints

All endpoints use GET parameters:
- `api_key` - User authentication (required for all actions)
- `action` - Operation to perform

#### Actions

**`getNumber`** - Allocate a phone number
```
GET ?action=getNumber&api_key=KEY&service=SERVICE&country=COUNTRY
```
Returns: `ACCESS_NUMBER:{orderId}:{dialCode}{number}` or error code

Error codes: `BAD_KEY`, `BAD_SERVICE`, `BAD_COUNTRY`, `NO_NUMBER`, `ACCOUNT_BAN`

**`getStatus`** - Check for SMS/OTP on allocated number
```
GET ?action=getStatus&api_key=KEY&id={orderId}
```
Returns: `STATUS_OK:{otp}` or `STATUS_WAIT_CODE` or `STATUS_CANCEL` or `NO_ACTIVATION`

**`setStatus`** - Cancel or finalize activation
```
GET ?action=setStatus&api_key=KEY&id={orderId}&status=8
```
Status codes:
- `8` - Cancel (returns `ACCESS_CANCEL` or `ACCESS_ACTIVATION` if already used)
- `3` - Request next SMS (returns `ACCESS_RETRY_GET` or `ACCESS_READY`)

**`CheckSMS`** (2handler_api.php only) - Detect OTP from arbitrary text
```
GET ?action=CheckSMS&api_key=KEY&text={messageText}
```
Returns: `{otp}:{serviceName}` or `NOT_AVAILABLE`

### Number Allocation Logic

The `getNumber` action uses smart number selection:

1. **Random sampling** - Uses MongoDB `$sample` for random number selection
2. **Lock check** - Skips numbers locked for this service/country
3. **Active order check** - Skips numbers with active orders for same service
4. **Recent usage check** - Skips numbers used in last 4 hours for same service
5. **Cooldown check** - (handler_api.php only) Skips numbers used recently (5-20 min randomized cooldown)
6. **Max retries** - Attempts up to 6 times before returning `NO_NUMBER`

### Order Lifecycle

1. **Created** - Order inserted with `active: true`, `isused: false`
2. **SMS Received** - OTP appended to `message[]` array
3. **Used** - Set `isused: true` when OTP successfully retrieved
4. **Cancelled** - Set `active: false` (min 2 minutes after creation)
5. **Expired** - Auto-cancelled after 20 minutes

### Database Collections Used

- `orders` - SMS activation orders
- `numbers` - Available phone numbers
- `services` - Supported services (with OTP regex patterns)
- `countires` - [sic] Supported countries
- `users` - API users with keys
- `locks` - Number locks per service/country

### Service Configuration

Each service has:
- `code` - Service identifier
- `name` - Service display name
- `keywords` - Keywords for SMS matching
- `formate` - OTP regex patterns (supports `{otp}`, `{date}`, `{datetime}` placeholders)
- `maxmessage` - Maximum expected messages
- `active` - Service availability flag

### OTP Detection (2handler_api.php)

The `detectOtpFromMessage()` function builds regex patterns from service `formate`:
- `{otp}` - Captures 3-8 digit OTP (also supports `###-###` format)
- `{date}`, `{datetime}` - Replaced with `.*` wildcard
- Other `{placeholder}` - Replaced with `.*` wildcard
- Flexible spacing and punctuation matching

### PHP Dependencies

```bash
cd /var/www/html/stubs
composer install
```

Required: `mongodb/mongodb` PHP library

### Key Differences Between PHP Files

- **handler_api.php** - Production version with cooldown logic (5-20 min), early cancel protection (2 min), comprehensive validation
- **2handler_api.php** - Includes OTP detection regex and `CheckSMS` action
- **handler_api.php.bak** - Backup without cooldown logic
