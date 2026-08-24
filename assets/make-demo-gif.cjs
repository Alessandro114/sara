#!/usr/bin/env node
/**
 * Generates demo.gif for SARA WhatsApp bot README.
 * Usage: node make-demo-gif.js
 */

const { chromium } = require('/home/ale/scala-backend/node_modules/playwright');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const CHROMIUM = '/home/ale/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';
const HTML = `file://${path.resolve(__dirname, 'chat-demo.html')}`;
const FRAMES_DIR = path.resolve(__dirname, 'gif-frames');
const OUT_GIF = path.resolve(__dirname, 'demo.gif');
const COPY_GIF = path.resolve(__dirname, 'ph-kit/04-demo.gif');

// Frame definitions: [frameNumber, holdMs]
// Frame 1 = empty chat (hold 1.0s)
// Frames 2-8 appear one by one, each held 1.5s
// Last frame held 2.5s
const FRAMES = [
  [1, 1000],
  [2, 1500],
  [3, 1200],
  [4, 1500],
  [5, 1500],
  [6, 1200],
  [7, 1200],
  [8, 2500],
];

async function main() {
  // Clean/create frames dir
  if (fs.existsSync(FRAMES_DIR)) {
    fs.rmSync(FRAMES_DIR, { recursive: true });
  }
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  console.log('Launching browser...');
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 400, height: 700 },
    deviceScaleFactor: 2, // retina for crisp text
  });

  const page = await context.newPage();
  await page.goto(HTML, { waitUntil: 'networkidle' });

  // Take screenshots for each frame (multiple shots per frame based on hold time)
  const allPngs = [];
  let imgIndex = 0;

  for (const [frameNum, holdMs] of FRAMES) {
    // Set the frame via hash
    await page.evaluate((n) => {
      window.location.hash = `frame=${n}`;
    }, frameNum);

    // Small wait for CSS transition to complete
    await page.waitForTimeout(350);

    // We need multiple copies for GIF timing (ImageMagick delay is in centiseconds)
    // Each "tick" = 10 centiseconds = 100ms
    // We'll use delay=10 (100ms) per frame image, and repeat to achieve holdMs
    const repeats = Math.ceil(holdMs / 100);

    const pngPath = path.join(FRAMES_DIR, `frame-${String(imgIndex).padStart(3, '0')}.png`);
    await page.screenshot({ path: pngPath, fullPage: false });
    console.log(`  Frame ${frameNum} → ${pngPath} (×${repeats} @ 100ms)`);

    // Add the path repeated 'repeats' times to allPngs with delay info
    for (let r = 0; r < repeats; r++) {
      allPngs.push({ path: pngPath, delay: 10 }); // 10 centiseconds = 100ms
    }

    imgIndex++;
  }

  await browser.close();
  console.log('Browser closed.');

  // Build GIF with ImageMagick convert
  // Use a palette approach for better quality
  console.log('Assembling GIF with ImageMagick...');

  // Build the convert command with per-frame delays
  // Since all frames use the same delay (10cs = 100ms), we group by repeated PNGs
  // But ImageMagick needs explicit -delay before each input

  // Simpler: build a command with grouped delay+repeat via -delay -loop
  // We'll write a list file approach
  const convertArgs = ['-loop', '0', '-layers', 'optimize'];

  // Build frame list: group consecutive same-delay entries
  let lastPng = null;
  let count = 0;
  const groups = [];
  for (const f of allPngs) {
    if (f.path === lastPng) {
      count++;
    } else {
      if (lastPng) groups.push({ path: lastPng, count });
      lastPng = f.path;
      count = 1;
    }
  }
  if (lastPng) groups.push({ path: lastPng, count });

  const inputArgs = [];
  for (const g of groups) {
    // delay 10cs per frame, repeated count times
    inputArgs.push(`-delay 10 -loop 0`); // ignored, use per-image
    // Just push with the delay set individually
    for (let i = 0; i < g.count; i++) {
      inputArgs.push(`"${g.path}"`);
    }
  }

  // Actually build a proper command
  let cmd = 'convert -loop 0';
  for (const g of groups) {
    const delay = 10; // 10 centiseconds = 100ms each copy
    cmd += ` -delay ${delay}`;
    // Push the image once for each repeat
    for (let i = 0; i < g.count; i++) {
      cmd += ` "${g.path}"`;
    }
  }
  // Resize to ensure exact 400x700 (in case deviceScaleFactor doubled it)
  cmd += ` -resize 400x700! -layers optimize-frame -dither FloydSteinberg -colors 128 "${OUT_GIF}"`;

  console.log('Running convert...');
  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch (e) {
    // If -layers optimize-frame fails, try simpler
    console.log('Retry with simpler options...');
    let cmd2 = 'convert -loop 0';
    for (const g of groups) {
      for (let i = 0; i < g.count; i++) {
        cmd2 += ` -delay 10 "${g.path}"`;
      }
    }
    cmd2 += ` -resize 400x700! -dither FloydSteinberg -colors 128 "${OUT_GIF}"`;
    execSync(cmd2, { stdio: 'inherit' });
  }

  console.log(`GIF saved: ${OUT_GIF}`);

  // Copy to ph-kit
  fs.copyFileSync(OUT_GIF, COPY_GIF);
  console.log(`Copied to: ${COPY_GIF}`);

  // Print file size
  const stats = fs.statSync(OUT_GIF);
  console.log(`File size: ${(stats.size / 1024).toFixed(1)} KB`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
