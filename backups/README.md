# CattySMS Backups

This directory contains backups of critical system components.

## Structure

```
backups/
├── database/           # MongoDB database dumps
│   └── smsgateway_YYYYMMDD_HHMMSS/
│       └── smsgateway/ # Collection backups
├── nginx/              # Nginx configuration files
│   ├── nginx.conf
│   ├── api.cattysms.shop.conf
│   ├── cattysms.shop.conf
│   └── last_backup.txt
└── stubs/              # PHP Stubs API files
    ├── handler_api.php
    ├── 2handler_api.php
    └── composer.json
```

## Backup Script

Run backup manually:
```bash
node script/backup.mjs
```

The script will:
1. Create a new MongoDB dump (mongodump)
2. Backup Nginx configurations
3. Backup Stubs API files
4. Keep only the 5 most recent database backups

## Restore

### MongoDB
```bash
mongorestore --drop backups/database/smsgateway_YYYYMMDD_HHMMSS/
```

### Nginx
```bash
cp backups/nginx/*.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/cattysms.shop /etc/nginx/sites-enabled/
nginx -t && nginx -s reload
```

### Stubs API
```bash
cp backups/stubs/*.php /var/www/html/stubs/
```

## Automation

Add to crontab for automated backups:
```bash
# Daily backup at 2 AM
0 2 * * * cd /var/www/cattysms && node script/backup.mjs >> backups/backup.log 2>&1
```
