# CattySMS Gateway - Complete Deployment Guide

## Context

This deployment guide documents the complete system configuration for deploying CattySMS Gateway on a new VPS. The system consists of:

1. **Manager** - Next.js 15 application (Node.js) for device/SMS management via WebSocket
2. **Stubs API** - PHP 8.1 API for external SMS activation services
3. **BullMQ Workers** - 6 background workers for device sync, SMS fetch, quality monitoring, etc.

Current production specs: **12-core CPU / 62GB RAM / Ubuntu 22.04 LTS**

---

## Quick Start - New VPS Deployment

```bash
# 1. Update system and install dependencies
sudo apt update && sudo apt upgrade -y
sudo apt install -y git nginx redis-server php8.1-fpm php8.1-mongodb composer

# 2. Clone repository (replace with your repo)
cd /home/deploy/apps
git clone <your-repo-url> cattysms
cd cattysms

# 3. Install Node.js dependencies
npm install

# 4. Set up environment variables
cp .env.example .env
nano .env  # Edit: MONGODB_URI, JWT_SECRET, REDIS_URI, etc.

# 5. Build Next.js app
npm run build

# 6. Setup PHP Stubs API
sudo mkdir -p /var/www/html/stubs
sudo chown -R www-data:www-data /var/www/html/stubs
cd /var/www/html/stubs
# Copy PHP files from project or install dependencies
composer install

# 7. Apply VPS optimizations (nginx, sysctl, PHP-FPM)
cd /home/deploy/apps/cattysms
sudo bash deployment/setup-vps-optimizations.sh

# 8. Configure nginx sites
sudo cp deployment/sites-available/*.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/cattysms.shop.conf /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/api.cattysms.shop.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl restart nginx

# 9. Setup SSL with Certbot
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d cattysms.shop -d api.cattysms.shop

# 10. Start PM2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup

# 11. Verify services
pm2 list
sudo systemctl status nginx
sudo systemctl status php8.1-fpm
sudo systemctl status redis-server
```

---

## System Architecture

### Components

| Component | Technology | Purpose | Instances |
|-----------|------------|---------|-----------|
| Manager | Next.js 15 (Node.js) | Device management, WebSocket gateway | 6 (cluster) |
| Stubs API | PHP 8.1 | External SMS activation API | Nginx/PHP-FPM |
| Redis | 6.2+ | BullMQ job queue | 1 |
| MongoDB | 5.0+ | Database | External/Local |
| Nginx | 1.23+ | Reverse proxy, SSL, WebSocket | Auto (CPU cores) |

### PM2 Applications (7 processes)

| Name | Script | Concurrency | Purpose |
|------|--------|-------------|---------|
| manager | npm start | cluster (6 instances) | Main Next.js app |
| worker:fetch | workers/fetch-worker.js | 12 jobs | SMS fetch from devices |
| worker:status | workers/status-worker.js | 6 jobs | Device/number status sync |
| worker:keepalive | workers/keepalive-worker.js | 6 jobs | FCM keep-alive pings |
| worker:wakeup | workers/wakeup-worker.js | 6 jobs | Device wake-up |
| worker:suspend | workers/suspend-worker.js | 4 jobs | Quality monitoring |
| worker:cleanup | workers/cleanup-worker.js | 1 job | Message cleanup |

---

## Critical Configuration Files

### 1. PM2 Ecosystem (`ecosystem.config.cjs`)

**Auto-scaling based on hardware:**
- `managerInstances = floor(cpuCount / 2)` - 6 for 12 cores
- `highConcurrencyWorkers = cpuCount` - 12 for heavy workers
- `mediumConcurrencyWorkers = floor(cpuCount / 2)` - 6 for medium workers

**Node heap sizes:**
- Manager: `--max-old-space-size=2048`
- Fetch worker: `--max-old-space-size=1024`
- Status worker: `--max-old-space-size=2048`
- Other workers: `--max-old-space-size=300-512`

### 2. Nginx Main Config (`/etc/nginx/nginx.conf`)

**Key settings for 12-core / 62GB RAM:**
```nginx
user www-data;
worker_processes auto;              # Auto-detect (12 workers)
worker_connections 32768;           # Max connections per worker
worker_rlimit_nofile 131072;        # File descriptor limit

events {
    multi_accept on;
    use epoll;
    accept_mutex off;
}

http {
    keepalive_timeout 65;
    keepalive_requests 10000;
    client_body_timeout 30;
    client_header_timeout 30;
    send_timeout 30;
}
```

