#!/bin/sh
set -eu

TARGET_USER=${1:-}
PUBLIC_KEY_FILE=${2:-}
case "$TARGET_USER" in
  akriven-backup-main|akriven-backup-anchor) ;;
  *) echo "unsupported backup target user" >&2; exit 1 ;;
esac
if [ "$(id -u)" -ne 0 ]; then echo "backup target setup must run as root" >&2; exit 1; fi
if [ ! -r "$PUBLIC_KEY_FILE" ]; then echo "backup source public key is unreadable" >&2; exit 1; fi
if [ "$(wc -l < "$PUBLIC_KEY_FILE" | tr -d ' ')" -ne 1 ] ||
   ! grep -Eq '^ssh-ed25519 [A-Za-z0-9+/]+={0,3}( |$)' "$PUBLIC_KEY_FILE"; then
  echo "backup source public key must be one OpenSSH Ed25519 key" >&2
  exit 1
fi

if ! getent group akriven-sftp-backup >/dev/null; then
  groupadd --system akriven-sftp-backup
fi
if ! getent passwd "$TARGET_USER" >/dev/null; then
  useradd --system --gid akriven-sftp-backup \
    --home-dir /var/lib/akriven-backups --shell /usr/sbin/nologin \
    "$TARGET_USER"
fi

account=$(getent passwd "$TARGET_USER")
account_group=$(id -gn "$TARGET_USER")
case "$account" in
  "$TARGET_USER":*:/var/lib/akriven-backups:/usr/sbin/nologin) ;;
  *) echo "existing backup account has unexpected home or shell" >&2; exit 1 ;;
esac
if [ "$account_group" != akriven-sftp-backup ]; then
  echo "existing backup account has unexpected primary group" >&2
  exit 1
fi

install -d -m 0755 -o root -g root /var/lib/akriven-backups
install -d -m 0700 -o "$TARGET_USER" -g akriven-sftp-backup \
  /var/lib/akriven-backups/incoming
install -d -m 0700 -o root -g root /var/lib/akriven-backups/archive
install -d -m 0755 -o root -g root /etc/ssh/akriven-authorized-keys
install -m 0644 -o root -g root "$PUBLIC_KEY_FILE" \
  "/etc/ssh/akriven-authorized-keys/$TARGET_USER"

echo "backup_target=$TARGET_USER status=configured"
