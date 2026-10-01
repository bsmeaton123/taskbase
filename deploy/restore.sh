#!/bin/sh
# Restore the database from a dump made by the backup service. Run on the server, from
# the project folder:
#
#   deploy/restore.sh backups/db/taskbase-20261001-023000.dump
#
# Uploaded files live in the "uploads" volume and aren't touched. If you lost those too,
# copy them back from the off-site remote first (see deploy/HOSTINGER.md).
set -eu

dump="${1:-}"
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "Usage: deploy/restore.sh <path to .dump file>"
  echo "Available backups:"
  ls -1t backups/db/*.dump 2>/dev/null | head -n 10 || echo "  (none in backups/db)"
  exit 1
fi

echo "This replaces everything in the taskbase database with:"
echo "  $dump"
printf "Type 'restore' to continue: "
read -r answer
[ "$answer" = "restore" ] || { echo "Cancelled."; exit 1; }

echo "Taking a safety backup of the current database first..."
docker compose exec -T backup backup.sh now

# Whatever happens below, bring the app back up.
trap 'docker compose start app >/dev/null 2>&1' EXIT
docker compose stop app
docker compose exec -T db pg_restore --clean --if-exists --no-owner \
  -U digibooth -d digibooth < "$dump"

# Sessions from the dump would sign people back in as they were then. Clear them, so
# everyone signs in fresh, and re-check anyone deactivated since the backup was taken.
docker compose exec -T db psql -U digibooth -d digibooth -c 'delete from "session";' >/dev/null
echo "Restored. The app is starting again. Everyone will need to sign in."
echo "If anyone was deactivated after this backup was taken, deactivate them again on the People page."
