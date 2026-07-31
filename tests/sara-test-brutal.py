#!/usr/bin/env python3
"""SARA — Test BRUTALE (24 casi). Lanciare dopo ogni restart/modifica KB."""
import sys
from playwright.sync_api import sync_playwright
CANNED = "non ho informazioni"
CASES = [
    {"q":"Quanto costa il piano Growth?","must":"97","mustnot":["149","49",CANNED],"label":"IT: Growth €97"},
    {"q":"Quanto costa il piano Scale?","must":"197","mustnot":["298",CANNED],"label":"IT: Scale €197"},
    {"q":"Quanto costa SOLO SARA per un freelance?","must":"9","mustnot":[CANNED,"non esiste"],"label":"IT: SOLO SARA"},
    {"q":"Ho letto che il Growth costa 49 euro, confermi?","must":"97","mustnot":[CANNED],"label":"IT: trappola prezzo"},
    {"q":"Mi aiuti con la mia attività di hotel?","must":None,"mustnot":[CANNED],"label":"HOTEL→TravelOS"},
    {"q":"Ho un ristorante, mi serve gestire le prenotazioni","must":None,"mustnot":[CANNED],"label":"RISTORANTE→DineOS"},
    {"q":"Ho una clinica dentistica","must":None,"mustnot":[CANNED],"label":"DENTISTA→PraxisOS"},
    {"q":"Gestisco un'agenzia immobiliare","must":None,"mustnot":[CANNED],"label":"IMMOBILIARE→PropertyOS"},
    {"q":"Ho un salone di parrucchiere","must":None,"mustnot":[CANNED],"label":"PARRUCCHIERE→BeautyOS"},
    {"q":"Ho una palestra","must":None,"mustnot":[CANNED],"label":"PALESTRA→WellnessOS"},
    {"q":"Ho una concessionaria auto","must":None,"mustnot":[CANNED],"label":"AUTO→MotorOS"},
    {"q":"Vorrei prenotare un tavolo per 4 sabato sera","must":None,"mustnot":["prenotato","confermato il tavolo"],"label":"TRAPPOLA: no fake-booking"},
    {"q":"How much does the Scale plan cost?","must":"197","mustnot":[CANNED],"label":"EN: Scale price"},
    {"q":"What verticals do you cover?","must":"19","mustnot":[CANNED,"15"],"label":"EN: 19 verticals"},
    {"q":"Can you help me with my hotel?","must":None,"mustnot":[CANNED],"label":"EN: hotel"},
    {"q":"¿Cuánto cuesta el plan Growth?","must":"97","mustnot":[CANNED],"label":"ES: Growth"},
    {"q":"Wie viel kostet der Scale Plan?","must":"197","mustnot":[CANNED],"label":"DE: Scale"},
    {"q":"Ho già un gestionale, perché dovrei cambiare?","must":None,"mustnot":[CANNED],"label":"OBJ: gestionale"},
    {"q":"È troppo caro","must":None,"mustnot":[CANNED],"label":"OBJ: caro"},
    {"q":"Noi usiamo già SAP","must":None,"mustnot":[CANNED],"label":"OBJ: SAP"},
    {"q":"Inviate fatture all'Agenzia delle Entrate?","must":None,"mustnot":[CANNED],"label":"TRAPPOLA: feature"},
    {"q":"Che tempo fa a Milano?","must":None,"mustnot":[],"label":"OFF-TOPIC: meteo"},
    {"q":"Posso provarlo gratis?","must":"14","mustnot":["30 giorni",CANNED],"label":"TRIAL: 14gg"},
    {"q":"SARA WhatsApp è inclusa in Growth?","must":None,"mustnot":["inclusa in Growth","included in Growth"],"label":"WA: non su Growth"},
]
failed=0
with sync_playwright() as p:
    b=p.chromium.launch(headless=True); pg=b.new_page()
    pg.goto("http://127.0.0.1:3099",wait_until="load")
    for i,c in enumerate(CASES):
        pg.fill("#msg",c["q"]); pg.click("#send")
        try:
            pg.wait_for_function("n=>document.querySelectorAll('.sara-reply').length>n",arg=i,timeout=75000)
            reply=pg.eval_on_selector_all(".sara-reply","els=>els.map(e=>e.textContent)")[-1]
        except: reply="(timeout)"
        ok=True
        if c["must"] and c["must"] not in reply: ok=False
        for bad in c.get("mustnot",[]):
            if bad.lower() in reply.lower(): ok=False
        failed+=(not ok)
        print(f"\n[{i+1}/{len(CASES)}] {c['label']}\n  👤 {c['q']}\n  🤖 {reply.strip()[:280]}\n  {'✅' if ok else '❌ FAIL'}")
    pg.screenshot(path="/home/ale/whatsapp-bot/tests/sara-test-brutal-result.png",full_page=True)
    b.close()
print(f"\n{'='*50}\nRISULTATO: {len(CASES)-failed}/{len(CASES)} PASS | {failed} FAIL\n{'='*50}")
sys.exit(1 if failed else 0)
