#!/usr/bin/env bash
# ═══════════════════════════════════════════════════
# Run every *.test.ts file under src/__tests__ via tsx.
# Exits non-zero on the first failure.
# ═══════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."

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
