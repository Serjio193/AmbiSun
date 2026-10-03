#!/bin/sh

# Homebrew's Luna exec can provide a reduced PATH. elevate-service invokes
# ls-control, which in turn needs mktemp, sed, and other system utilities.
PATH="/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}"
export PATH

SERVICE_ID="com.github.serjio193.ambisun.service"
ELEVATE_BIN="/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service"
LOG_FILE="/tmp/ambisun-autostart.log"

if [ "$(id -u)" != 0 ]; then exit 1; fi
MODE="$1"

if [ "$MODE" = "--install" ]; then
    HOOK="/var/lib/webosbrew/init.d/90-ambisun"
    HOOK_NEW="$HOOK.new"
    SOURCE="/media/developer/apps/usr/palm/services/$SERVICE_ID/homebrew-autostart.sh"
    mkdir -p /var/lib/webosbrew/init.d || exit 1
    cp "$SOURCE" "$HOOK_NEW" && chmod 755 "$HOOK_NEW" &&
        mv -f "$HOOK_NEW" "$HOOK" || exit 1
    if [ -L "$HOOK" ] || [ ! -x "$HOOK" ]; then
        echo "[$(date)] Boot hook is not an executable independent file: $HOOK" >> "$LOG_FILE"
        exit 1
    fi
    exit 0
fi

[ -f "/media/developer/apps/usr/palm/services/$SERVICE_ID/service.js" ] || exit 0

echo "[$(date)] Restoring AmbiSun elevation..." >> "$LOG_FILE" 2>&1

if [ -x "$ELEVATE_BIN" ]; then
    "$ELEVATE_BIN" "$SERVICE_ID" >> "$LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
        echo "[$(date)] elevate-service failed for $SERVICE_ID" >> "$LOG_FILE"
        exit 1
    fi
else
    echo "Elevation helper is not available: $ELEVATE_BIN" >> "$LOG_FILE"
    exit 1
fi

# Ensure the base service permissions include "public"
PERMS_FILE="/var/luna-service2-dev/client-permissions.d/$SERVICE_ID.service.json"
if [ -f "$PERMS_FILE" ] && ! grep -q '"public"' "$PERMS_FILE" 2>/dev/null; then
    sed -i 's/\]}/,"public"]}/' "$PERMS_FILE" && ls-control scan-services >/dev/null 2>&1
    echo "[$(date)] Added 'public' to base service permissions" >> "$LOG_FILE"
fi

if [ "$MODE" = "--recover" ]; then
    exit 0
fi

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