### 3. Systemd Override (`/etc/systemd/system/nginx.service.d/override.conf`)

```ini
[Service]
LimitNOFILE=524288
```

### 4. PHP-FPM Pool (`/etc/php/8.1/fpm/pool.d/www.conf`)

```ini
pm = dynamic
pm.max_children = 5
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
rlimit_files = 65536
```

### 5. System Kernel (`/etc/sysctl.d/99-cattysms-optimize.conf`)

```
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
fs.file-max = 2097152
```

---

## Environment Variables (`.env`)

**Required:**
```bash
# Database
MONGODB_URI=mongodb://localhost:27017/cattysms
REDIS_URI=redis://localhost:6379

# Security
JWT_SECRET=<your-secure-secret-key>

# Server
PORT=3000
NODE_ENV=production

# URLs
FRONTEND_URL=https://cattysms.shop
BACKEND_URL=https://api.cattysms.shop
NEXT_PUBLIC_API_URL=https://api.cattysms.shop
```

**Optional but recommended:**
```bash
# Device management
DEVICE_AUTO_DELETE_ENABLED=true
DEVICE_AUTO_DELETE_HOURS=24

# BullMQ Workers (enable individually)
BULLMQ_STATUS_ENABLED=true
BULLMQ_FETCH_ENABLED=true
BULLMQ_SUSPEND_ENABLED=true
BULLMQ_CLEANUP_ENABLED=true
BULLMQ_KEEPALIVE_ENABLED=true
BULLMQ_WAKEUP_ENABLED=true

# SMS Quality
SMS_SUSPEND_THRESHOLD=0
SMS_SUSPEND_WINDOW_HOURS=12

# Firebase (for device wake-up)
FCM_SERVICE_ACCOUNT_KEY=/path/to/service-account.json
```

---

## Nginx Site Configurations

### Main Site (`cattysms.shop.conf`)

- Serves Next.js static files from `/var/www/html`
- WebSocket proxy for `/gateway` endpoint
- PHP proxy for Stubs API (`*.php` files)
- HTTPS with Let's Encrypt

### API Site (`api.cattysms.shop.conf`)

- Proxies all requests to Next.js backend on port 3000
- WebSocket proxy for `/gateway` endpoint
- HTTPS with Let's Encrypt

**WebSocket proxy headers (critical):**
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 86400;
proxy_send_timeout 86400;
```

---

## VPS Migration / Server Change Checklist

### Before Migration

1. **Backup current data:**
   ```bash
   cd /home/deploy/apps/cattysms
   npm run backup
   ```

2. **Export PM2 config:**
   ```bash
   pm2 export pm2-backup.json
   ```

3. **Save SSL certificates:**
   ```bash
   sudo tar -czf ssl-backup.tar.gz /etc/letsencrypt/
   ```

4. **Save nginx configs:**
   ```bash
   sudo tar -czf nginx-backup.tar.gz /etc/nginx/
   ```

5. **Save PHP-FPM config:**
   ```bash
   sudo tar -czf php-fpm-backup.tar.gz /etc/php/8.1/fpm/
   ```

### On New VPS

1. **Install base packages:**
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y git nginx redis-server php8.1-fpm php8.1-mongodb composer certbot
   ```

2. **Clone repository:**
   ```bash
   cd /home/deploy/apps
   git clone <your-repo-url> cattysms
   cd cattysms
   npm install
   npm run build
   ```

3. **Copy environment file:**
   ```bash
   # Copy from old server or create new
   cp .env.example .env
   nano .env  # Add MONGODB_URI, JWT_SECRET, etc.
   ```

4. **Setup PHP Stubs API:**
   ```bash
   sudo mkdir -p /var/www/html/stubs
   sudo chown -R www-data:www-data /var/www/html/stubs
   cd /var/www/html/stubs
   composer install
   # Copy handler_api.php, 2handler_api.php from old server
   ```

5. **Apply VPS optimizations:**
   ```bash
   cd /home/deploy/apps/cattysms
   sudo bash deployment/setup-vps-optimizations.sh
   ```

6. **Configure nginx:**
   ```bash
   # Copy site configs from repository
   sudo cp deployment/sites-available/*.conf /etc/nginx/sites-available/
   sudo ln -sf /etc/nginx/sites-available/cattysms.shop.conf /etc/nginx/sites-enabled/
   sudo ln -sf /etc/nginx/sites-available/api.cattysms.shop.conf /etc/nginx/sites-enabled/
   sudo nginx -t
   ```

