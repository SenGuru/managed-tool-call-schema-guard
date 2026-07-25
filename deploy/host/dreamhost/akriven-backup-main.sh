#!/bin/sh
set -eu

CONFIG_FILE=${AKRIVEN_BACKUP_CONFIG:-/etc/akriven/schema-guard-main/backup.env}
if [ "$(id -u)" -ne 0 ]; then echo "main backup must run as root" >&2; exit 1; fi
if [ ! -r "$CONFIG_FILE" ]; then echo "main backup configuration is unreadable" >&2; exit 1; fi
set -a
# shellcheck disable=SC1090
. "$CONFIG_FILE"
set +a

: "${AKRIVEN_BACKUP_REMOTE_HOST:?remote host is required}"
: "${AKRIVEN_BACKUP_REMOTE_USER:?remote user is required}"
: "${AKRIVEN_BACKUP_SSH_KEY:?SSH key is required}"
: "${AKRIVEN_BACKUP_RECIPIENT_FILE:?age recipient file is required}"

case "$AKRIVEN_BACKUP_REMOTE_HOST" in *[!0-9A-Za-z.:-]*) echo "remote host is invalid" >&2; exit 1;; esac
case "$AKRIVEN_BACKUP_REMOTE_USER" in *[!0-9A-Za-z_-]*|'') echo "remote user is invalid" >&2; exit 1;; esac

PG_CONTAINER=${AKRIVEN_POSTGRES_CONTAINER:-schema-guard-main-schema-guard-postgres-1}
MANAGED_CONTAINER=${AKRIVEN_MANAGED_CONTAINER:-schema-guard-main-schema-guard-managed-1}
LOCAL_DIRECTORY=${AKRIVEN_BACKUP_LOCAL_DIRECTORY:-/var/lib/akriven-backup-main}
STATUS_FILE=${AKRIVEN_BACKUP_STATUS_FILE:-/var/lib/akriven-backup-main/status.json}
REMOTE_DIRECTORY=${AKRIVEN_BACKUP_REMOTE_DIRECTORY:-.}
KNOWN_HOSTS=${AKRIVEN_BACKUP_KNOWN_HOSTS:-/etc/akriven/schema-guard-main/backup-ssh/known_hosts}
HEARTBEAT_URL_FILE=${AKRIVEN_BACKUP_HEARTBEAT_URL_FILE:-}

send_success_heartbeat() {
  if [ -z "$HEARTBEAT_URL_FILE" ]; then return 0; fi
  if [ ! -r "$HEARTBEAT_URL_FILE" ]; then
    echo "backup heartbeat URL file is unreadable" >&2
    return 1
  fi
  heartbeat_url=$(tr -d '\r\n' < "$HEARTBEAT_URL_FILE")
  if ! printf '%s\n' "$heartbeat_url" |
    grep -Eq '^https://[^[:space:]"\\]+$'; then
    echo "backup heartbeat URL is invalid" >&2
    return 1
  fi
  curl --fail --silent --show-error --max-time 10 --output /dev/null \
    "$heartbeat_url"
}

install -d -m 0700 "$LOCAL_DIRECTORY"
work=$(mktemp -d /run/akriven-main-backup.XXXXXX)
cleanup() {
  docker exec "$MANAGED_CONTAINER" /nodejs/bin/node -e '
    const fs = require("node:fs");
    for (const suffix of ["", "-shm", "-wal"]) {
      try { fs.unlinkSync("/tmp/akriven-managed-online-backup.db" + suffix); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  ' >/dev/null 2>&1 || true
  find "$work" -mindepth 1 -delete 2>/dev/null || true
  rmdir "$work" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
bundle="$work/bundle"
install -d -m 0700 "$bundle/config"

started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="akriven-main-$stamp.age"

docker exec "$PG_CONTAINER" pg_dump -U schema_guard -d schema_guard \
  --format=custom --no-owner --no-privileges > "$bundle/schema-guard.dump"
docker exec "$MANAGED_CONTAINER" /nodejs/bin/node -e '
  const fs = require("node:fs");
  const Database = require("better-sqlite3");
  const destination = "/tmp/akriven-managed-online-backup.db";
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.unlinkSync(destination + suffix); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const source = new Database("/data/managed.db", {
    readonly: true,
    fileMustExist: true,
  });
  source.backup(destination).then(() => {
    source.close();
    const bytes = fs.readFileSync(destination);
    for (const suffix of ["", "-shm", "-wal"]) {
      try { fs.unlinkSync(destination + suffix); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    process.stdout.write(bytes);
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
' > "$bundle/managed.db"
cp -a /etc/akriven/schema-guard-main "$bundle/config/"
cp -a /opt/akriven/schema-guard-main "$bundle/config/"

{
  printf 'header = "Authorization: Bearer '
  tr -d '\r\n' < /etc/akriven/schema-guard-main/secrets/staging-admin-api-key
  printf '"\n'
} | curl --config - --fail --silent --show-error --max-time 10 \
  http://127.0.0.1:8788/v1/actions/idempotency/checkpoint \
  --output "$bundle/action-checkpoint.json"

(cd "$bundle" &&
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum) \
  > "$bundle/SHA256SUMS"
tar --numeric-owner -C "$bundle" -cf "$work/bundle.tar" .
age -R "$AKRIVEN_BACKUP_RECIPIENT_FILE" -o "$LOCAL_DIRECTORY/$name" "$work/bundle.tar"
chmod 0600 "$LOCAL_DIRECTORY/$name"

batch="$work/sftp.batch"
printf 'put %s %s/.%s.partial\nrename %s/.%s.partial %s/%s\n' \
  "$LOCAL_DIRECTORY/$name" "$REMOTE_DIRECTORY" "$name" \
  "$REMOTE_DIRECTORY" "$name" "$REMOTE_DIRECTORY" "$name" > "$batch"
sftp -b "$batch" -i "$AKRIVEN_BACKUP_SSH_KEY" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o "UserKnownHostsFile=$KNOWN_HOSTS" \
  "$AKRIVEN_BACKUP_REMOTE_USER@$AKRIVEN_BACKUP_REMOTE_HOST" >/dev/null

completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
size=$(wc -c < "$LOCAL_DIRECTORY/$name" | tr -d ' ')
ciphertext_hash=$(sha256sum "$LOCAL_DIRECTORY/$name" | cut -d' ' -f1)
status_tmp="$STATUS_FILE.tmp"
jq -cn \
  --arg completed_at "$completed_at" \
  --arg started_at "$started_at" \
  --arg filename "$name" \
  --arg sha256 "$ciphertext_hash" \
  --argjson bytes "$size" \
  '{version:1,service:"main",started_at:$started_at,completed_at:$completed_at,filename:$filename,ciphertext_sha256:$sha256,bytes:$bytes,off_machine:true}' \
  > "$status_tmp"
chmod 0600 "$status_tmp"
mv "$status_tmp" "$STATUS_FILE"
find "$LOCAL_DIRECTORY" -xdev -type f -name 'akriven-main-*.age' -mtime +2 -delete
send_success_heartbeat
echo "backup=main status=complete bytes=$size off_machine=true"
