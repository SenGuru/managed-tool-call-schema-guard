#!/bin/sh
set -eu

CONFIG_FILE=${AKRIVEN_BACKUP_CONFIG:-/etc/akriven/schema-guard-anchor/backup.env}
if [ "$(id -u)" -ne 0 ]; then echo "anchor backup must run as root" >&2; exit 1; fi
if [ ! -r "$CONFIG_FILE" ]; then echo "anchor backup configuration is unreadable" >&2; exit 1; fi
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

RECEIVER_CONTAINER=${AKRIVEN_ANCHOR_CONTAINER:-schema-guard-anchor-schema-guard-anchor-receiver-1}
ANCHOR_VOLUME=${AKRIVEN_ANCHOR_VOLUME:-schema-guard-anchor_schema-guard-anchor-data}
UTILITY_IMAGE=${AKRIVEN_BACKUP_UTILITY_IMAGE:-akriven-backup-utility:busybox-1.37.0-musl-amd64}
LOCAL_DIRECTORY=${AKRIVEN_BACKUP_LOCAL_DIRECTORY:-/var/lib/akriven-backup-anchor}
STATUS_FILE=${AKRIVEN_BACKUP_STATUS_FILE:-/var/lib/akriven-backup-anchor/status.json}
REMOTE_DIRECTORY=${AKRIVEN_BACKUP_REMOTE_DIRECTORY:-.}
KNOWN_HOSTS=${AKRIVEN_BACKUP_KNOWN_HOSTS:-/etc/akriven/schema-guard-anchor/backup-ssh/known_hosts}

install -d -m 0700 "$LOCAL_DIRECTORY"
work=$(mktemp -d /run/akriven-anchor-backup.XXXXXX)
receiver_stopped=0
cleanup() {
  if [ "$receiver_stopped" -eq 1 ]; then docker start "$RECEIVER_CONTAINER" >/dev/null 2>&1 || true; fi
  find "$work" -mindepth 1 -delete 2>/dev/null || true
  rmdir "$work" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
bundle="$work/bundle"
install -d -m 0700 "$bundle/config"
install -m 0600 -o 65532 -g 65532 /dev/null "$bundle/anchor-data.tar"

started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
start_epoch=$(date +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="akriven-anchor-$stamp.age"

docker stop --time 30 "$RECEIVER_CONTAINER" >/dev/null
receiver_stopped=1
docker run --rm --network none --read-only --user 65532:65532 \
  --cap-drop ALL \
  -v "$ANCHOR_VOLUME:/source:ro" \
  -v "$bundle/anchor-data.tar:/destination/anchor-data.tar" \
  "$UTILITY_IMAGE" c -f /destination/anchor-data.tar -C /source .
chown 0:0 "$bundle/anchor-data.tar"
cp -a /etc/akriven/schema-guard-anchor "$bundle/config/"
cp -a /opt/akriven/schema-guard-anchor "$bundle/config/"
docker start "$RECEIVER_CONTAINER" >/dev/null
receiver_stopped=0

healthy=0
for _attempt in $(seq 1 60); do
  health=$(docker inspect "$RECEIVER_CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || true)
  if [ "$health" = healthy ]; then healthy=1; break; fi
  sleep 1
done
if [ "$healthy" -ne 1 ]; then echo "anchor receiver did not recover after backup" >&2; exit 1; fi
downtime_seconds=$(($(date +%s) - start_epoch))

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
  --argjson downtime_seconds "$downtime_seconds" \
  '{version:1,service:"anchor",started_at:$started_at,completed_at:$completed_at,filename:$filename,ciphertext_sha256:$sha256,bytes:$bytes,downtime_seconds:$downtime_seconds,off_machine:true}' \
  > "$status_tmp"
chmod 0600 "$status_tmp"
mv "$status_tmp" "$STATUS_FILE"
find "$LOCAL_DIRECTORY" -xdev -type f -name 'akriven-anchor-*.age' -mtime +2 -delete
echo "backup=anchor status=complete bytes=$size downtime_seconds=$downtime_seconds off_machine=true"
