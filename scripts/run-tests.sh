#!/usr/bin/env bash
# ═══════════════════════════════════════════════════
# Run every *.test.ts file under src/__tests__ via tsx.
# Exits non-zero on the first failure.
# ═══════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."

# ═══════════════════════════════════════════════════
# Protezione: da oggi questi test SCRIVONO su un database
# ═══════════════════════════════════════════════════
#
# memoria-db.test.ts e db-sessioni.test.ts si connettono a DATABASE_URL e
# fanno INSERT, DELETE e — attraverso initDB() — CREATE TABLE e ALTER TABLE.
# Finche i test erano tutti in memoria non c'era niente da proteggere; da
# quando parlano a un database, lanciarli nell'ambiente sbagliato scrive
# nell'ambiente sbagliato.
#
# Su 89 DATABASE_URL e esportato nell'ambiente della shell e punta alla
# PRODUZIONE. Un `bash scripts/run-tests.sh` dato per abitudine prima di un
# commit ci eseguirebbe sopra della DDL.
#
# Il guard sta QUI e non in un file di setup come su scala-backend, perche
# questo repo non usa vitest: ogni test e un processo tsx a se, e non esiste
# un punto comune dentro Node in cui mettersi. La shell e quel punto.
#
# Due regole:
#   1. un DSN che PUZZA di produzione fa fallire subito, anche in CI. Nessuna
#      opzione per aggirarlo: se serve provare contro quel database, si copia
#      il database, non si toglie il controllo.
#   2. fuori dalla CI un DSN qualunque viene IGNORATO se non lo si e chiesto
#      esplicitamente con SARA_TEST_DB=1. I test del database si saltano da
#      soli e lo dicono. Meglio saltarli che scoprire dopo dove hanno scritto.

PRODUZIONE='scalacore|scala-postgres|89\.167\.27\.229|65\.108\.208\.117'

for _var in DATABASE_URL SCALA_DB_URL; do
    _val="${!_var:-}"
    if [ -n "$_val" ] && printf '%s' "$_val" | grep -qE "$PRODUZIONE"; then
        echo "════════════════════════════════════════" >&2
        echo "RIFIUTO DI ESEGUIRE I TEST" >&2
        echo "" >&2
        echo "$_var punta a un database di PRODUZIONE." >&2
        echo "Questi test fanno INSERT, DELETE e CREATE TABLE." >&2
        echo "" >&2
        echo "Se ti serve provare contro dati veri, copia il database." >&2
        echo "Non togliere questo controllo." >&2
        echo "════════════════════════════════════════" >&2
        exit 1
    fi
done

if [ -z "${CI:-}" ] && [ -z "${SARA_TEST_DB:-}" ]; then
    if [ -n "${DATABASE_URL:-}" ] || [ -n "${SCALA_DB_URL:-}" ]; then
        echo "avviso: DATABASE_URL presente nell ambiente ma SARA_TEST_DB non impostata."
        echo "        I test del database vengono SALTATI invece di scrivere in un posto"
        echo "        che non hai scelto. Per eseguirli: SARA_TEST_DB=1 DATABASE_URL=... $0"
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
