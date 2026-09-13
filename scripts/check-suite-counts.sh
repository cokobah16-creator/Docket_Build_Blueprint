#!/usr/bin/env bash
# Asserts that every SQL suite still makes the number of assertions it is meant to, and that the
# counts README.md states are the counts that actually ran.
#
# WHY THIS EXISTS. CI's own check counted SUITES: files in supabase/tests against files that printed
# "ALL CHECKS PASSED". A suite cut down to one assertion still prints that line and still counts, so
# the matter walls, the document-read gate or the registry boundary could each lose their coverage
# without a single job going red. The same programme that keeps saying "a check that cannot fail is
# not a check" had one at the centre of its own database gate.
#
# It is a FLOOR, not an equality: adding assertions never breaks the build, and removing them always
# does. Raising a floor is a one-line diff in supabase/tests/expected-checks.tsv, visible in review,
# which is the point — a deleted wall should be something a reviewer sees, not something they have
# to go looking for.
#
# Usage:
#   bash scripts/check-suite-counts.sh db-test.log        # assert (what CI runs)
#   bash scripts/check-suite-counts.sh --write db-test.log # regenerate the floors after a real change
set -euo pipefail
cd "$(dirname "$0")/.."

WRITE=0
if [ "${1:-}" = "--write" ]; then WRITE=1; shift; fi
LOG="${1:-db-test.log}"
EXPECTED=supabase/tests/expected-checks.tsv
[ -f "$LOG" ] || { echo "no such log: $LOG"; exit 1; }

# One line per suite, from the log the suite run actually produced.
actual=$(awk '/^== /{s=$2; next} /NOTICE:  PASS/{c[s]++} END{for (k in c) printf "%s\t%d\n", k, c[k]}' "$LOG" | sort)
[ -n "$actual" ] || { echo "::error::no PASS assertions found in $LOG — did the suite run?"; exit 1; }

if [ "$WRITE" -eq 1 ]; then
  header=$(grep '^#' "$EXPECTED" || true)
  { [ -n "$header" ] && printf '%s\n' "$header"; printf '%s\n' "$actual"; } > "$EXPECTED"
  echo "wrote $EXPECTED — $(printf '%s\n' "$actual" | wc -l | tr -d ' ') suites, $(printf '%s\n' "$actual" | awk -F'\t' '{s+=$2} END{print s}') assertions"
  echo "READ THE DIFF before committing: a number that went DOWN is coverage you deleted."
  exit 0
fi

status=0
total=0
while IFS=$'\t' read -r suite want; do
  case "$suite" in ''|\#*) continue ;; esac
  got=$(printf '%s\n' "$actual" | awk -F'\t' -v s="$suite" '$1==s {print $2}')
  if [ -z "$got" ]; then
    echo "::error::$suite is expected to make $want assertions and made none — it did not run"
    status=1; continue
  fi
  if [ "$got" -lt "$want" ]; then
    echo "::error::$suite made $got assertions, down from $want. Coverage was removed."
    echo "          If that was deliberate, lower the number in $EXPECTED in the same commit."
    status=1
  fi
done < "$EXPECTED"

# A suite present in the run and absent from the floors is a new suite with no floor. Say so — a
# new suite that nobody pins is the next one that can be quietly gutted.
while IFS=$'\t' read -r suite got; do
  grep -qF "$suite	" "$EXPECTED" || { echo "::error::$suite ran ($got assertions) and has no floor in $EXPECTED — add one"; status=1; }
done <<< "$actual"

# Counted over what RAN, not over what is listed in the floors file: reporting the suite count
# from one and the assertion count from the other made the summary line disagree with itself the
# first time a new suite appeared.
total=$(printf '%s\n' "$actual" | awk -F'\t' '{s+=$2} END{print s+0}')
suites=$(printf '%s\n' "$actual" | wc -l | tr -d ' ')
migrations=$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')
echo "database: $suites suites, $total assertions, $migrations migrations"

# README states all three. A number in prose nobody checks is a number that drifts: this one said
# "forty-nine migrations" while fifty-one were applying.
# Commas are stripped first, so "1,416" in prose matches 1416 here.
readme=$(tr -d ',' < README.md)
for pair in "$migrations:migrations" "$suites:suites" "$total:assertions"; do
  n="${pair%%:*}"; what="${pair#*:}"
  printf '%s' "$readme" | grep -qE "(^|[^0-9])$n([^0-9]|$)" || {
    echo "::error::README.md does not state $n $what. Update it — the counts in prose must be the counts that ran."
    status=1
  }
done

[ "$status" -eq 0 ] && echo "every suite met its floor, and README agrees with the run"
exit "$status"
