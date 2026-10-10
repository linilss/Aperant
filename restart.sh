#!/bin/bash
set -e

# Only clear when attached to a terminal (fails without TERM under set -e)
[ -t 1 ] && clear || true

cd "$(dirname "$0")"

echo "Killing existing malvy instances..."
pkill -f "malvy" 2>/dev/null || true
pkill -f "electron ." 2>/dev/null || true
sleep 1

echo "Building..."
cd apps/desktop
npm run build

echo "Starting..."
npm run start
