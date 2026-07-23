#!/bin/sh
set -eu

ROOT=${AKRIVEN_BACKUP_STORAGE_ROOT:-/var/lib/akriven-backups}
case "$ROOT" in
  /var/lib/akriven-backups|/var/lib/akriven-backups/*) ;;
  *) echo "backup storage root is outside the allowed path" >&2; exit 1 ;;
esac
INCOMING="$ROOT/incoming"
ARCHIVE="$ROOT/archive"
install -d -m 0700 -o root -g root "$ARCHIVE"
if [ ! -d "$INCOMING" ]; then echo "backup incoming directory does not exist" >&2; exit 1; fi

find "$INCOMING" -xdev -maxdepth 1 -type f -name '*.age' -print |
  while IFS= read -r source; do
    name=${source##*/}
    case "$name" in
      akriven-main-*.age|akriven-anchor-*.age) ;;
      *) echo "unexpected backup filename" >&2; exit 1 ;;
    esac
    destination="$ARCHIVE/$name"
    if [ -e "$destination" ]; then echo "backup archive collision" >&2; exit 1; fi
    chown root:root "$source"
    chmod 0400 "$source"
    mv "$source" "$destination"
  done
sync -f "$ARCHIVE"
echo "backup_ingest=complete"
