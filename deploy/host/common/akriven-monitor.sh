#!/bin/sh
set -eu

CONFIG_FILE=${AKRIVEN_MONITOR_CONFIG:-/etc/akriven/monitor.env}
if [ ! -r "$CONFIG_FILE" ]; then
  echo "monitor configuration is unreadable" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$CONFIG_FILE"
set +a

: "${AKRIVEN_MONITOR_NAME:?monitor name is required}"
: "${AKRIVEN_MONITOR_URLS:?at least one readiness URL is required}"
: "${AKRIVEN_MONITOR_CONTAINERS:?at least one container is required}"
: "${AKRIVEN_TLS_HOSTS:?at least one TLS host is required}"
: "${AKRIVEN_BACKUP_STATUS_FILE:?backup status file is required}"

case "$AKRIVEN_MONITOR_NAME" in
  *[!A-Za-z0-9_-]*|'') echo "monitor name is invalid" >&2; exit 1 ;;
esac

MAX_BACKUP_AGE=${AKRIVEN_MAX_BACKUP_AGE_SECONDS:-93600}
TLS_MIN_SECONDS=${AKRIVEN_TLS_MIN_SECONDS:-1209600}
STATE_DIRECTORY=${AKRIVEN_MONITOR_STATE_DIRECTORY:-/var/lib/akriven-monitor}
WEBHOOK_FILE=${AKRIVEN_MONITOR_WEBHOOK_FILE:-/etc/akriven/monitor-webhook-url}
CURL_CA_FILE=${AKRIVEN_MONITOR_CURL_CA_FILE:-}
if [ -n "$CURL_CA_FILE" ] && [ ! -r "$CURL_CA_FILE" ]; then
  echo "monitor CA bundle is unreadable" >&2
  exit 1
fi
install -d -m 0700 "$STATE_DIRECTORY"
STATE_FILE="$STATE_DIRECTORY/$AKRIVEN_MONITOR_NAME.state"

failures=''
for url in $AKRIVEN_MONITOR_URLS; do
  case "$url" in
    https://*|http://127.0.0.1:*|http://localhost:*) ;;
    *) failures="$failures invalid_url" ; continue ;;
  esac
  if [ -n "$CURL_CA_FILE" ]; then
    curl_ok=$(
      curl --fail --silent --show-error --max-time 10 --output /dev/null \
        --capath /etc/ssl/certs --cacert "$CURL_CA_FILE" "$url" &&
        printf yes ||
        printf no
    )
  else
    curl_ok=$(
      curl --fail --silent --show-error --max-time 10 --output /dev/null "$url" &&
        printf yes ||
        printf no
    )
  fi
  if [ "$curl_ok" != yes ]; then
    failures="$failures readiness"
  fi
done

for container in $AKRIVEN_MONITOR_CONTAINERS; do
  status=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
  if [ "$status" != healthy ] && [ "$status" != running ]; then
    failures="$failures container"
  fi
done

for target in $AKRIVEN_TLS_HOSTS; do
  host=${target%%:*}
  case "$target" in
    *:*) port=${target##*:} ;;
    *) port=443 ;;
  esac
  if ! printf '' |
    openssl s_client -connect "$host:$port" -servername "$host" 2>/dev/null |
    openssl x509 -checkend "$TLS_MIN_SECONDS" -noout >/dev/null 2>&1; then
    failures="$failures certificate"
  fi
done

if [ ! -r "$AKRIVEN_BACKUP_STATUS_FILE" ]; then
  failures="$failures backup_missing"
else
  completed_at=$(jq -er '.completed_at | fromdateiso8601' "$AKRIVEN_BACKUP_STATUS_FILE" 2>/dev/null || true)
  now=$(date +%s)
  if [ -z "$completed_at" ] || [ $((now - completed_at)) -gt "$MAX_BACKUP_AGE" ]; then
    failures="$failures backup_stale"
  fi
fi

normalized=$(printf '%s\n' "$failures" | tr ' ' '\n' | sed '/^$/d' | sort -u | paste -sd, -)
if [ -n "$normalized" ]; then
  state="failed:$normalized"
else
  state=healthy
fi
previous=$(cat "$STATE_FILE" 2>/dev/null || true)
printf '%s\n' "$state" > "$STATE_FILE"
chmod 0600 "$STATE_FILE"

if [ "$state" != "$previous" ] && [ -s "$WEBHOOK_FILE" ]; then
  webhook_url=$(tr -d '\r\n' < "$WEBHOOK_FILE")
  if ! printf '%s\n' "$webhook_url" |
    grep -Eq '^(https://[^[:space:]\"\\]+|http://(127\.0\.0\.1|localhost):[0-9]+/[^[:space:]\"\\]*)$'; then
    echo "monitor webhook URL is invalid" >&2
    exit 1
  fi
  payload=$(jq -cn \
    --arg monitor "$AKRIVEN_MONITOR_NAME" \
    --arg state "$state" \
    --arg observed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{version:1,monitor:$monitor,state:$state,observed_at:$observed_at}')
  {
    printf 'url = "'
    printf '%s' "$webhook_url"
    printf '"\nrequest = "POST"\nheader = "content-type: application/json"\ndata = %s\n' "$(printf '%s' "$payload" | jq -Rs .)"
  } | curl --config - --fail --silent --show-error --max-time 10 --output /dev/null || true
fi

if [ -n "$normalized" ]; then
  echo "monitor=$AKRIVEN_MONITOR_NAME state=failed checks=$normalized" >&2
  exit 1
fi
echo "monitor=$AKRIVEN_MONITOR_NAME state=healthy"
