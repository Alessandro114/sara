#!/usr/bin/env python3
# SARA — test SERIO (esteso). Prezzi, verticali, obiezioni, trappole anti-allucinazione.
# must = deve comparire ; mustnot = NON deve comparire. Stampa ogni Q/A per feedback qualitativo.
import sys
from playwright.sync_api import sync_playwright

CANNED = "non ho informazioni"
CASES = [
  # --- prezzi corretti ---
  {"q":"Quanto costa il piano Growth?","must":"97","mustnot":["149","€49",CANNED]},
  {"q":"Quanto costa il piano Scale?","must":"197","mustnot":["298",CANNED]},
  {"q":"Quanto costa SOLO SARA per un freelance?","must":None,"mustnot":[CANNED]},
  {"q":"Posso provarlo gratis prima di pagare?","must":None,"mustnot":[CANNED]},
  # --- trappola falso-prezzo (deve correggere a 97) ---
  {"q":"Ho letto che il Growth costa 49 euro al mese, confermi?","must":"97","mustnot":[CANNED]},
  # --- verticali ---
  {"q":"Quanti settori coprite?","must":None,"mustnot":[CANNED]},
  {"q":"Avete qualcosa per il mio ristorante?","must":None,"mustnot":[CANNED]},
  {"q":"Gestisco un'agenzia immobiliare, fa per me?","must":None,"mustnot":[CANNED]},
  {"q":"Ho una clinica dentistica, mi serve gestire prenotazioni e no-show","must":None,"mustnot":[CANNED]},
  # --- obiezioni ---
  {"q":"Ho gia un gestionale, perche dovrei cambiare?","must":None,"mustnot":[CANNED]},
  {"q":"Mi sembra troppo caro","must":None,"mustnot":[CANNED]},
  {"q":"Noi usiamo gia SAP, a cosa mi serve voi?","must":None,"mustnot":[CANNED]},
  # --- trappola feature inventata (deve essere onesta, non inventare) ---
  {"q":"Inviate voi le fatture elettroniche all'Agenzia delle Entrate in automatico?","must":None,"mustnot":[CANNED]},
  # --- off-topic (non deve allucinare, deve riportare al tema) ---
  {"q":"Che tempo fa oggi a Milano?","must":None,"mustnot":[]},
  # --- inglese (multilingua) ---
  {"q":"How much does the Scale plan cost per month?","must":"197","mustnot":[CANNED]},
]

failed=0; rows=[]
with sync_playwright() as p:
    b=p.chromium.launch(headless=True); pg=b.new_page()
    pg.goto("http://127.0.0.1:3099", wait_until="load")
    for i,c in enumerate(CASES):
        pg.fill("#msg", c["q"]); pg.click("#send")
        try:
            pg.wait_for_function("n => document.querySelectorAll('.sara-reply').length > n", arg=i, timeout=70000)
            reply=pg.eval_on_selector_all(".sara-reply","els=>els.map(e=>e.textContent)")[-1]
        except Exception:
            reply="(timeout / nessuna risposta)"
        ok=True
        if c["must"] and c["must"] not in reply: ok=False
        for bad in c["mustnot"]:
            if bad.lower() in reply.lower(): ok=False
        rows.append((c["q"],reply,ok)); failed+=(not ok)
        print(f"\n[{i+1}] 👤 {c['q']}\n    🤖 {reply.strip()[:400]}\n    {'✅ PASS' if ok else '❌ FAIL'}")
    pg.screenshot(path="/home/ale/whatsapp-bot/tests/sara-test-full-result.png", full_page=True)
    b.close()
print(f"\n=== RISULTATO: {len(CASES)-failed}/{len(CASES)} PASS ===")
sys.exit(1 if failed else 0)
