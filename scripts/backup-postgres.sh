#!/bin/sh
# Create an encrypted-at-rest-by-operator PostgreSQL custom-format backup.
# This script never supplies a database URL, password, or output location itself.

set -eu
umask 077

usage() {
  printf '%s\n' \
    'Usage: BACKUP_DATABASE_URL=<operator-supplied-url> BACKUP_DIR=<existing-directory> sh scripts/backup-postgres.sh' \
    '' \
    'Required environment:' \
    '  BACKUP_DATABASE_URL  PostgreSQL URL for the database to back up.' \
    '  BACKUP_DIR           Existing directory selected by the operator.' \
    '' \
    'The backup is written in pg_dump custom format. Credentials must be supplied' \
    'out of band (for example, a protected .pgpass file), never on this command line.' >&2
}

fail() {
  printf 'backup-postgres: %s\n' "$1" >&2
  exit 1
}

case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  '') ;;
  *) usage; fail "unexpected argument: $1" ;;
esac

BACKUP_DATABASE_URL=${BACKUP_DATABASE_URL:-}
BACKUP_DIR=${BACKUP_DIR:-}

[ -n "$BACKUP_DATABASE_URL" ] || { usage; fail 'BACKUP_DATABASE_URL is required.'; }
[ -n "$BACKUP_DIR" ] || { usage; fail 'BACKUP_DIR is required.'; }
[ -d "$BACKUP_DIR" ] || fail 'BACKUP_DIR must be an existing directory.'
[ -w "$BACKUP_DIR" ] || fail 'BACKUP_DIR is not writable.'
case "$BACKUP_DATABASE_URL" in
  postgres:*|postgresql:*) ;;
  *) fail 'BACKUP_DATABASE_URL must use a PostgreSQL URL scheme.' ;;
esac
command -v pg_dump >/dev/null 2>&1 || fail 'pg_dump is required but was not found in PATH.'
command -v date >/dev/null 2>&1 || fail 'date is required but was not found in PATH.'

# The filename is intentionally independent of the URL so database identifiers
# and credentials cannot be leaked through the filesystem or command output.
timestamp=$(date -u '+%Y%m%dT%H%M%SZ') || fail 'could not determine UTC timestamp.'
backup_file="$BACKUP_DIR/servicehub-postgres-$timestamp-$$.dump"
[ ! -e "$backup_file" ] || fail 'refusing to overwrite an existing backup file.'

printf 'Writing PostgreSQL custom-format backup to %s\n' "$backup_file"
if ! pg_dump --format=custom --file="$backup_file" "$BACKUP_DATABASE_URL"; then
  rm -f "$backup_file"
  fail 'pg_dump failed; removed the incomplete output file.'
fi
[ -s "$backup_file" ] || { rm -f "$backup_file"; fail 'pg_dump produced an empty backup file.'; }
printf 'Backup completed: %s\n' "$backup_file"