7. **Setup SSL (Option A - New Certs):**
   ```bash
   sudo certbot --nginx -d cattysms.shop -d api.cattysms.shop
   ```

   **Option B - Restore Old Certs:**
   ```bash
   # Copy ssl-backup.tar.gz and restore
   sudo tar -xzf ssl-backup.tar.gz -C /
   ```

8. **Restore MongoDB data (if local):**
   ```bash
   # Copy backup from old server
   mongorestore --uri "mongodb://localhost:27017" /path/to/backup/mongodb
   ```

9. **Start services:**
   ```bash
   sudo systemctl restart nginx
   sudo systemctl restart php8.1-fpm
   sudo systemctl restart redis-server

   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup
   ```

10. **Verify:**
    ```bash
    pm2 list
    sudo systemctl status nginx php8.1-fpm redis-server
    curl https://cattysms.shop
    curl https://api.cattysms.shop/api/overview/stats
    ```

---

## Scaling for Different VPS Sizes

### Small VPS (2-4 cores, 4-8GB RAM)

**Edit `ecosystem.config.cjs`:**
```javascript
const managerInstances = 2;  // Fixed
const highConcurrencyWorkers = 4;
const mediumConcurrencyWorkers = 2;
```

**Edit nginx.conf:**
```nginx
worker_connections 8192;
worker_rlimit_nofile 65535;
```

### Medium VPS (8 cores, 16-32GB RAM)

**Edit `ecosystem.config.cjs`:**
```javascript
const managerInstances = Math.floor(cpuCount / 3);  // ~2-3
const highConcurrencyWorkers = cpuCount;  // 8
const mediumConcurrencyWorkers = Math.floor(cpuCount / 2);  // 4
```

**Edit nginx.conf:**
```nginx
worker_connections 16384;
worker_rlimit_nofile 65535;
```

### Large VPS (12+ cores, 64GB+ RAM) - Current Configuration

No changes needed - using current optimized values.

---

## Monitoring Commands

### PM2
```bash
pm2 list                    # List all processes
pm2 monit                   # Live monitoring
pm2 logs manager            # View manager logs
pm2 logs worker:fetch       # View fetch worker logs
pm2 flush                   # Clear all logs
```

### System Resources
```bash
htop                        # CPU/Memory monitoring
free -h                     # Memory usage
df -h                       # Disk usage
nethogs                     # Network usage by process
```

### Nginx
```bash
sudo systemctl status nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### PHP-FPM
```bash
sudo systemctl status php8.1-fpm
sudo tail -f /var/log/php8.1-fpm.log
```

### Redis
```bash
sudo systemctl status redis-server
redis-cli info
redis-cli --latency
```

---

## Troubleshooting

### Nginx won't start
```bash
sudo nginx -t              # Test configuration
sudo tail -f /var/log/nginx/error.log
```

### PM2 processes crash
```bash
pm2 logs --lines 100       # View error logs
pm2 restart <app-name>     # Restart specific app
pm2 delete all             # Remove all and restart
```

### WebSocket connection issues
- Check nginx WebSocket proxy headers are present
- Verify `proxy_read_timeout` and `proxy_send_timeout` are high (86400)
- Check firewall allows ports 80/443

### High memory usage
```bash
pm2 list                   # Check per-process memory
# Adjust max-old-space-size in ecosystem.config.cjs if needed
```

---

## Maintenance Tasks

### Daily
- Monitor PM2 logs for errors
- Check disk space: `df -h`

### Weekly
- Review queue statistics: `curl https://api.cattysms.shop/api/queues/stats`
- Check for failed jobs in DLQ

### Monthly
- Update system: `sudo apt update && sudo apt upgrade`
- Check SSL certificate expiration: `sudo certbot certificates`
- Review MongoDB storage and consider backup rotation

---

## Security Checklist

- [ ] Strong JWT_SECRET in .env
- [ ] MongoDB authentication enabled (if not local)
- [ ] Redis password protected (if accessible externally)
- [ ] SSL certificates valid and auto-renewing
- [ ] Firewall configured (UFW) to only allow necessary ports
- [ ] Regular system updates applied
- [ ] Log rotation configured for nginx and PM2

---

## Backup Strategy

Run backup script:
```bash
cd /home/deploy/apps/cattysms
npm run backup
```

Backups are stored in: `/home/deploy/apps/cattysms/backups/`

**Automate with crontab:**
```bash
# Daily backup at 2 AM
0 2 * * * cd /home/deploy/apps/cattysms && npm run backup
```
