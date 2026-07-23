#!/bin/sh
set -eu

DIRECTORY=${1:-}
DAYS=${2:-}
case "$DIRECTORY" in
  /var/lib/akriven-backups/*) ;;
  *) echo "backup retention directory is outside the allowed root" >&2; exit 1 ;;
esac
case "$DAYS" in
  ''|*[!0-9]*) echo "backup retention days must be a non-negative integer" >&2; exit 1 ;;
esac

if [ ! -d "$DIRECTORY" ]; then
  echo "backup retention directory does not exist" >&2
  exit 1
fi
find "$DIRECTORY" -xdev -type f -name '*.age' -mtime "+$DAYS" -delete
echo "backup_retention=complete directory=$DIRECTORY days=$DAYS"
