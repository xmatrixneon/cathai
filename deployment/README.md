# VPS Optimization Deployment

This folder contains configuration files and scripts for deploying CattySMS Gateway on a new VPS with optimized settings.

## VPS Specifications (Current Configuration)

These configs are optimized for:
- **CPU:** 12 cores
- **RAM:** 62GB
- **OS:** Ubuntu 22.04 LTS

For different VPS specs, adjust values in the config files.

## Quick Start (New VPS Deployment)

```bash
# 1. Clone the repository
git clone <your-repo-url> cattysms
cd cattysms

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
nano .env  # Add your MONGODB_URI, JWT_SECRET, etc.

# 4. Apply VPS optimizations (requires sudo)
sudo bash deployment/setup-vps-optimizations.sh

# 5. Start PM2 with optimized config
pm2 start ecosystem.config.cjs
pm2 save

# 6. Verify services
pm2 list
sudo systemctl status nginx
```

## Configuration Files

### `configs/nginx.conf`
Optimized nginx configuration for high-concurrency WebSocket connections.

**Key settings:**
- `worker_processes auto` - Auto-detects CPU cores
- `worker_connections 32768` - Max connections per worker
- `worker_rlimit_nofile 131072` - File descriptor limit
- SSL session cache: 50MB
- Upstream keepalive: 128 connections

### `configs/sysctl.conf`
System kernel TCP optimizations for better connection handling.

**Key settings:**
- `somaxconn = 4096` - Connection queue size
- `tcp_max_syn_backlog = 8192` - Pending connections
- `tcp_keepalive_time = 600` - Detect dead connections in 10 min
- `tcp_tw_reuse = 1` - Reuse TIME_WAIT connections

### `../ecosystem.config.cjs`
PM2 process manager configuration with auto-scaling based on CPU cores.

**Key settings:**
- Manager instances: `floor(cpuCount / 2)` = 6 for 12 cores
- Worker concurrency: Scaled based on available cores
- No memory limits (removed max_memory_restart)

## Adjusting for Different VPS Sizes

### Small VPS (2-4 cores, 4-8GB RAM)
```bash
# nginx.conf
worker_connections 8192;
worker_rlimit_nofile 65535;

# ecosystem.config.cjs
const managerInstances = 2;  // Fixed for small VPS
const highConcurrencyWorkers = 4;
```

### Medium VPS (8 cores, 16-32GB RAM)
```bash
# nginx.conf
worker_connections 16384;
worker_rlimit_nofile 65535;

# ecosystem.config.cjs
const managerInstances = Math.floor(cpuCount / 3);
```

### Large VPS (16+ cores, 64GB+ RAM)
```bash
# nginx.conf
worker_connections 32768;
worker_rlimit_nofile 131072;

# ecosystem.config.cjs
const managerInstances = Math.floor(cpuCount / 2);
```

## Verification Commands

```bash
# Check PM2 processes
pm2 list

# Check nginx status
sudo systemctl status nginx

# Check TCP settings
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_keepalive_time

# Check nginx worker processes
ps aux | grep "nginx: worker process" | wc -l

# Monitor real-time
pm2 monit
```

## Troubleshooting

### Nginx fails to reload
```bash
# Test configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log
```

### PM2 processes won't start
```bash
# Check logs
pm2 logs --lines 100

# Restart specific app
pm2 restart worker:status
```

### High memory usage
```bash
# Check memory usage
pm2 list

# If needed, add memory limits back to ecosystem.config.cjs
max_memory_restart: '2G',
```

## Monitoring

For production deployment, consider setting up:

1. **PM2 Plus** - Process monitoring
2. **Grafana + Prometheus** - Metrics dashboards
3. **Uptime monitoring** - External health checks
4. **Log aggregation** - ELK stack or similar

## Security Notes

- Keep SSL certificates updated (Let's Encrypt)
- Regularly update system packages: `sudo apt update && sudo apt upgrade`
- Monitor PM2 logs for suspicious activity
- Use strong JWT_SECRET in environment variables
- Restrict API access with proper authentication
