#!/usr/bin/env python3
# Playwright hallucination test for SARA. Drives a real headless browser against
# the test server (port 3099) and asserts SARA answers on-topic with correct
# prices and NO canned "non ho informazioni" fallback.
import sys
from playwright.sync_api import sync_playwright

CASES = [
    {"q": "Quanto costa il piano Growth?", "must": "97", "mustnot": ["149", "non ho informazioni"]},
    {"q": "Quanto costa il piano Scale?", "must": "197", "mustnot": ["298", "non ho informazioni"]},
    {"q": "Ciao mi aiuti con la mia attività di hotel?", "must": None, "mustnot": ["non ho informazioni precise"]},
    {"q": "Avete una soluzione per ristoranti?", "must": None, "mustnot": ["non ho informazioni precise"]},
]

failed = 0
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://127.0.0.1:3099", wait_until="load")
    for i, c in enumerate(CASES):
        page.fill("#msg", c["q"])
        page.click("#send")
        page.wait_for_function("n => document.querySelectorAll('.sara-reply').length > n", arg=i, timeout=60000)
        reply = page.eval_on_selector_all(".sara-reply", "els => els.map(e => e.textContent)")[-1]
        ok = True
        if c["must"] and c["must"] not in reply:
            ok = False
        for bad in c["mustnot"]:
            if bad.lower() in reply.lower():
                ok = False
        print(f"\n👤 {c['q']}\n🤖 {reply}\n   {'✅ PASS' if ok else '❌ FAIL'}")
        failed += (not ok)
    page.screenshot(path="/home/ale/whatsapp-bot/tests/sara-playwright-result.png", full_page=True)
    browser.close()

print(f"\n=== {'✅ TUTTI PASS' if failed == 0 else f'❌ {failed} FAIL'} ===")
sys.exit(1 if failed else 0)
