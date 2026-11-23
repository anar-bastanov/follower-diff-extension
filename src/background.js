// Toolbar icon and badge: follows the accent color and shows live progress while the popup
// is closed.
importScripts('shared/accents.js', 'shared/storage.js');

const ST = globalThis.FD_Storage;
const ACCENTS = globalThis.FD_ACCENTS;
const COLORS = { error: '#d0343a', done: '#1f9a55' };
const GLYPH = [
  'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
  'M13 7a4 4 0 1 1-8 0a4 4 0 1 1 8 0',
  'M22 21v-2a4 4 0 0 0-3-3.87',
  'M16 3.13a4 4 0 0 1 0 7.75',
];

// Badge text fits about four characters, so large numbers are abbreviated.
function compact(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return n < 1e4 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k` : `${Math.floor(n / 1e3)}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
}

function shade(hex, amount) {
  const target = amount > 0 ? 255 : 0;
  const channel = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) + (target - parseInt(hex.slice(i, i + 2), 16)) * Math.abs(amount));
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
}

// Same drawing as icons/icon.svg, in any accent color.
function drawIcon(size, color) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 128, size / 128);
  const gradient = ctx.createLinearGradient(0, 0, 128, 128);
  gradient.addColorStop(0, shade(color, 0.2));
  gradient.addColorStop(1, shade(color, -0.15));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 30);
  ctx.fill();
  ctx.translate(26, 28);
  ctx.scale(3.15, 3.15);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = size <= 16 ? 3.2 : 2.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of GLYPH) ctx.stroke(new Path2D(d));
  return ctx.getImageData(0, 0, size, size);
}

async function accentColor() {
  const { accent } = await ST.getSettings();
  return (ACCENTS[accent] ?? ACCENTS.violet)[0];
}

async function updateIcon() {
  const { accent } = await ST.getSettings();
  if (!ACCENTS[accent] || accent === 'violet') {
    await chrome.action.setIcon({ path: { 16: '/icons/icon16.png', 32: '/icons/icon32.png' } });
  } else {
    const color = ACCENTS[accent][0];
    await chrome.action.setIcon({ imageData: { 16: drawIcon(16, color), 32: drawIcon(32, color) } });
  }
}

async function updateBadge() {
  const { scan_state: scan, manual_buffer: capture } = await chrome.storage.local.get(['scan_state', 'manual_buffer']);
  let text = '';
  let color = await accentColor();
  if (capture) {
    text = compact(capture[capture.step === 'following' ? 'following' : 'followers'].length);
  } else if (ST.isAlive(scan)) {
    const n = scan.stage === 'following' ? scan.following : scan.followers;
    text = n == null ? '…' : compact(n);
  } else if (scan?.error && !scan.dismissed) {
    text = '!';
    color = COLORS.error;
  } else if (scan?.done && !scan.dismissed) {
    text = 'OK';
    color = COLORS.done;
  }
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
}

const refresh = () => Promise.all([updateIcon(), updateBadge()]);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) refresh();
  else if (changes.scan_state || changes.manual_buffer) updateBadge();
});
chrome.runtime.onStartup.addListener(refresh);
chrome.runtime.onInstalled.addListener(refresh);
