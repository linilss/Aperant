#!/bin/bash
set -e

clear

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
