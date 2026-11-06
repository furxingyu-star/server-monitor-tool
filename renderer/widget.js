'use strict';
const $ = (id) => document.getElementById(id);
let boot = null;
let latest = null;
let pinned = true;
let sparkPts = [];

const fmtRate = (b) => {
  const n = Number(b) || 0;
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB/s';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB/s';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB/s';
  return n.toFixed(0) + ' B/s';
};
const fmtSize = (b) => {
  const n = Number(b) || 0;
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + 'G';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(0) + 'M';
  if (n >= 1024) return (n / 1024).toFixed(0) + 'K';
  return n.toFixed(0);
};

function setRing(id, pct) {
  const el = $(id);
  if (!el) return;
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  el.style.strokeDashoffset = String(264 - 264 * v / 100);
}

/* ---------- Pixel UI：Material You 动态取色（和主面板同一套思路） ---------- */
const SYSTEM_DARK = window.matchMedia('(prefers-color-scheme: dark)');
function resolvedDark() {
  const ui = (boot && boot.settings && boot.settings.ui) || {};
  const mode = ['light', 'dark', 'system'].indexOf(ui.appearance) >= 0 ? ui.appearance : 'system';
  return mode === 'dark' || (mode === 'system' && SYSTEM_DARK.matches);
}
function hexToHsl(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return [200, .8, .55];
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, sat, l];
}
function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}
function rgbToHsl255(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > .5 ? d / (2 - max - min) : d / (max + min);
  const hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh / 6, sat, l];
}
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [26, 115, 232];
}

let pixelSeed = null;                       // 壁纸主色的 [h, s]
const pixelKey = { key: '' };

// 和主面板同一规则：手选的强调色优先于壁纸取色，并且跨重启保持（ui.accentCustom）。
function customAccent(ui) {
  if (!ui) return false;
  if (ui.accentCustom === true) return true;
  if (ui.accentCustom === false) return false;
  return !!ui.accent && String(ui.accent).toLowerCase() !== '#1a73e8';
}

function applyPixelTheme() {
  if (document.documentElement.getAttribute('data-theme') !== 'pixel') { pixelKey.key = ''; return; }
  const ui = (boot && boot.settings && boot.settings.ui) || {};
  const accent = ui.accent || '#1a73e8';
  const dark = resolvedDark();
  const seed = customAccent(ui) ? null : pixelSeed;
  const key = (seed ? 'seed:' + seed[0].toFixed(3) + ':' + seed[1].toFixed(3) : 'accent:' + accent) + (dark ? '|dark' : '|light');
  if (key === pixelKey.key) return;
  pixelKey.key = key;

  let h, sat;
  if (seed) {
    h = seed[0]; sat = seed[1];
  } else {
    const hsl = hexToHsl(accent);
    h = hsl[0]; sat = Math.max(.62, Math.min(.95, hsl[1] || .78));
  }
  sat = Math.max(.42, Math.min(.92, sat));

  // 和主面板 applyPixelPalette() 用同一套 M3 角色公式，两个窗口的颜色才是同一个色
  const primary = dark ? hslToHex(h, sat * .72, .78) : hslToHex(h, sat, .42);
  const vars = dark ? {
    '--p-primary': primary,
    '--p-on-primary': hslToHex(h, Math.min(.6, sat * .6), .18),
    '--p-primary-container': hslToHex(h, Math.min(.55, sat * .45), .30),
    '--p-on-primary-container': hslToHex(h, Math.min(.55, sat * .4), .92),
    '--p-secondary-container': hslToHex(h, Math.min(.30, sat * .22), .26),
    '--p-on-secondary-container': hslToHex(h, Math.min(.4, sat * .3), .90),
    '--p-surface': hslToHex(h, Math.min(.16, sat * .14), .075),
    '--p-surface-1': hslToHex(h, Math.min(.14, sat * .12), .105),
    '--p-surface-2': hslToHex(h, Math.min(.14, sat * .12), .142),
    '--p-surface-3': hslToHex(h, Math.min(.14, sat * .12), .185),
    '--p-on-surface': hslToHex(h, .10, .92),
    '--p-on-surface-variant': hslToHex(h, .12, .78),
    '--p-on-surface-muted': hslToHex(h, .08, .62),
    '--p-outline': hslToHex(h, .10, .52),
    '--p-outline-variant': hslToHex(h, .12, .26),
    '--accent': primary
  } : {
    '--p-primary': primary,
    '--p-on-primary': '#ffffff',
    '--p-primary-container': hslToHex(h, Math.min(.75, sat * .72), .92),
    '--p-on-primary-container': hslToHex(h, sat, .28),
    '--p-secondary-container': hslToHex(h, Math.min(.5, sat * .28), .91),
    '--p-on-secondary-container': hslToHex(h, Math.min(.4, sat * .3), .24),
    '--p-surface': hslToHex(h, Math.min(.10, sat * .10), .976),
    '--p-surface-1': '#ffffff',
    '--p-surface-2': hslToHex(h, Math.min(.12, sat * .12), .949),
    '--p-surface-3': hslToHex(h, Math.min(.14, sat * .14), .902),
    '--p-on-surface': hslToHex(h, .06, .12),
    '--p-on-surface-variant': hslToHex(h, .07, .29),
    '--p-on-surface-muted': hslToHex(h, .05, .42),
    '--p-outline': hslToHex(h, .10, .70),
    '--p-outline-variant': hslToHex(h, .14, .90),
    '--accent': primary
  };
  const r = document.documentElement.style;
  Object.keys(vars).forEach((k) => r.setProperty(k, vars[k]));
}

