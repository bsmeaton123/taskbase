#!/bin/sh
# Nightly taskbase backups.
#
#   - A Postgres dump every night at BACKUP_TIME, kept on the server for BACKUP_KEEP_DAYS.
#   - Optionally, the dumps and all uploaded files copied off-site to BACKUP_REMOTE (any
#     rclone remote: S3, Backblaze B2, Cloudflare R2, Google Drive, ...). Off-site copies are
#     additive, so a file deleted in the app is still in the off-site copy.
#   - A Slack message if a backup fails (SLACK_ALERTS_WEBHOOK_URL).
#
#   backup.sh         run forever, backing up once a day (the container's default)
#   backup.sh now     run one backup immediately and exit
#
# Connection settings come from the standard PGHOST / PGUSER / PGPASSWORD / PGDATABASE.
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
AT="${BACKUP_TIME:-02:30}"
UPLOADS="${UPLOADS_DIR:-/uploads}"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

alert() {
  [ -n "${SLACK_ALERTS_WEBHOOK_URL:-}" ] || return 0
  msg=$(printf '%s' "$1" | tr '"\\' "''")
  wget -q -O /dev/null --header 'Content-Type: application/json' \
    --post-data "{\"text\":\":warning: taskbase backup failed: $msg\"}" \
    "$SLACK_ALERTS_WEBHOOK_URL" || log "could not send the Slack alert"
}

run_backup() {
  mkdir -p "$BACKUP_DIR/db" || return 1
  file="$BACKUP_DIR/db/taskbase-$(date '+%Y%m%d-%H%M%S').dump"

  # Write to a temporary name first so a half-written dump never looks like a good one.
  pg_dump --format=custom --no-owner --file="$file.partial" || { rm -f "$file.partial"; return 1; }
  mv "$file.partial" "$file" || return 1
  log "database saved to $file ($(du -h "$file" | cut -f1))"

  find "$BACKUP_DIR/db" -name 'taskbase-*.dump' -mtime +"$KEEP_DAYS" -delete

  if [ -n "${BACKUP_REMOTE:-}" ]; then
    rclone copy "$BACKUP_DIR/db" "$BACKUP_REMOTE/db" || return 1
    if [ -d "$UPLOADS" ]; then
      rclone copy "$UPLOADS" "$BACKUP_REMOTE/uploads" || return 1
    fi
    log "copied off-site to $BACKUP_REMOTE"
  fi
}

attempt() {
  out=$(run_backup 2>&1)
  status=$?
  [ -n "$out" ] && echo "$out"
  if [ $status -ne 0 ]; then
    log "FAILED"
    alert "$(echo "$out" | tail -n 3)"
    return 1
  fi
}

if [ "${1:-}" = "now" ]; then
  attempt
  exit $?
fi

# The time is matched as text against the clock, so it has to be HH:MM (e.g. 02:30, not 2:30).
case "$AT" in
  [0-2][0-9]:[0-5][0-9]) ;;
  *)
    log "BACKUP_TIME must look like 02:30 (got '$AT'); using 02:30"
    alert "BACKUP_TIME '$AT' isn't valid, falling back to 02:30"
    AT="02:30"
    ;;
esac

log "running daily at $AT (${TZ:-UTC}), keeping $KEEP_DAYS days${BACKUP_REMOTE:+, off-site to $BACKUP_REMOTE}"

# Take a first backup straight away on a fresh server.
if ! ls "$BACKUP_DIR"/db/taskbase-*.dump >/dev/null 2>&1; then
  attempt
fi

# Once a day, also check that a recent dump exists at all: if the loop was stuck or the
# disk was full, someone hears about it rather than finding out at restore time.
stale_check() {
  newest=$(find "$BACKUP_DIR/db" -name 'taskbase-*.dump' -mmin -1560 2>/dev/null | head -n 1)
  if [ -z "$newest" ]; then
    log "WARNING: no database backup in the last 26 hours"
    alert "no database backup has been made in the last 26 hours"
  fi
}

last=""
checked=""
while true; do
  today=$(date '+%Y-%m-%d')
  now=$(date '+%H:%M')
  if [ "$now" = "$AT" ] && [ "$last" != "$today" ]; then
    last="$today"
    attempt
  fi
  if [ "$now" = "12:00" ] && [ "$checked" != "$today" ]; then
    checked="$today"
    stale_check
  fi
  sleep 20
done
