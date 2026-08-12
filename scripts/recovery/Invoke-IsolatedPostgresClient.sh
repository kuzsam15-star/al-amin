#!/bin/sh
set -eu

umask 077
IFS= read -r service_payload
IFS= read -r pass_payload
IFS= read -r argument_count
case "$argument_count" in
  ''|*[!0-9]*) exit 64 ;;
esac
printf '%s' "$service_payload" | base64 -d > "$PGSERVICEFILE"
printf '%s' "$pass_payload" | base64 -d > "$PGPASSFILE"
unset service_payload pass_payload
chmod 0600 "$PGSERVICEFILE" "$PGPASSFILE"
stat -c %a /run/secrets | grep -qx 700
stat -c %a "$PGSERVICEFILE" | grep -qx 600
stat -c %a "$PGPASSFILE" | grep -qx 600

argv_file=/run/secrets/client.argv
: > "$argv_file"
argument_index=0
while [ "$argument_index" -lt "$argument_count" ]; do
  IFS= read -r argument_payload
  printf '%s' "$argument_payload" | base64 -d >> "$argv_file"
  printf '\000' >> "$argv_file"
  argument_index=$((argument_index + 1))
done
unset argument_payload argument_count argument_index
chmod 0600 "$argv_file"
stat -c %a "$argv_file" | grep -qx 600
exec xargs -0 -a "$argv_file" -r -x sh -c 'exec "$@"' alamin-postgres-client
