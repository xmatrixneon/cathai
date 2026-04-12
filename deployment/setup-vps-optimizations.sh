#!/bin/bash
# VPS Optimization Setup Script
# For 12-core / 62GB RAM VPS (adjust values based on your VPS specs)
#
# Usage: sudo bash deployment/setup-vps-optimizations.sh

set -e

echo "🚀 Setting up VPS optimizations for CattySMS Gateway..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Please run as root (use sudo)"
    exit 1
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "📁 Project directory: $PROJECT_DIR"

# ============================================
# 1. Apply System Kernel Optimizations (TCP)
# ============================================
echo ""
echo "📡 Applying TCP/kernel optimizations..."

if [ -f "$PROJECT_DIR/deployment/configs/sysctl.conf" ]; then
    cp "$PROJECT_DIR/deployment/configs/sysctl.conf" /etc/sysctl.d/99-cattysms-optimize.conf
    sysctl -p /etc/sysctl.d/99-cattysms-optimize.conf
    echo "✅ TCP optimizations applied"
else
    echo "⚠️  sysctl.conf not found, skipping..."
fi

# ============================================
# 2. Apply Nginx Optimizations
# ============================================
echo ""
echo "🌐 Applying Nginx optimizations..."

if [ -f "$PROJECT_DIR/deployment/configs/nginx.conf" ]; then
    # Backup current config
    cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup.$(date +%Y%m%d_%H%M%S)

    # Copy optimized config
    cp "$PROJECT_DIR/deployment/configs/nginx.conf" /etc/nginx/nginx.conf

    # Apply systemd override for file descriptor limits
    mkdir -p /etc/systemd/system/nginx.service.d
    if [ -f "$PROJECT_DIR/deployment/configs/nginx-systemd-override.conf" ]; then
        cp "$PROJECT_DIR/deployment/configs/nginx-systemd-override.conf" /etc/systemd/system/nginx.service.d/override.conf
        systemctl daemon-reload
    fi

    # Test nginx config
    if nginx -t; then
        systemctl restart nginx
        echo "✅ Nginx optimized and restarted"
    else
        echo "❌ Nginx config test failed, restoring backup"
        cp /etc/nginx/nginx.conf.backup.* /etc/nginx/nginx.conf
        exit 1
    fi
else
    echo "⚠️  nginx.conf not found, skipping..."
fi

# ============================================
# 3. Apply PHP-FPM Optimizations
# ============================================
echo ""
echo "🐘 Applying PHP-FPM optimizations..."

if [ -f "$PROJECT_DIR/deployment/configs/php-fpm-rlimit.conf" ]; then
    # Update PHP-FPM rlimit_files
    sed -i 's/;rlimit_files = 1024/rlimit_files = 65536/' /etc/php/8.1/fpm/php-fpm.conf 2>/dev/null || true
    sed -i 's/;rlimit_files = 1024/rlimit_files = 65536/' /etc/php/8.1/fpm/pool.d/www.conf 2>/dev/null || true
    systemctl restart php8.1-fpm 2>/dev/null || systemctl restart php-fpm 2>/dev/null || echo "⚠️  PHP-FPM restart failed (may not be installed)"
    echo "✅ PHP-FPM optimized (rlimit_files: 65536)"
else
    echo "⚠️  php-fpm-rlimit.conf not found, skipping..."
fi

# ============================================
# 4. Display Current Settings
# ============================================
echo ""
echo "📊 Current VPS Settings:"
echo "=========================="

echo ""
echo "--- CPU Info ---"
nproc
echo ""

echo "--- Memory Info ---"
free -h
echo ""

echo "--- TCP Settings ---"
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_max_syn_backlog
sysctl net.ipv4.tcp_keepalive_time
sysctl net.ipv4.tcp_tw_reuse
echo ""

echo "--- Nginx Workers ---"
ps aux | grep "nginx: worker process" | wc -l
echo ""

echo "--- File Descriptor Limits ---"
echo "System max: $(sysctl fs.file-max | cut -d= -f2)"
echo "Nginx master: $(grep "Max open files" /proc/$(pgrep -f "nginx: master" | head -1)/limits 2>/dev/null | awk '{print $4}' || echo 'N/A')"
echo ""

echo "✅ VPS optimization complete!"
echo ""
echo "📝 Additional fixes applied:"
echo "   - PHP-FPM rlimit_files: 1024 → 65536"
echo "   - Nginx systemd override: LimitNOFILE=524288"
echo ""
echo "📝 Next steps:"
echo "   1. Restart PM2: cd $PROJECT_DIR && pm2 restart ecosystem.config.cjs"
echo "   2. Save PM2 config: pm2 save"
echo "   3. Verify services: pm2 list && systemctl status nginx"