function loadPixelSeed(url) {
  if (!url) return;
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = 16; c.height = 16;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      const TAU = Math.PI * 2;
      let sx = 0, sy = 0, sat = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        const hsl = rgbToHsl255(d[i], d[i + 1], d[i + 2]);
        if (hsl[1] < .18 || hsl[2] < .10 || hsl[2] > .94) continue;
        const weight = hsl[1] * hsl[1] * (.4 + Math.min(.8, hsl[2]));
        const a = hsl[0] * TAU;
        sx += Math.cos(a) * weight; sy += Math.sin(a) * weight;
        sat += hsl[1] * weight; w += weight;
      }
      if (w <= 0) return;
      let hue = Math.atan2(sy, sx) / TAU;
      if (hue < 0) hue += 1;
      pixelSeed = [hue, Math.min(.90, Math.max(.55, (sat / w) * 1.35))];
    } catch (e) { /* 取色失败就保持强调色 */ }
    applyPixelTheme();
  };
  img.src = url;
}

function applyWallpaper(url) {
  if (!url) return;
  const el = $('wallpaper');
  el.style.backgroundImage = 'url("' + url.replace(/"/g, '\\"') + '")';
  loadPixelSeed(url);
}

/* 玻璃主题优先用自选壁纸（和主面板保持一致），像素主题跟随桌面壁纸。 */
function pickWallpaper() {
  const ui = (boot && boot.settings && boot.settings.ui) || {};
  const glass = boot && boot.wallpaper && boot.wallpaper.glass;
  if (ui.theme === 'glass' && glass) { applyWallpaper(glass.thumb || glass.url); return; }
  applyWallpaper((boot.wallpaper && boot.wallpaper.thumb) || (boot.wallpaper && boot.wallpaper.url));
}

function hostFromUrl(url) {
  try { return new URL(String(url || '')).hostname || ''; } catch { return ''; }
}

function identity(snap) {
  const s = (boot && boot.settings) || {};
  const ui = s.ui || {};
  const showIp = ui.showIp !== false;
  const showDomain = ui.showDomain !== false;
  const custom = String(s.displayName === 'my-server' ? '' : (s.displayName || '')).trim();
  const autoName = String((snap && snap.name) || '').trim();
  const name = custom || autoName;
  const ip = ((s.ssh && s.ssh.host) || hostFromUrl(s.bt && s.bt.baseUrl) || '').trim();
  const primary = showDomain && name ? name : (showIp && ip ? ip : '服务器');
  const secondary = showDomain && showIp && name && ip && primary !== ip ? ip : '';
  return { primary, secondary };
}

function render(s) {
  latest = s;
  const online = !!s.online;
  $('widget').classList.toggle('offline', !online);
  // 演示模式用主面板同款的琥珀点，在线/离线才用绿/红
  const demo = s.mode === 'demo';
  $('statusDot').className = 'status-dot' + (online ? (demo ? ' warn' : '') : ' off');
  const id = identity(s);
  $('wHost').textContent = id.primary + (id.secondary ? ' · ' + id.secondary : '');
  const modeText = s.mode === 'bt' ? '宝塔 API' + (s.panelVersion ? ' · BT ' + s.panelVersion : '') : s.mode === 'ssh' ? 'SSH 实时' : '演示模式';
  $('modeLabel').textContent = online ? modeText : (s.error ? '连接断开' : '离线');
  $('modeLabel').title = s.error || '';

  const cpu = s.cpu && s.cpu.usage || 0;
  const mem = s.mem && s.mem.percent || 0;
  const disk = s.disk && s.disk.percent || 0;
  $('cpuVal').innerHTML = cpu.toFixed(0) + '<span>%</span>';
  $('memVal').innerHTML = mem.toFixed(0) + '<span>%</span>';
  $('diskVal').innerHTML = disk.toFixed(0) + '<span>%</span>';
  setRing('ringCpu', cpu); setRing('ringMem', mem); setRing('ringDisk', disk);
  $('cpuSub').textContent = (s.cpu && s.cpu.cores ? s.cpu.cores + ' 核' : '—') + (s.cpu && s.cpu.load ? ' · ' + Number(s.cpu.load[0]).toFixed(2) : '');
  $('memSub').textContent = s.mem && s.mem.total ? fmtSize(s.mem.used) + ' / ' + fmtSize(s.mem.total) : '—';
  $('diskSub').textContent = s.disk && s.disk.total ? fmtSize(s.disk.used) + ' / ' + fmtSize(s.disk.total) : '—';
  $('wUp').textContent = fmtRate(s.net && s.net.up);
  $('wDown').textContent = fmtRate(s.net && s.net.down);
  $('wLoad').textContent = s.cpu && s.cpu.load ? Number(s.cpu.load[0]).toFixed(2) : '0.00';
  $('wUptime').textContent = s.uptime ? '运行 ' + s.uptime : '';

  if (Array.isArray(s.cpuHistory) && s.cpuHistory.length) {
    sparkPts = s.cpuHistory.map((h) => Number(h.cpu) || 0);
  } else {
    sparkPts.push(cpu);
    if (sparkPts.length > 60) sparkPts.shift();
  }
  drawSpark();
}

function drawSpark() {
  const c = $('spark');
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 340;
  const h = 46;
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pts = sparkPts.length ? sparkPts.slice(-60) : [0, 0, 0];
  if (pts.length < 2) pts.push(pts[0] || 0);
  const max = Math.max(20, ...pts) * 1.25;
  const stepX = w / (pts.length - 1);
  const yOf = (v) => h - 4 - (v / max) * (h - 10);
  const themeNow = document.documentElement.getAttribute('data-theme');
  const dark = resolvedDark();
  const pixelPrimary = themeNow === 'pixel'
    ? (getComputedStyle(document.documentElement).getPropertyValue('--p-primary').trim() || '#1a73e8')
    : '#1a73e8';
  const ink = themeNow === 'pixel' ? hexToRgb(pixelPrimary).join(',') : (dark ? '124,216,255' : '26,115,232');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(' + ink + ',.30)');
  grad.addColorStop(1, 'rgba(' + ink + ',0)');
  ctx.beginPath();
  ctx.moveTo(0, h);
  pts.forEach((v, i) => ctx.lineTo(i * stepX, yOf(v)));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  pts.forEach((v, i) => { const x = i * stepX, y = yOf(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = 'rgba(' + ink + ',.80)'; ctx.lineWidth = 1.4;
  ctx.shadowColor = 'rgba(' + ink + ',.35)'; ctx.shadowBlur = 6; ctx.stroke();
  ctx.shadowBlur = 0;

  const lx = (pts.length - 1) * stepX, ly = yOf(pts[pts.length - 1]);
  ctx.beginPath(); ctx.arc(lx - 0.5, ly, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = themeNow === 'pixel' ? pixelPrimary : (dark ? '#ccf3ff' : '#1a73e8');
  ctx.shadowColor = 'rgba(' + ink + ',.45)'; ctx.shadowBlur = 8; ctx.fill();
  ctx.shadowBlur = 0;
}

function tickClock() {
  const d = new Date();
  $('wClock').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
setInterval(tickClock, 1000);
tickClock();

function applyLook(settings) {
  const ui = (settings && settings.ui) || {};
  const glass = ui.theme === 'glass';
  if (window.CatSpeak) window.CatSpeak.setEnabled(ui.language === 'cat');
  document.documentElement.setAttribute('data-theme', glass ? 'glass' : 'pixel');
  document.documentElement.setAttribute('data-appearance', glass || resolvedDark() ? 'dark' : 'light');
  if (ui.accent) document.documentElement.style.setProperty('--accent', ui.accent);
  applyPixelTheme();
  const size = ui.widgetSize === 'mini' ? 'mini' : 'normal';
  document.documentElement.setAttribute('data-size', size);
  const appName = String(ui.appName || '').trim() || '星语哨兵';
  const brand = $('wBrand');
  if (brand) brand.textContent = appName;
  document.title = appName;
  requestAnimationFrame(() => { try { drawSpark(); } catch (e) {} });
}

async function init() {
  boot = await window.sentinel.bootstrap();
  applyLook(boot.settings);
  window.sentinel.onSettings((s) => {
    if (!s) return;
    const prev = boot.settings || {};
    boot.settings = Object.assign({}, prev, s, { ui: Object.assign({}, prev.ui || {}, s.ui || {}) });
    applyLook(boot.settings);
    pickWallpaper();
    if (latest) render(latest);
  });
  SYSTEM_DARK.addEventListener('change', () => {
    const ui = (boot && boot.settings && boot.settings.ui) || {};
    if ((ui.appearance || 'system') !== 'system') return;
    applyLook(boot.settings);
    if (latest) render(latest);
  });
  pickWallpaper();
  pinned = !!(boot.settings && boot.settings.ui && boot.settings.ui.alwaysOnTop !== false);
  updatePin();
  const stats = await window.sentinel.getStats();
  if (stats) render(stats);
  window.sentinel.onStats(render);
}

function updatePin() {
  const b = $('pinBtn');
  b.classList.toggle('off', !pinned);
  b.title = pinned ? '取消置顶' : '置顶显示';
}

$('pinBtn').addEventListener('click', async (e) => {
  e.stopPropagation();
  pinned = !pinned;
  await window.sentinel.window.setPin(pinned);
  updatePin();
});
$('openBtn').addEventListener('click', (e) => { e.stopPropagation(); window.sentinel.window.openDashboard(); });
$('mainArea').addEventListener('click', () => window.sentinel.window.openDashboard());
window.addEventListener('resize', drawSpark);
init().catch((e) => console.error(e));
