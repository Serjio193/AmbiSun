#!/bin/sh

SERVICE_ID="com.github.serjio193.ambisun.service"
APP_ID="com.github.serjio193.ambisun"
ELEVATE_BIN="/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service"
LOG_FILE="/tmp/ambisun-autostart.log"

if [ "$(id -u)" != 0 ]; then exit 1; fi
if [ "$1" = "--install" ]; then
    HOOK="/var/lib/webosbrew/init.d/90-ambisun"
    SOURCE="/media/developer/apps/usr/palm/services/$SERVICE_ID/homebrew-autostart.sh"
    mkdir -p /var/lib/webosbrew/init.d || exit 1
    cp "$SOURCE" "$HOOK.new" && chmod 755 "$HOOK.new" &&
        mv -f "$HOOK.new" "$HOOK" || exit 1
fi
[ -f "/media/developer/apps/usr/palm/services/$SERVICE_ID/service.js" ] || exit 0
{
    echo "[$(date)] Restoring AmbiSun elevation..."
    if [ -x "$ELEVATE_BIN" ]; then
        "$ELEVATE_BIN" "$SERVICE_ID" "$APP_ID" || exit 1
        grep -F -q 'Exec=/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/run-js-service ' \
            "/var/luna-service2-dev/services.d/$SERVICE_ID.service" || exit 1
    else
        echo "Elevation helper is not available: $ELEVATE_BIN"
        exit 1
    fi
} >> "$LOG_FILE" 2>&1
[ "$1" = "--install" ] && exit 0

# Activity Manager may have started a jailed instance before this hook ran.
# Stop it so the next request uses the launcher patched by Homebrew.
sleep 1
luna-send -n 1 -w 5000 "luna://$SERVICE_ID/restartAfterElevation" '{}' >> "$LOG_FILE" 2>&1
sleep 1
luna-send -n 1 -w 5000 "luna://$SERVICE_ID/ping" '{}' >> "$LOG_FILE" 2>&1

for attempt in 1 2 3 4 5; do
    pid=$(pgrep -f '^com.github.serjio193.ambisun.service$' | head -1)
    if [ -n "$pid" ] && [ -r "/proc/$pid/status" ]; then
        uid=$(awk '/^Uid:/{print $2}' "/proc/$pid/status")
        [ "$uid" = 0 ] && exit 0
    fi
    sleep 1
done
echo "AmbiSun did not start as root" >> "$LOG_FILE"
exit 1
