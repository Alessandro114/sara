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

# ── Guardia: qui non c'è vitest ────────────────────────────────────────────
#
# Questo progetto non ha vitest fra le dipendenze: i test sono node:assert
# eseguiti con tsx. Un file che importa vitest non fallisce in modo leggibile —
# muore con ERR_MODULE_NOT_FOUND prima di eseguire una sola asserzione, e in
# mezzo all'output di undici file ci si accorge a malapena.
#
# Peggio: chi lo scrive lo prova con `npx vitest`, che se lo prende dalla cache
# di npm, lo vede verde, e conclude che funziona. Passa con uno strumento che
# nel progetto non esiste. È successo, ed è per questo che la guardia c'è.
sbagliati=()
for t in "${tests[@]}"; do
    if grep -qE "from ['\"]vitest['\"]" "$t"; then
        sbagliati+=("$t")
    fi
done

if [ ${#sbagliati[@]} -gt 0 ]; then
    echo ""
    echo "✖ Questi test importano vitest, che in questo progetto NON esiste:"
    for t in "${sbagliati[@]}"; do echo "    $t"; done
    echo ""
    echo "  I test qui usano node:assert e girano con tsx. Vedi"
    echo "  src/__tests__/guardrails.test.ts per la forma attesa."
    echo "  Se li hai provati con 'npx vitest' passavano: quel vitest arriva"
    echo "  dalla cache di npm, non dal progetto."
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
