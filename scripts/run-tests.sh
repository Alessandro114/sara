#!/usr/bin/env bash
# ═══════════════════════════════════════════════════
# Run every *.test.ts file under src/__tests__ via tsx.
# Exits non-zero on the first failure.
# ═══════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."

# ═══════════════════════════════════════════════════
# Safeguard: tests NEVER touch a remote database
# ═══════════════════════════════════════════════════
#
# memoria-db.test.ts and db-sessioni.test.ts connect to DATABASE_URL and run
# INSERT, DELETE, and — through initDB() — CREATE TABLE and ALTER TABLE. As
# long as tests were all in-memory there was nothing to protect; now that
# they talk to a database, running them in the wrong environment writes to
# the wrong environment.
#
# ─── Why allow-list instead of deny-list ───
#
# The first version of this check LISTED production hosts, by name and by
# IP address. Two flaws, and both were mine:
#
#   1. This repo is PUBLIC. That list published our production servers'
#      addresses to anyone, inside a file meant to protect them.
#   2. A deny-list only protects against what someone remembered to write
#      into it. A new production database, or a customer's, or an address
#      nobody anticipated would slip right through.
#
# An allow-list is stricter and reveals nothing: a test can talk ONLY to a
# local database. Any remote host is rejected, whether it's ours, a
# customer's, or unknown. No addresses to keep up to date, none to disclose.
#
# The guard lives in the SHELL rather than in a setup file like on
# scala-backend, because this repo doesn't use vitest: each test is its own
# tsx process, and there's no common point inside Node to hook into. The
# shell is that point.

for _var in DATABASE_URL SCALA_DB_URL; do
    _val="${!_var:-}"
    [ -n "$_val" ] || continue

    # The host sits between "@" and the port's ":" (or the database name's "/").
    _host=$(printf '%s' "$_val" | sed -E 's#^[a-zA-Z+]+://##; s#^[^@]*@##; s#[:/?].*$##')

    case "$_host" in
        localhost|127.0.0.1|::1|0.0.0.0|host.docker.internal|postgres|db|"")
            ;;   # local or a compose service name: allowed
        *)
            echo "════════════════════════════════════════" >&2
            echo "REFUSING TO RUN TESTS" >&2
            echo "" >&2
            echo "$_var points to a REMOTE host: $_host" >&2
            echo "" >&2
            echo "These tests run INSERT, DELETE, and CREATE TABLE. They can" >&2
            echo "only talk to a local database." >&2
            echo "" >&2
            echo "If you need to test against real data, copy a local copy of it." >&2
            echo "Do not remove this check." >&2
            echo "════════════════════════════════════════" >&2
            exit 1
            ;;
    esac
done

# Even locally, a DSN you didn't ask for is ignored: the database tests skip
# themselves and say so. Better to skip them than to find out later where
# they wrote to.
if [ -z "${CI:-}" ] && [ -z "${SARA_TEST_DB:-}" ]; then
    if [ -n "${DATABASE_URL:-}" ] || [ -n "${SCALA_DB_URL:-}" ]; then
        echo "warning: DATABASE_URL is set in the environment but SARA_TEST_DB is not."
        echo "         Database tests are SKIPPED instead of writing to a place you"
        echo "         didn't choose. To run them: SARA_TEST_DB=1 DATABASE_URL=... $0"
        echo ""
    fi
    unset DATABASE_URL || true
    unset SCALA_DB_URL || true
fi

echo "════════════════════════════════════════"
echo "SARA bot test runner"
echo "════════════════════════════════════════"

failed=0
passed=0
skipped=0

# Order-independent file glob. If you want deterministic order, sort.
shopt -s nullglob
tests=(src/__tests__/*.test.ts)
shopt -u nullglob

if [ ${#tests[@]} -eq 0 ]; then
    echo "No test files found."
    exit 0
fi

# ── Guard: there is no vitest here ─────────────────────────────────────────
#
# This project doesn't have vitest among its dependencies: tests are
# node:assert scripts run with tsx. A file that imports vitest doesn't fail
# in a readable way — it dies with ERR_MODULE_NOT_FOUND before running a
# single assertion, and buried in the output of eleven files it's easy to
# miss.
#
# Worse: whoever writes it tests it with `npx vitest`, which — if it grabs
# it from the npm cache — shows green, leading them to conclude it works. It
# passes with a tool that doesn't exist in the project. This has happened,
# which is why this guard exists.
bad_files=()
for t in "${tests[@]}"; do
    if grep -qE "from ['\"]vitest['\"]" "$t"; then
        bad_files+=("$t")
    fi
done

if [ ${#bad_files[@]} -gt 0 ]; then
    echo ""
    echo "✖ These tests import vitest, which does NOT exist in this project:"
    for t in "${bad_files[@]}"; do echo "    $t"; done
    echo ""
    echo "  Tests here use node:assert and run with tsx. See"
    echo "  src/__tests__/guardrails.test.ts for the expected shape."
    echo "  If you tested them with 'npx vitest' and they passed: that vitest"
    echo "  came from the npm cache, not from the project."
    echo ""
    exit 1
fi

for t in "${tests[@]}"; do
    echo ""
    echo "▶ $t"
    echo "────────────────────────────────────────"
    if npx tsx "$t"; then
        passed=$((passed + 1))
    else
        failed=$((failed + 1))
        echo "✖ $t FAILED"
    fi
done

echo ""
echo "════════════════════════════════════════"
echo "Results: $passed passed, $failed failed, $skipped skipped"
echo "════════════════════════════════════════"

exit $failed
