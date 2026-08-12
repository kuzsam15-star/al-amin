#!/usr/bin/env bash
set -euo pipefail
umask 077
host="$1"; user="$2"; database="$3"; port="$4"; mode="${5:-query}"
IFS= read -r password
test -n "$password"
pgpass=/run/secrets/pgpass
printf '%s:%s:%s:%s:%s\n' "$host" "$port" "$database" "$user" "$password" > "$pgpass"
unset password
chmod 0600 "$pgpass"
test "$(stat -c '%a' "$pgpass")" = 600
export PGPASSFILE="$pgpass"
if [[ "$mode" == phase-a || "$mode" == phase-b ]]; then
  if [[ "$mode" == phase-a ]]; then
    state="$(PGOPTIONS='-c default_transaction_read_only=on' psql --no-password --host "$host" --port "$port" --username "$user" --dbname "$database" --set ON_ERROR_STOP=1 --tuples-only --no-align --command "select case when to_regclass('private.published_media_assets') is null then 'ABSENT' when to_regprocedure('public.backfill_canonical_published_media(text,uuid,text,text[],jsonb,jsonb)') is not null and exists (select 1 from pg_trigger where tgname='applications_guard_approved_canonical_media' and not tgisinternal) then 'PRESENT' else 'PARTIAL' end")"
  else
    state="$(PGOPTIONS='-c default_transaction_read_only=on' psql --no-password --host "$host" --port "$port" --username "$user" --dbname "$database" --set ON_ERROR_STOP=1 --tuples-only --no-align --command "select case count(*) when 0 then 'ABSENT' when 2 then 'PRESENT' else 'PARTIAL' end from pg_constraint where conname in ('applications_approved_media_canonical','specialists_published_media_canonical') and convalidated")"
  fi
  [[ "$state" != PARTIAL ]]
  if [[ "$state" == PRESENT ]]; then
    printf '%s\n' 'SEC001_STAGE_ALREADY_PRESENT_VERIFIED'
    rm -f "$pgpass"
    exit 0
  fi
  psql --no-password --host "$host" --port "$port" --username "$user" --dbname "$database" --set ON_ERROR_STOP=1 <<'SQL'
\set QUIET 1
select pg_try_advisory_lock(hashtextextended('alamin:sec001:release', 0)) as acquired \gset
\if :acquired
\else
\echo SEC001_REMOTE_RELEASE_LOCK_HELD
\quit 3
\endif
\i /release/stage.sql
select pg_advisory_unlock(hashtextextended('alamin:sec001:release', 0));
SQL
else
  PGOPTIONS='-c default_transaction_read_only=on' psql --no-password --host "$host" --port "$port" --username "$user" --dbname "$database" --set ON_ERROR_STOP=1 --tuples-only --no-align --file /release/stage.sql
fi
rm -f "$pgpass"
