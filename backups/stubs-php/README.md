# Stubs API PHP Backups

This directory contains backup copies of the PHP Stubs API files from `/var/www/html/stubs/`.

## Files

| File | Size | Description |
|------|------|-------------|
| `handler_api.php` | 11.5 KB | Production version with cooldown logic (5-20 min) |
| `2handler_api.php` | 13 KB | Alternative version with OTP detection regex |
| `handler_api_backup.php` | 11.5 KB | Backup without cooldown logic |
| `handler_api_optimized.php` | 2.5 KB | Optimized/compact version |
| `test.php` | 0 B | Empty test file |

## Backup Date

April 11, 2026

## Notes

- Dependencies (vendor/, composer.json, composer.lock) are not included
- These files are for reference only - the live API runs at `/var/www/html/stubs/`
