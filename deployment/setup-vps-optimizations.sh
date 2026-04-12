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

    # Test nginx config
    if nginx -t; then
        systemctl reload nginx
        echo "✅ Nginx optimized and reloaded"
    else
        echo "❌ Nginx config test failed, restoring backup"
        cp /etc/nginx/nginx.conf.backup.* /etc/nginx/nginx.conf
        exit 1
    fi
else
    echo "⚠️  nginx.conf not found, skipping..."
fi

# ============================================
# 3. Display Current Settings
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

echo "✅ VPS optimization complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Restart PM2: cd $PROJECT_DIR && pm2 restart ecosystem.config.cjs"
echo "   2. Save PM2 config: pm2 save"
echo "   3. Verify services: pm2 list && systemctl status nginx"
