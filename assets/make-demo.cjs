const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const OUT = '/home/ale/sara-opensource/assets/frames';
const HTML = `data:text/html,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0b141a;font-family:system-ui,-apple-system,sans-serif;width:400px;height:700px;display:flex;flex-direction:column}
.header{background:#1f2c34;padding:10px 14px;display:flex;align-items:center;gap:10px}
.avatar{width:40px;height:40px;border-radius:50%;background:#00a884;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:18px}
.hinfo{flex:1}
.hname{color:#e9edef;font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px}
.badge{background:#00a884;color:#fff;font-size:10px;padding:2px 6px;border-radius:8px;font-weight:600}
.hsub{color:#8696a0;font-size:12px;margin-top:1px}
.hsub::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#00a884;margin-right:5px}
.chat{flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:6px;overflow:hidden}
.msg{max-width:85%;padding:7px 10px;border-radius:8px;font-size:14px;line-height:1.4;position:relative;word-wrap:break-word}
.msg .ts{font-size:10px;color:#8696a0;float:right;margin:4px 0 -2px 8px}
.user{background:#005c4b;color:#e9edef;align-self:flex-end;border-top-right-radius:0}
.sara{background:#1f2c34;color:#e9edef;align-self:flex-start;border-top-left-radius:0}
.fn{background:#0d1117;border-left:3px solid #00a884;padding:6px 8px;margin:4px 0;border-radius:0 6px 6px 0;font-family:'Fira Code',monospace;font-size:11px;color:#7ee787;line-height:1.5}
.fn .label{color:#8696a0;font-size:10px;margin-bottom:2px}
.fn .result{color:#58a6ff;margin-top:2px}
.hidden{display:none!important}
.inputbar{background:#1f2c34;padding:8px 14px;display:flex;align-items:center}
.inputbar span{background:#2a3942;color:#8696a0;border-radius:20px;padding:8px 14px;flex:1;font-size:14px}
</style></head><body>
<div class="header">
  <div class="avatar">S</div>
  <div class="hinfo">
    <div class="hname">SARA <span class="badge">AI Agent</span></div>
    <div class="hsub">DineOS · online</div>
  </div>
</div>
<div class="chat" id="chat">
  <div class="msg user" id="m1"><span class="ts">20:12</span>Table for 4 tonight at 8pm?</div>
  <div class="msg sara" id="m2">
    <div class="fn"><div class="label">⚡ function call</div>check_availability({ date: "today", guests: 4 })<div class="result">→ table 12: available</div></div>
    <span class="ts">20:12</span>
  </div>
  <div class="msg sara" id="m3"><span class="ts">20:12</span>Table available at 8pm! 🎉 Window or terrace?</div>
  <div class="msg user" id="m4"><span class="ts">20:13</span>Terrace! One of us is celiac</div>
  <div class="msg sara" id="m5">
    <div class="fn"><div class="label">⚡ function call</div>check_allergens({ query: "gluten" })<div class="result">→ 12 gluten-free dishes available</div></div>
    <span class="ts">20:13</span>
  </div>
  <div class="msg sara" id="m6">
    <div class="fn"><div class="label">⚡ function call</div>book_table({ time: "20:00", guests: 4, zone: "terrace" })<div class="result">→ booking #847 confirmed ✓</div></div>
    <span class="ts">20:13</span>
  </div>
  <div class="msg sara" id="m7"><span class="ts">20:13</span>Done! Terrace, 4 guests, 8PM. Kitchen flagged for gluten-free. See you tonight! 🍽️</div>
</div>
<div class="inputbar"><span>Type a message</span></div>
<script>
const order = ['m1','m2','m3','m4','m5','m6','m7'];
const frame = parseInt(new URLSearchParams(location.search).get('f') || '0');
order.forEach((id, i) => {
  const el = document.getElementById(id);
  if (i >= frame) el.classList.add('hidden');
});
</script>
</body></html>`)}`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 700 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // Frame config: [messagesVisible, holdFrames] (each frame = 100ms)
  const frames = [
    [0, 10],   // empty chat 1s
    [1, 15],   // user msg 1.5s
    [2, 12],   // fn check_availability 1.2s
    [3, 15],   // SARA "table available" 1.5s
    [4, 15],   // user "terrace, celiac" 1.5s
    [5, 12],   // fn check_allergens 1.2s
    [6, 12],   // fn book_table 1.2s
    [7, 25],   // final SARA msg 2.5s
  ];

  let frameIdx = 0;
  for (const [visible, hold] of frames) {
    const url = HTML.replace('location.search', `"?f=${visible}"`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(200);
    const file = path.join(OUT, `frame-${String(frameIdx).padStart(3, '0')}.png`);
    await page.screenshot({ path: file });

    // Duplicate frames for hold duration
    for (let h = 1; h < hold; h++) {
      frameIdx++;
      fs.copyFileSync(file, path.join(OUT, `frame-${String(frameIdx).padStart(3, '0')}.png`));
    }
    frameIdx++;
  }

  await browser.close();

  // Assemble GIF
  const gifPath = '/home/ale/sara-opensource/assets/demo.gif';
  execSync(`convert -loop 0 -delay 10 ${OUT}/frame-*.png -resize 400x700 ${gifPath}`, { maxBuffer: 50 * 1024 * 1024 });
  execSync(`cp ${gifPath} /home/ale/sara-opensource/assets/ph-kit/04-demo.gif`);

  const stat = fs.statSync(gifPath);
  console.log(`GIF created: ${gifPath} (${(stat.size / 1024).toFixed(0)}KB)`);
  console.log(`Frames: ${frameIdx}`);

  // Cleanup
  execSync(`rm -rf ${OUT}`);
})();
