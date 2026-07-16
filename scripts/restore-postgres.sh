#!/bin/sh
# Restore a ServiceHub PostgreSQL custom-format backup only to an explicit target.
# This script never supplies a database URL, password, target, or backup path itself.

set -eu

usage() {
  printf '%s\n' \
    'Usage: RESTORE_DATABASE_URL=<operator-supplied-url> RESTORE_TARGET_DB=<isolated-name> BACKUP_FILE=<file.dump> sh scripts/restore-postgres.sh' \
    '' \
    'Required environment:' \
    '  RESTORE_DATABASE_URL  Explicit PostgreSQL URL for an isolated target.' \
    '  RESTORE_TARGET_DB     Target database name; must exactly match the URL path.' \
    '  BACKUP_FILE           Existing pg_dump custom-format backup file.' \
    '' \
    'Safe names contain test, drill, restore, sandbox, or temporary. To restore' \
    'to another explicitly named target, set ALLOW_UNSAFE_RESTORE_TARGET=1.' \
    'Credentials must be supplied out of band (for example, a protected .pgpass file).' >&2
}

fail() {
  printf 'restore-postgres: %s\n' "$1" >&2
  exit 1
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  '') ;;
  *) usage; fail "unexpected argument: $1" ;;
esac

RESTORE_DATABASE_URL=${RESTORE_DATABASE_URL:-}
RESTORE_TARGET_DB=${RESTORE_TARGET_DB:-}
BACKUP_FILE=${BACKUP_FILE:-}
ALLOW_UNSAFE_RESTORE_TARGET=${ALLOW_UNSAFE_RESTORE_TARGET:-0}

[ -n "$RESTORE_DATABASE_URL" ] || { usage; fail 'RESTORE_DATABASE_URL is required.'; }
[ -n "$RESTORE_TARGET_DB" ] || { usage; fail 'RESTORE_TARGET_DB is required.'; }
[ -n "$BACKUP_FILE" ] || { usage; fail 'BACKUP_FILE is required.'; }
[ -f "$BACKUP_FILE" ] || fail 'BACKUP_FILE must be an existing regular file.'
[ -r "$BACKUP_FILE" ] || fail 'BACKUP_FILE is not readable.'
case "$RESTORE_DATABASE_URL" in
  postgres:*|postgresql:*) ;;
  *) fail 'RESTORE_DATABASE_URL must use a PostgreSQL URL scheme.' ;;
esac
case "$RESTORE_TARGET_DB" in
  *[!A-Za-z0-9_]*|'') fail 'RESTORE_TARGET_DB may contain only letters, digits, and underscores.' ;;
esac
case "$ALLOW_UNSAFE_RESTORE_TARGET" in
  0|1) ;;
  *) fail 'ALLOW_UNSAFE_RESTORE_TARGET must be 0 or 1.' ;;
esac

# Extract only the database path, then require a simple exact name match. This
# prevents a URL with an implicit or different target from bypassing the guard.
url_without_fragment=${RESTORE_DATABASE_URL%%\#*}
url_without_query=${url_without_fragment%%\?*}
url_database=${url_without_query##*/}
[ -n "$url_database" ] || fail 'RESTORE_DATABASE_URL must name a database.'
[ "$url_database" = "$RESTORE_TARGET_DB" ] || fail 'RESTORE_TARGET_DB must exactly match the database name in RESTORE_DATABASE_URL.'

case "$RESTORE_TARGET_DB" in
  *test*|*TEST*|*Test*|*drill*|*DRILL*|*Drill*|*restore*|*RESTORE*|*Restore*|*sandbox*|*SANDBOX*|*Sandbox*|*temporary*|*TEMPORARY*|*Temporary*) safe_target=1 ;;
  *) safe_target=0 ;;
esac
if [ "$safe_target" -ne 1 ]; then
  [ "$ALLOW_UNSAFE_RESTORE_TARGET" = 1 ] || fail 'target name is not recognizably isolated; choose a test/drill/restore/sandbox/temporary name or explicitly opt in.'
  printf '%s\n' 'restore-postgres: WARNING: unsafe target-name guard explicitly overridden.' >&2
fi

command -v pg_restore >/dev/null 2>&1 || fail 'pg_restore is required but was not found in PATH.'
printf 'Restoring %s into explicitly selected target %s\n' "$BACKUP_FILE" "$RESTORE_TARGET_DB"
exec pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
