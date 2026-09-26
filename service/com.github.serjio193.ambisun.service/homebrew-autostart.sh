#!/bin/sh

SERVICE_ID="com.github.serjio193.ambisun.service"
APP_ID="com.github.serjio193.ambisun"
ELEVATE_BIN="/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service"
LOG_FILE="/tmp/ambisun-autostart.log"

{
    echo "[$(date)] Restoring AmbiSun elevation..."
    if [ -x "$ELEVATE_BIN" ]; then
        "$ELEVATE_BIN" "$APP_ID"
        "$ELEVATE_BIN" "$SERVICE_ID"
    else
        echo "Elevation helper is not available: $ELEVATE_BIN"
    fi
} >> "$LOG_FILE" 2>&1

# Activity Manager may have started a jailed instance before this hook ran.
# Stop it so the next request uses the launcher patched by Homebrew.
sleep 1
luna-send -n 1 -f "luna://$SERVICE_ID/restartAfterElevation" '{}' >/dev/null 2>&1 || true
sleep 1
luna-send -n 1 -f "luna://$SERVICE_ID/ping" '{}' >/dev/null 2>&1 &

exit 0
