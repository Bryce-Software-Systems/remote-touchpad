const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// End-to-end check of the phone UI in a phone-sized headless Chromium, against the real Go server (built with the
// `null` input controller) and dev/fake_velarium.py. Needs Node with Playwright (`npm i -g playwright`):
//   NODE_PATH=$(npm root -g) node dev/e2e.js        (screenshots and the JSON report go to a temp directory)
const REPO = path.resolve(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-e2e-'));
const PORT = 8097;
const SOCK = `${DIR}/c.sock`;
execSync(`go build -tags null -o ${DIR}/rt .`, { cwd: REPO, stdio: 'inherit' });

function startServer() {
  const proc = spawn(`${DIR}/rt`, ['-bind', `127.0.0.1:${PORT}`, '-secret', 'test', '-velarium-socket', SOCK], { stdio: 'ignore' });
  return proc;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const fake = spawn('python3', [path.join(REPO, 'dev', 'fake_velarium.py'), SOCK, process.env.VELARIUM_DIR || '.'], { stdio: 'ignore' });
  await sleep(1200);
  let server = startServer();
  await sleep(1200);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const sent = [];
  page.on('websocket', ws => ws.on('framesent', f => sent.push(f.payload)));
  const result = {};
  const shot = (name) => page.screenshot({ path: `${DIR}/${name}.png` });

  await page.goto(`http://127.0.0.1:${PORT}/#test`);
  await page.waitForSelector('.tile:not(.skeleton)', { timeout: 8000 });
  result.tabs = await page.$$eval('.tabbar .tab:not(.hidden)', n => n.map(x => x.textContent.trim()));

  // ---- universal search
  await page.fill('#app-search', 'nat');
  await page.waitForSelector('.result', { timeout: 6000 });
  await page.waitForFunction(() => document.querySelectorAll('.results .group').length >= 4, null, { timeout: 6000 });
  result.searchGroups = await page.$$eval('.results .group', n => n.map(x => x.textContent));
  await shot('search');
  await page.click('.result:has-text("National Treasure")');
  await page.waitForTimeout(1200);
  result.tabAfterOpen = await page.evaluate(() => sessionStorage.getItem('tab'));

  // ---- now playing card on the remote + controls
  await page.waitForSelector('#now-playing:not(.hidden)', { timeout: 6000 });
  result.npTitle = await page.textContent('#np-title');
  result.volumeButtons = await page.$$eval('[data-key=VOLUME_UP],[data-key=VOLUME_DOWN],[data-key=VOLUME_MUTE]', n => n.length);
  await shot('remote-nowplaying');
  await page.click('#np-toggle');
  await page.waitForTimeout(500);
  result.pausedLabel = await page.getAttribute('#np-toggle', 'aria-label');
  await page.click('#np-forward');
  await page.selectOption('#np-audio', { index: 1 });
  await page.waitForTimeout(500);
  // mini bar on another tab
  await page.click('[data-go=keys]');
  await page.waitForSelector('#mini-np:not(.hidden)');
  result.miniTitle = await page.textContent('#mini-np-title');
  await shot('keys-with-mini');
  await page.click('#mini-np #mini-np-title');
  await page.waitForTimeout(300);
  result.miniHiddenOnRemote = await page.$eval('#mini-np', n => n.classList.contains('hidden'));
  result.backToRemote = await page.evaluate(() => sessionStorage.getItem('tab'));

  // ---- more: cast
  await page.click('[data-go=more]');
  await shot('more');
  await page.click('[data-more=cast]');
  await page.fill('#cast-url', 'https://youtu.be/dQw4w9WgXcQ');
  await page.click('#cast-go');
  await page.waitForSelector('#toast:not(.hidden)');
  result.castToast = await page.textContent('#toast');
  await shot('cast');
  await page.waitForTimeout(1000);                  // casting jumps to the Remote, as intended
  result.tabAfterCast = await page.evaluate(() => sessionStorage.getItem('tab'));
  await page.click('[data-go=more]');

  // ---- more: DVR
  await page.click('[data-more-back]:visible');
  await page.click('[data-more=dvr]');
  await page.waitForSelector('.rec');
  result.recCount = await page.$$eval('.rec', n => n.length);
  await shot('dvr');
  await page.click('[data-dvr-mode=schedule]');
  await page.waitForSelector('#dvr-channels .result');
  await page.click('#dvr-channels .result:has-text("CBC News")');
  await page.waitForSelector('.program');
  await page.click('.program >> nth=1 >> button');
  await page.waitForTimeout(400);
  result.scheduledLabel = await page.textContent('.program >> nth=1 >> button');
  await shot('dvr-schedule');

  // ---- more: setup
  await page.click('[data-more-back]:visible');
  await page.click('[data-more=setup]');
  await page.waitForFunction(() => /Connected to/.test(document.querySelector('#wifi-status').textContent));
  await page.click('#wifi-scan');
  await page.waitForSelector('#wifi-list .result');
  await page.click('#wifi-list .result:has-text("Neighbour")');
  await page.fill('#wifi-password', 'wrong-password');
  await page.click('#wifi-connect');
  await page.waitForFunction(() => /password was not accepted/.test(document.querySelector('#toast').textContent), null, { timeout: 6000 });
  result.wifiError = await page.textContent('#toast');
  await shot('setup');
  await page.fill('#jf-server', 'jellyfin.local:8096');
  await page.fill('#jf-user', 'alice');
  await page.fill('#jf-password', 'pw');
  await page.click('#jf-go');
  await page.waitForFunction(() => /Signed in as alice/.test(document.querySelector('#jf-status').textContent), null, { timeout: 6000 });
  result.jellyfinStatus = await page.textContent('#jf-status');

  // ---- automatic reconnect (no button)
  server.kill();
  await page.waitForSelector('#opening:not(.hidden)', { timeout: 8000 });
  result.overlayText = await page.textContent('#overlay-text');
  result.overlayButtons = await page.$$eval('#opening button', n => n.length);
  await shot('reconnecting');
  server = startServer();
  await page.waitForSelector('#opening.hidden', { state: 'attached', timeout: 15000 });
  result.reconnected = true;
  await page.waitForTimeout(600);
  result.afterReconnectTab = await page.evaluate(() => sessionStorage.getItem('tab'));

  const log = JSON.parse(fs.readFileSync(SOCK + '.log', 'utf8'));
  result.opsSeen = [...new Set(log.map(r => r.op))].sort();
  result.passwordsMasked = log.filter(r => 'password' in r).every(r => r.password === '***');
  result.sentPasswordOnWire = sent.some(s => s.includes('wrong-password'));   // the phone does send it (the box masks it in its log)
  result.errors = errors;
  console.log(JSON.stringify(result, null, 1));
  console.log('screenshots in', DIR);
  await browser.close();
  server.kill();
  fake.kill();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
