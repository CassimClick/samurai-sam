// Headless playtest: opens the game in Chrome, runs a script of steps, saves screenshots
// and prints console errors. Usage:
//   node tools/playtest.mjs <outDir> "wait:3000" "shot:menu" "click:320,250" "key:Space:500" ...
// Steps: wait:<ms> | shot:<name> | click:<x>,<y> (stage coords) | key:<Key>[:<holdMs>] | eval:<js>
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [outDir, ...steps] = process.argv.slice(2);
const url = process.env.GAME_URL || 'http://localhost:5173/';
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--window-size=1280,720'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || m.type() === 'warn') errors.push(`[${m.type()}] ${t}`);
  if (process.env.VERBOSE) console.log(`[console.${m.type()}] ${t}`);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('response', (r) => r.status() >= 400 && errors.push(`[http ${r.status()}] ${r.url()}`));

await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForSelector('#start:not([hidden])', { timeout: 60000 });
await page.click('#start');

const stagePoint = async (x, y) => {
  const r = await page.evaluate(() => {
    const b = document.getElementById('game').getBoundingClientRect();
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  });
  return [r.left + (x / 640) * r.width, r.top + (y / 360) * r.height];
};

for (const step of steps) {
  const [cmd, ...rest] = step.split(':');
  const arg = rest.join(':');
  if (cmd === 'wait') await new Promise((r) => setTimeout(r, +arg));
  else if (cmd === 'shot') await page.screenshot({ path: path.join(outDir, arg + '.png') });
  else if (cmd === 'click') {
    const [x, y] = arg.split(',').map(Number);
    const [px, py] = await stagePoint(x, y);
    await page.mouse.move(px, py);
    await new Promise((r) => setTimeout(r, 100));
    await page.mouse.down();
    await new Promise((r) => setTimeout(r, 80));
    await page.mouse.up();
  } else if (cmd === 'key') {
    const [key, hold] = arg.split(':');
    await page.keyboard.down(key);
    await new Promise((r) => setTimeout(r, +(hold || 120)));
    await page.keyboard.up(key);
  } else if (cmd === 'down') await page.keyboard.down(arg);
  else if (cmd === 'up') await page.keyboard.up(arg);
  else if (cmd === 'eval') console.log('eval:', JSON.stringify(await page.evaluate(arg)));
}

console.log(errors.length ? `Console errors/warnings (${errors.length}):\n` + [...new Set(errors)].slice(0, 40).join('\n') : 'No console errors.');
await browser.close();
