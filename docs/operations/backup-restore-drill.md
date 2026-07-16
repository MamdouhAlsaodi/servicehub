# PostgreSQL backup and restore drill

## Scope and safety boundary

These scripts are operator-run recovery tools, not deployment automation. They do **not** contain a password, connection URL, default database, or automatic schedule. No automated backup cron is enabled by this repository. Use a managed-backup service and retention policy where production requirements call for one.

Never run a restore drill against a shared, local development, staging, or production ServiceHub database. The restore script requires both a complete target URL and a matching `RESTORE_TARGET_DB`; by default that name must visibly indicate isolation (`test`, `drill`, `restore`, `sandbox`, or `temporary`). An override exists only for a consciously reviewed exceptional target and must not be used to bypass this boundary.

## Prerequisites

1. Obtain authorization for the source data and create a disposable PostgreSQL target that is isolated by host, credentials, and database name. Ensure the target is empty or intentionally disposable.
2. Install PostgreSQL client tools (`pg_dump`, `pg_restore`, and `pg_verifybackup` if validating physical backups) compatible with the server version.
3. Choose a protected, access-controlled existing backup directory. Keep the backup outside the repository and apply the organization retention/encryption policy.
4. Provide credentials through an approved mechanism such as a permission-restricted `~/.pgpass`, a short-lived identity token, or a secret manager. Do not put passwords in shell history, source code, CI logs, URLs copied into tickets, or this runbook.
5. Record the intended source, isolated target, operator, timestamp, backup checksum, and validation result in the incident/change record. Do not record secrets.

## Create a logical backup

From the repository root, supply values only from the operator's secure environment. The script refuses missing values and writes a custom-format dump with a UTC timestamp and restrictive file permissions.

```sh
BACKUP_DATABASE_URL="$BACKUP_DATABASE_URL" \
BACKUP_DIR=/secure/operator-selected/backups \
sh scripts/backup-postgres.sh
```

The source URL is mandatory; there is no fallback to `servicehub`, localhost, a Compose service, staging, or production. The successful command prints the exact dump path. Preserve that path in the recovery record.

## Verify the backup before a drill

1. Confirm the script exited successfully and that the dump file exists with expected restrictive ownership and permissions.
2. Calculate and retain a checksum using the organization-approved tool and compare it after any copy. Store the checksum separately from the dump where practical.
3. Inspect the custom archive without connecting to a database:

```sh
pg_restore --list /secure/operator-selected/backups/servicehub-postgres-<timestamp>-<pid>.dump
```

4. Review the archive list for expected schemas/tables and confirm the backup timestamp and source scope from the change record. An archive listing and checksum prove readability/integrity only; they do not prove application-level recoverability.

## Temporary-target restore drill

1. Create or obtain an **empty disposable** target whose name, for example, includes `restore_drill`. Ensure its URL path matches the target name exactly.
2. Confirm the target is not shared and contains no data that must be preserved. `--clean --if-exists` removes matching objects in the selected target.
3. Supply the backup file, URL, and explicit target name. The normal guard accepts isolated names; do not set `ALLOW_UNSAFE_RESTORE_TARGET=1` for a routine drill.

```sh
RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" \
RESTORE_TARGET_DB=servicehub_restore_drill \
BACKUP_FILE=/secure/operator-selected/backups/servicehub-postgres-<timestamp>-<pid>.dump \
sh scripts/restore-postgres.sh
```

4. Capture `pg_restore` exit status and output in the recovery record. The restore uses `--exit-on-error`, `--clean`, `--if-exists`, `--no-owner`, and `--no-privileges`; review role/extension requirements separately because those options do not recreate every environment dependency.
5. On the isolated target only, run the approved application smoke checks, schema/object counts, and a representative read-only data check. Compare results with the recorded expected scope. Do not treat a process health endpoint as database verification.

## Cleanup

After documenting drill results, revoke temporary access and destroy the disposable target and its credentials according to the platform procedure. Securely retain or delete the dump and checksum according to the approved retention policy. Do not delete a backup that is the only recovery point. Record cleanup completion, elapsed recovery time, failures, and follow-up actions.

## Recovery limitations

A `pg_dump` custom archive is a logical, point-in-time export only. It does not provide continuous point-in-time recovery, WAL/archive recovery, automatic failover, application object storage, external payment/email state, secret recovery, or a tested production cutover. Restore duration, version compatibility, extensions, roles, permissions, available storage, network access, and application migrations can all prevent recovery. A successful isolated drill therefore improves confidence but is not a production recovery guarantee. Escalate to the platform/database owner for an incident recovery plan and managed-backup status.
