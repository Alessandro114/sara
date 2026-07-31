import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs';

const CASES = [
  { q: 'Quanto costa il piano Growth?', mustHave: '97', mustNotHave: '149' },
  { q: 'Avete una soluzione per ristoranti?', mustHave: null, mustNotHave: null },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:3099', { waitUntil: 'load' });

let pass = 0, fail = 0;
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  await page.fill('#msg', c.q);
  await page.click('#send');
  // wait for a NEW #sara-reply (the i-th) to appear
  await page.waitForFunction((n) => document.querySelectorAll('#sara-reply').length > n, i, { timeout: 60000 });
  const replies = await page.$$eval('#sara-reply', els => els.map(e => e.textContent));
  const reply = replies[replies.length - 1] || '';
  console.log(`\n👤 ${c.q}`);
  console.log(`🤖 ${reply}`);
  let ok = true;
  if (c.mustHave && !reply.includes(c.mustHave)) { ok = false; console.log(`   ❌ manca "${c.mustHave}"`); }
  if (c.mustNotHave && reply.includes(c.mustNotHave)) { ok = false; console.log(`   ❌ contiene "${c.mustNotHave}" (vietato)`); }
  console.log(ok ? '   ✅ PASS' : '   ❌ FAIL');
  ok ? pass++ : fail++;
}
await page.screenshot({ path: 'test-playwright-result.png', fullPage: true });
console.log(`\n═══ Playwright: ${pass} PASS / ${fail} FAIL — screenshot: test-playwright-result.png ═══`);
await browser.close();
process.exit(fail ? 1 : 0);
