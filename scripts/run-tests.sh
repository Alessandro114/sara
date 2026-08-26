#!/usr/bin/env bash
# ═══════════════════════════════════════════════════
# Run every *.test.ts file under src/__tests__ via tsx.
# Exits non-zero on the first failure.
# ═══════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."

# ═══════════════════════════════════════════════════
# Protezione: i test non toccano MAI un database remoto
# ═══════════════════════════════════════════════════
#
# memoria-db.test.ts e db-sessioni.test.ts si connettono a DATABASE_URL e fanno
# INSERT, DELETE e — attraverso initDB() — CREATE TABLE e ALTER TABLE. Finche i
# test erano tutti in memoria non c'era niente da proteggere; da quando parlano
# a un database, lanciarli nell'ambiente sbagliato scrive nell'ambiente
# sbagliato.
#
# ─── Perche si ammette invece di vietare ───
#
# La prima versione di questo controllo ELENCAVA gli host di produzione, per
# nome e per indirizzo IP. Due difetti, ed erano tutti e due miei:
#
#   1. Questo repo e PUBBLICO. Quell'elenco pubblicava gli indirizzi dei nostri
#      server di produzione a chiunque, dentro un file che serviva a proteggerli.
#   2. Un elenco di vietati protegge solo da cio che qualcuno si e ricordato di
#      scriverci. Un database di produzione nuovo, o quello di un cliente, o un
#      indirizzo che nessuno aveva previsto sarebbero passati.
#
# Ammettere e piu stretto e non rivela niente: un test puo parlare SOLO con un
# database locale. Qualunque host remoto viene rifiutato, che sia nostro, di un
# cliente o sconosciuto. Nessun indirizzo da tenere aggiornato, nessun indirizzo
# da divulgare.
#
# Il guard sta nella SHELL e non in un file di setup come su scala-backend,
# perche questo repo non usa vitest: ogni test e un processo tsx a se, e non
# esiste un punto comune dentro Node in cui mettersi. La shell e quel punto.

for _var in DATABASE_URL SCALA_DB_URL; do
    _val="${!_var:-}"
    [ -n "$_val" ] || continue

    # L'host sta fra "@" e il ":" della porta (o la "/" del nome database).
    _host=$(printf '%s' "$_val" | sed -E 's#^[a-zA-Z+]+://##; s#^[^@]*@##; s#[:/?].*$##')

    case "$_host" in
        localhost|127.0.0.1|::1|0.0.0.0|host.docker.internal|postgres|db|"")
            ;;   # locale o nome di servizio in un compose: ammesso
        *)
            echo "════════════════════════════════════════" >&2
            echo "RIFIUTO DI ESEGUIRE I TEST" >&2
            echo "" >&2
            echo "$_var punta a un host REMOTO: $_host" >&2
            echo "" >&2
            echo "Questi test fanno INSERT, DELETE e CREATE TABLE. Possono" >&2
            echo "parlare solo con un database locale." >&2
            echo "" >&2
            echo "Se ti serve provare contro dati veri, copiane una copia in" >&2
            echo "locale. Non togliere questo controllo." >&2
            echo "════════════════════════════════════════" >&2
            exit 1
            ;;
    esac
done

# Anche in locale, un DSN che non hai chiesto tu viene ignorato: i test del
# database si saltano da soli e lo dicono. Meglio saltarli che scoprire dopo
# dove hanno scritto.
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
