#!/bin/bash
# Throw-away test run of the SQL in supabase/ against a LOCAL PostgreSQL (14+; 15+ for the
# security_invoker view). Never point this at Supabase or any database you care about:
# it DROPS and re-creates the database named below.
#
#   PGHOST=/var/run/postgresql PGUSER=postgres ./supabase/tests/run_tests.sh [dbname]
#
# Steps: stub the Supabase pieces (auth schema, roles, storage schema, publication),
# run the baseline scripts (schema, accounting, trash, security, realtime), load
# legacy-looking seed data (duplicates, orphans, bad values; SEED=0 skips it),
# apply supabase/migrations/*.sql in order, then run policy_matrix.sql (one PASS/FAIL
# line per assertion).
set -u
DB=${1:-erp_test}
RES=$(mktemp)
HERE="$(cd "$(dirname "$0")" && pwd)"
SQL="$HERE/.."
export PGOPTIONS='-c client_min_messages=warning'
P="psql -v ON_ERROR_STOP=1 -q -P pager=off"

psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" || exit 1
$P -d "$DB" -f "$HERE/stub_supabase.sql" || exit 1
for f in schema accounting trash security realtime; do
  $P -d "$DB" -f "$SQL/$f.sql" >/dev/null || { echo "baseline $f.sql failed"; exit 1; }
done
if [ "${SEED:-1}" = 1 ]; then $P -d "$DB" -f "$HERE/seed_legacy.sql" || exit 1; fi
for f in $(ls "$SQL"/migrations/[0-9]*.sql | sort); do
  echo "== $(basename "$f")"
  $P -d "$DB" -o /dev/null -f "$f" || { echo "MIGRATION FAILED: $f"; exit 1; }
done
echo "-- soft-skipped / failed steps (expected with the seed data):"
$P -d "$DB" -c "select migration, step, status, left(detail, 100) as detail from public.migration_log where status in ('skipped','failed') order by id"
if [ "${SEED:-1}" = 1 ]; then
  OUT=$(PGOPTIONS='-c client_min_messages=notice' psql -q -d "$DB" -f "$HERE/policy_matrix.sql" 2>&1)
  echo "$OUT" | grep -o 'RES|.*' > "$RES"
  echo "assertions: $(wc -l < "$RES")  pass: $(grep -c '|PASS|' "$RES")  fail: $(grep -c '|FAIL|' "$RES")"
  grep '|FAIL|' "$RES"
fi
