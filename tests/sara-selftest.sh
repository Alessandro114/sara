#!/bin/bash
# SARA self-test — run AFTER EVERY restart of sara-whatsapp.service.
# 1) verifies the WhatsApp pairing is live (connection OPEN, QR not rotating)
# 2) runs the Playwright hallucination test (correct prices, no canned fallback)
# Exit 0 = all good. Non-zero = something needs attention.
set -u
cd $SARA_HOME
LOG=${SARA_HOME}/logs/sara.log
PID=$(pgrep -f "node $SARA_HOME/dist/index.js" | grep -v bash | head -1)

echo "════════ SARA SELF-TEST ════════"
# ── 1. pairing check ──
LAST=$(grep -a "\"pid\":$PID" "$LOG" 2>/dev/null | grep -aoE "connection OPEN|QR CODE generated|disconnected|auth_failure" | tail -1)
P=$(stat -c %Y qr_code.txt 2>/dev/null); sleep 8; Q=$(stat -c %Y qr_code.txt 2>/dev/null)
if [ "$P" != "$Q" ]; then
  echo "❌ PAIRING: QR in rotazione → NON connesso. Serve scansione (rimuovi prima i Dispositivi Collegati sul telefono)."
  echo "   URL QR: # QR URL: check your deployment docs"
  exit 2
fi
if [ "$LAST" != "connection OPEN" ]; then
  echo "⚠️  PAIRING: ultimo evento='$LAST' (atteso 'connection OPEN'). Verifica manuale."
else
  echo "✅ PAIRING: connesso e stabile (connection OPEN, QR fermo)."
fi

# ── 2. hallucination test via Playwright ──
echo "── avvio test server + Playwright ──"
node tests/sara-test-server.mjs > /tmp/sara-selftest-srv.log 2>&1 &
SRV=$!
for i in $(seq 1 25); do grep -q "TEST-WIDGET-READY" /tmp/sara-selftest-srv.log 2>/dev/null && break; sleep 1; done
python3 tests/sara-playwright-test.py
RC=$?
kill $SRV 2>/dev/null
echo "════════ FINE (pairing ok, test rc=$RC) ════════"
exit $RC
