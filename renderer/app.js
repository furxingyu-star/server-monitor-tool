'use strict';
/* 星语哨兵 · StarWhisper Sentinel — 主面板渲染层 */

const $ = (id) => document.getElementById(id);
const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

const state = {
  snap: null,
  settings: null,
  wallpaper: { path: '', url: '', thumb: '' },
  sysWallpaper: { path: '', url: '', thumb: '' },
  glassWallpaper: null,
  accent: '#1a73e8',
  theme: 'pixel',
  appearance: 'system', // light | dark | system（决定像素皮肤的明暗）
  language: 'zh', // zh | cat（中文猫猫语）
  showIp: true,
  showDomain: true,
  appName: '星语哨兵',
  appSubtitle: 'StarWhisper Sentinel',
  startup: 'both',
  showWidget: true,
  widgetAutostart: true,
  widgetSize: 'normal',
  closeAction: 'tray',
  closeNotify: true,
  closeTip: 'tray',
  closeTipText: '',
  closeTipSilent: false,
  chartMetric: 'cpu',
  perfMetric: 'cpu',
  term: null,
  fit: null,
  termReady: false,
  termMode: 'idle',
  demoShell: { buffer: '', active: false, cwd: '~' }
};

const MODE_LABEL = { demo: '演示', bt: '宝塔 API', ssh: 'SSH' };

/* 上次选择的主题先写回 <html>，避免首屏闪一下另一套皮肤（bootstrap 返回后会再校准）。 */
try {
  const bootTheme = localStorage.getItem('sws.theme');
  if (bootTheme === 'pixel' || bootTheme === 'glass') document.documentElement.setAttribute('data-theme', bootTheme);
} catch (e) { /* ignore */ }

/* ---------- 身份展示（IP / 域名） ---------- */
function hostFromUrl(url) {
  try { return new URL(String(url || '')).hostname || ''; } catch { return ''; }
}

function identity() {
  const s = state.settings || {};
  const showIp = state.showIp !== false;
  const showDomain = state.showDomain !== false;
  const domain = String(s.displayName === 'my-server' ? '' : (s.displayName || '')).trim();
  const ip = ((s.ssh && s.ssh.host) || hostFromUrl(s.bt && s.bt.baseUrl) || '').trim();
  const primary = showDomain && domain ? domain : (showIp && ip ? ip : '服务器');
  const secondary = showDomain && showIp && domain && ip ? ip : '';
  return { primary, secondary, showIp, showDomain, domain, ip };
}

/* ---------- formatting ---------- */
function fmtSize(bytes, digits = 1) {
  const b = num(bytes);
  if (!b) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0, v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(digits)) + ' ' + units[i];
}
function fmtRate(bytes) {
  return fmtSize(bytes, 1) + '/s';
}
/* 同一单位的两个容量并成「13.9 / 38.6 GB」，避免卡片底部折行出现两个单位 */
function fmtPair(a, b) {
  const sa = fmtSize(a), sb = fmtSize(b);
  const ma = /^([\d.]+) (.*)$/.exec(sa), mb = /^([\d.]+) (.*)$/.exec(sb);
  if (ma && mb && ma[2] && ma[2] === mb[2]) return ma[1] + ' / ' + sb;
  return sa + ' / ' + sb;
}
function fmtGB(mb) {
  const v = num(mb) / 1024;
  return v >= 100 ? v.toFixed(0) + ' GB' : v.toFixed(1) + ' GB';
}
function pct(n) { return clamp(num(n), 0, 100); }
// 宝塔 API 的内存字段以 MB 返回，而演示/SSH 数据源以字节返回。
function toBytes(v, fallbackKb) {
  if (v == null || Number.isNaN(Number(v))) v = fallbackKb != null ? Number(fallbackKb) * 1024 : 0;
  const n = num(v);
  if (!n) return 0;
  return n > 1e8 ? n : n * 1024 * 1024;
}
function fmtUptime(s) {
  if (!s) return '—';
  if (typeof s !== 'string') return String(s);
  return s.replace(/^已运行\s*/, '').replace(/,/g, ' ');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function relTime(ts) {
  if (!ts) return '—';
  const d = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (d < 2) return '刚刚';
  if (d < 60) return d + ' 秒前';
  return Math.round(d / 60) + ' 分钟前';
}
function setTrend(id, history, key) {
  const el = $(id);
  if (!el) return;
  const t = trendOf(history, key);
  el.textContent = t;
  el.className = 'mc-trend' + (t === '持平' ? ' flat' : t.charAt(0) === '↑' ? ' up' : t.charAt(0) === '↓' ? ' down' : '');
}

function trendOf(history, key) {
  if (!history || history.length < 2) return '—';
  const a = num(history[history.length - 2][key]);
  const b = num(history[history.length - 1][key]);
  const d = b - a;
  if (Math.abs(d) < 0.05) return '持平';
  return (d > 0 ? '↑ ' : '↓ ') + Math.abs(d).toFixed(1);
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(msg, kind = '') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast ' + kind; }, 2600);
}

/* ---------- accent / backdrop ---------- */
const LIGHT_THEMES = ['pixel'];
function isLightTheme() {
  return LIGHT_THEMES.indexOf(document.documentElement.getAttribute('data-theme')) >= 0;
}

function hexToHsl(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return [200, .8, .55];
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > .5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
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

/* 浅色主题下把浅色强调色调深，保证线和数字在白玻璃上有对比 */
function paintTint(color) {
  if (!isLightTheme() || !color) return color;
  const [h, s, l] = hexToHsl(color);
  if (l <= .55) return color;
  return hslToHex(h, Math.min(.82, Math.max(.5, s)), .40);
}

function applyAccent(color) {
  if (!color) return;
  state.accent = color;
  document.documentElement.style.setProperty('--accent', paintTint(color));
  els('#accentRow button').forEach((b) => b.classList.toggle('active', b.dataset.accent === color));
  applyPixelPalette();
  repaintChartsIfNeeded();
}

/* 两套主题：pixel（Material You，可明可暗）与 glass（玻璃玻玻璃，深色液态玻璃）。
   任何不认识的旧配置都会回落到 pixel。 */
const THEMES = ['pixel', 'glass'];
const THEME_LABELS = { pixel: '像素 · Material You', glass: '玻璃玻玻璃' };

function applyTheme(id) {
  const next = THEMES.indexOf(id) >= 0 ? id : (THEMES.indexOf(state.theme) >= 0 ? state.theme : 'pixel');
  state.theme = next;
  if (!state.accent) state.accent = '#1a73e8';
  document.documentElement.setAttribute('data-theme', next);
  document.documentElement.style.setProperty('--accent', paintTint(state.accent));
  els('#themeGrid .theme-card').forEach((b) => b.classList.toggle('active', b.dataset.theme === next));
  const ft = $('footTheme');
  if (ft) ft.textContent = THEME_LABELS[next];
  try { localStorage.setItem('sws.theme', next); } catch (e) { /* ignore */ }
  if (next === 'glass' && window.LiquidGlass) window.LiquidGlass.mount();
  applyThemeBackdrop();
  applyPixelPalette();
  repaintChartsIfNeeded();
  applyAppearance(state.appearance);
}


/* ---------- Pixel UI：Material You 动态取色 ----------
   从当前壁纸里取一个主色（没有壁纸 / 用户自选了强调色时用强调色），
   生成一组 M3 浅色角色写到 <html> 上，pixel-theme.css 里所有颜色都读这些变量。
   同一组种子只算一次，避免每次刷新都重新采样。 */
const pixelPalette = { key: '' };
let pixelPrimary = '';      // 当前 M3 主色（图表 / canvas 用）
let pixelAccentSeed = false; // 用户在像素主题里手动挑过颜色 */


function rgbToHsl255(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const sat = l > .5 ? d / (2 - max - min) : d / (max + min);
  const hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh / 6, sat, l];
}

/* 只挑壁纸里「有颜色」的像素，按色相做圆周平均（蓝+紫才不会平均成灰），
   彩度加权 —— 这就是 M3 会拿去做种子的那个活力色；壁纸太灰就交回强调色。 */
let wallSeedCache = { src: null, val: null };
function sampleWallSeed() {
  if (!wallSample.ready || !wallSample.img) return null;
  if (wallSeedCache.src === wallSample.src) return wallSeedCache.val;
  try {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(wallSample.img, 0, 0, 16, 16);
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
    if (w <= 0) { wallSeedCache = { src: wallSample.src, val: null }; return null; }
    let h = Math.atan2(sy, sx) / TAU;
    if (h < 0) h += 1;
    const val = [h, Math.min(.90, Math.max(.55, (sat / w) * 1.35))];
    wallSeedCache = { src: wallSample.src, val };
    return val;
  } catch (e) {
    return null;
  }
}

function applyPixelPalette() {
  if (state.theme !== 'pixel') { pixelPalette.key = ''; pixelPrimary = ''; return; }
  const customAccent = pixelAccentSeed && !!state.accent;
  const wall = customAccent ? null : sampleWallSeed();
  const dark = document.documentElement.getAttribute('data-appearance') === 'dark';
  const key = (wall ? 'wall:' + (wallSample.src || '') : 'accent:' + (state.accent || '')) + (dark ? '|dark' : '|light');
  if (key === pixelPalette.key) return;
  pixelPalette.key = key;

  let h = .60, s = .78;
  if (wall) {
    h = wall[0]; s = wall[1];
  } else if (state.accent) {
    const hsl = hexToHsl(state.accent);
    h = hsl[0]; s = Math.max(.62, Math.min(.95, hsl[1] || .78));
  }
  s = Math.max(.42, Math.min(.92, s));

  // 浅色用 M3 的 tone 40 主色 + 白底；深色换成 tone 80 主色 + 低亮度表面
  const primary = dark ? hslToHex(h, s * .72, .78) : hslToHex(h, s, .42);
  const vars = dark ? {
    '--p-primary': primary,
    '--p-on-primary': hslToHex(h, Math.min(.6, s * .6), .18),
    '--p-primary-container': hslToHex(h, Math.min(.55, s * .45), .30),
    '--p-on-primary-container': hslToHex(h, Math.min(.55, s * .4), .92),
    '--p-secondary-container': hslToHex(h, Math.min(.30, s * .22), .26),
    '--p-on-secondary-container': hslToHex(h, Math.min(.4, s * .3), .90),
    '--p-surface': hslToHex(h, Math.min(.16, s * .14), .075),
    '--p-surface-1': hslToHex(h, Math.min(.14, s * .12), .105),
    '--p-surface-2': hslToHex(h, Math.min(.14, s * .12), .142),
    '--p-surface-3': hslToHex(h, Math.min(.14, s * .12), .185),
    '--p-on-surface': hslToHex(h, .10, .92),
    '--p-on-surface-variant': hslToHex(h, .12, .78),
    '--p-on-surface-muted': hslToHex(h, .08, .62),
    '--p-outline': hslToHex(h, .10, .52),
    '--p-outline-variant': hslToHex(h, .12, .26),
    '--accent': primary
  } : {
    '--p-primary': primary,
    '--p-on-primary': '#ffffff',
    '--p-primary-container': hslToHex(h, Math.min(.75, s * .72), .92),
    '--p-on-primary-container': hslToHex(h, s, .28),
    '--p-secondary-container': hslToHex(h, Math.min(.5, s * .28), .91),
    '--p-on-secondary-container': hslToHex(h, Math.min(.4, s * .3), .24),
    '--p-surface': hslToHex(h, Math.min(.10, s * .10), .976),
    '--p-surface-1': '#ffffff',
    '--p-surface-2': hslToHex(h, Math.min(.12, s * .12), .949),
    '--p-surface-3': hslToHex(h, Math.min(.14, s * .14), .902),
    '--p-on-surface': hslToHex(h, .06, .12),
    '--p-on-surface-variant': hslToHex(h, .07, .29),
    '--p-on-surface-muted': hslToHex(h, .05, .42),
    '--p-outline': hslToHex(h, .10, .70),
    '--p-outline-variant': hslToHex(h, .14, .90),
    // 图表 / 进度条 / 强调色统一跟着主色走
    '--accent': primary
  };
  const root = document.documentElement;
  Object.keys(vars).forEach((k) => root.style.setProperty(k, vars[k]));
  pixelPrimary = primary;
  repaintChartsIfNeeded();
}

/* 图表是 canvas 画的，读不了 CSS 变量，得在调色板变化后重画一次 */
function accentForChart() {
  return state.theme === 'pixel' && pixelPrimary ? pixelPrimary : state.accent;
}

function repaintChartsIfNeeded() {
  if (!state.snap) return;
  try {
    const v = snapshotView(state.snap);
    if ($('mainChart')) renderMainChart(v);
    if ($('perfChart')) renderPerformance(v);
    if ($('heroSpark')) renderHeroSpark(v);
    renderMetricSparks(v);
  } catch (e) {}
}

/* ---------- 外观模式：跟随系统 / 浅色 / 深色 ----------
   只决定像素皮肤用 Material You 的亮/暗哪一套。 */
const SYSTEM_DARK = window.matchMedia('(prefers-color-scheme: dark)');
function resolvedDark() {
  return state.appearance === 'dark' || (state.appearance === 'system' && SYSTEM_DARK.matches);
}
const APPEARANCE_HINT = '按 Windows 深色设置自动切换；浅色/深色决定像素皮肤的明暗。';
const GLASS_HINT = '玻璃玻玻璃 使用深色液态玻璃，固定深色；切回像素主题可选浅色 / 深色。';

function applyAppearance(mode) {
  state.appearance = ['light', 'dark', 'system'].indexOf(mode) >= 0 ? mode : 'system';
  const glass = state.theme === 'glass';
  const dark = glass || resolvedDark();
  document.documentElement.setAttribute('data-appearance', dark ? 'dark' : 'light');
  els('#appearanceSeg button').forEach((b) => b.classList.toggle('active', !glass && b.dataset.appearance === state.appearance));
  applyPixelPalette();
  repaintChartsIfNeeded();
  updateSegIndicators();
  syncAppearanceLock();
}

/* 玻璃玻玻璃 只有深色一套，切到该主题时把外观模式锁住，切回像素主题再恢复用户的选择。 */
function syncAppearanceLock() {
  const glass = state.theme === 'glass';
  const seg = $('appearanceSeg');
  if (seg) {
    seg.classList.toggle('is-locked', glass);
    Array.prototype.forEach.call(seg.querySelectorAll('button'), (b) => { b.disabled = glass; });
  }
  const hint = $('appearanceHint');
  if (hint) hint.textContent = glass ? GLASS_HINT : APPEARANCE_HINT;
}
SYSTEM_DARK.addEventListener('change', () => { if (state.appearance === 'system') applyAppearance('system'); });

/* ---------- 语言：简体中文 / 中文猫猫语 ----------
   猫猫语只改界面文案（renderer/cat-speak.js），不动数据与终端输出。 */
const LANGUAGES = ['zh', 'cat'];
const LANG_LABELS = { zh: '简体中文', cat: '中文猫猫语 🐱' };
function applyLanguage(lang) {
  state.language = LANGUAGES.indexOf(lang) >= 0 ? lang : 'zh';
  document.documentElement.setAttribute('data-lang', state.language);
  if (window.CatSpeak) window.CatSpeak.setEnabled(state.language === 'cat');
  els('#langSeg button').forEach((b) => b.classList.toggle('active', b.dataset.lang === state.language));
  const hint = $('langHint');
  if (hint) hint.textContent = LANG_LABELS[state.language];
  if ($('langSeg')) updateSegIndicators($('langSeg'));
}

/* 语言行默认折叠，只显示当前语言；点标题展开选项。 */
function setLangOpen(open) {
  const row = $('langRow');
  const body = $('langBody');
  const toggle = $('langToggle');
  if (!row || !body) return;
  body.hidden = !open;
  row.classList.toggle('open', !!open);
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) requestAnimationFrame(() => { if ($('langSeg')) updateSegIndicators($('langSeg')); });
}

/* ---------- 平滑选项切换：移动高亮指示器 ----------
   参照 zhoulinhua0-star/smooth-option-switcher 的交互：选项互斥，高亮块在选中项之间平滑移动，
   缓动 cubic-bezier(.34,.96,.6,.99)，动效只走 CSS；位置/尺寸按实际按钮量取，换主题/换字号也不会错位。 */
function segIndicatorFor(row) {
  let ind = row.querySelector(':scope > .seg-ind');
  if (!ind) {
    ind = document.createElement('span');
    ind.className = 'seg-ind';
    ind.setAttribute('aria-hidden', 'true');
    row.insertBefore(ind, row.firstChild);
  }
  return ind;
}

function updateSegIndicators(scope) {
  let rows;
  if (!scope) {
    rows = Array.prototype.slice.call(document.querySelectorAll('.seg, .seg-row'));
  } else {
    rows = Array.prototype.slice.call(scope.querySelectorAll('.seg, .seg-row'));
    if (scope.matches && scope.matches('.seg, .seg-row')) rows.unshift(scope);
  }
  rows.forEach((row) => {
    const ind = segIndicatorFor(row);
    const btn = row.querySelector('button.active');
    if (!btn || !btn.offsetWidth) { ind.style.opacity = '0'; return; }
    ind.style.width = btn.offsetWidth + 'px';
    ind.style.height = btn.offsetHeight + 'px';
    ind.style.transform = 'translate(' + btn.offsetLeft + 'px,' + btn.offsetTop + 'px)';
    ind.style.opacity = '1';
    // 首次定位不要从 (0,0) 滑进来：先摆好位置，下一帧再开启动画
    if (!row.classList.contains('is-ready')) requestAnimationFrame(() => row.classList.add('is-ready'));
  });
}

function initSegIndicators() {
  updateSegIndicators();
  // 点击后（各控件自己改完 active）再量一次，覆盖所有 seg / seg-row
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button, .seg-row button');
    if (!b) return;
    const row = b.parentElement;
    requestAnimationFrame(() => updateSegIndicators(row));
  });
  window.addEventListener('resize', () => updateSegIndicators());
  // 键盘可达：左右方向键 / Home / End 在选项间移动并选中
  Array.prototype.forEach.call(document.querySelectorAll('.seg, .seg-row'), (row) => {
    row.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
      const btns = Array.prototype.slice.call(row.querySelectorAll('button:not(:disabled)'));
      if (!btns.length) return;
      const cur = btns.indexOf(document.activeElement);
      let next = cur;
      if (e.key === 'ArrowLeft') next = cur <= 0 ? btns.length - 1 : cur - 1;
      else if (e.key === 'ArrowRight') next = cur < 0 || cur === btns.length - 1 ? 0 : cur + 1;
      else if (e.key === 'Home') next = 0;
      else next = btns.length - 1;
      e.preventDefault();
      btns[next].focus();
      btns[next].click();
    });
  });
}

function applyDisplay(ui) {
  ui = ui || {};
  state.showIp = ui.showIp !== false;
  state.showDomain = ui.showDomain !== false;
  const a = $('showIp');
  const b = $('showDomain');
  if (a) a.checked = state.showIp;
  if (b) b.checked = state.showDomain;
  if (state.snap) render(state.snap);
}

function applyAppName(name, subtitle) {
  // 应用名称允许留空：清空后就保持空白，不再自动填回默认名。
  const n = String(name || '').trim();
  const shown = n || '星语哨兵'; // 窗口标题 / 托盘等系统位置的回退名
  const rawSub = (subtitle === undefined || subtitle === null) ? state.appSubtitle : subtitle;
  const sub = String(rawSub || '').trim();
  state.appName = n;
  state.appSubtitle = sub;
  const brand = $('brandName');
  if (brand) brand.textContent = n;
  const brandSub = $('brandSub');
  if (brandSub) {
    brandSub.textContent = sub;
    brandSub.style.display = sub ? '' : 'none';
  }
  document.title = sub ? shown + ' · ' + sub : shown;
  const aboutName = el('.about-name');
  if (aboutName) aboutName.innerHTML = sub ? esc(shown) + ' <b>' + esc(sub) + '</b>' : esc(shown);
  const quitBtn = $('quitBtn');
  if (quitBtn) quitBtn.textContent = '退出' + shown;
}

/* ---------- 服务器改名（点主机卡上的铅笔，或双击名字） ---------- */
function heroFallbackName() {
  const s = state.settings || {};
  const ip = ((s.ssh && s.ssh.host) || hostFromUrl(s.bt && s.bt.baseUrl) || '').trim();
  return ip || '服务器';
}

function beginHeroRename() {
  const nameEl = $('heroName');
  if (!nameEl || $('heroRenameInput')) return;
  const current = String((state.settings && state.settings.displayName) || '').trim().replace(/^my-server$/, '');
  const input = document.createElement('input');
  input.id = 'heroRenameInput';
  input.className = 'hero-name-input';
  input.type = 'text';
  input.maxLength = 24;
  input.spellcheck = false;
  input.value = current;
  input.placeholder = nameEl.textContent || '服务器名称';
  nameEl.style.display = 'none';
  nameEl.parentNode.insertBefore(input, nameEl.nextSibling);
  input.focus();
  input.select();
  let settled = false;
  const finish = async (commit) => {
    if (settled) return;
    settled = true;
    const next = input.value.trim().slice(0, 24);
    input.remove();
    nameEl.style.display = '';
    if (!commit || next === current) return;
    state.settings = Object.assign({}, state.settings, { displayName: next });
    if (state.snap) state.snap.name = next || heroFallbackName();
    nameEl.textContent = next || heroFallbackName();
    const dn = $('displayName');
    if (dn) dn.value = next;
    try {
      await window.sentinel.saveSettings({ displayName: next });
      window.sentinel.refresh();
      toast(next ? '已改名为「' + next + '」' : '已恢复自动命名');
    } catch (e) {
      toast('改名失败：' + (e.message || e), 'err');
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

let lookTimer = 0;
function persistLook() {
  clearTimeout(lookTimer);
  lookTimer = setTimeout(async () => {
    try {
      await window.sentinel.saveSettings({
        ui: {
          theme: state.theme, accent: state.accent, appearance: state.appearance,
          language: state.language,
          showIp: state.showIp, showDomain: state.showDomain
        }
      });
    } catch (e) { /* ignore */ }
  }, 260);
}

/* 玻璃主题可以用一张单独选的壁纸（折射需要细节），像素主题继续跟随桌面壁纸。 */
function applyThemeBackdrop() {
  const custom = state.theme === 'glass' && state.glassWallpaper && state.glassWallpaper.url;
  const url = custom || state.sysWallpaper.url;
  if (url) applyBackdrop(url);
  syncGlassWp();
}

function syncGlassWp() {
  const row = $('glassWp');
  if (!row) return;
  row.hidden = state.theme !== 'glass';
  const pick = state.glassWallpaper && state.glassWallpaper.thumb;
  const thumb = $('glassWpThumb');
  if (thumb) thumb.style.backgroundImage = pick ? 'url("' + pick.replace(/"/g, '\\"') + '")' : '';
  if (thumb) thumb.classList.toggle('empty', !pick);
  const name = $('glassWpName');
  if (name) {
    name.textContent = pick
      ? '已使用自选壁纸 · 建议选细节多的图片，折射更明显'
      : '跟随桌面壁纸 · 选一张有细节的图片，玻璃折射会更明显';
  }
  const reset = $('glassWpReset');
  if (reset) reset.disabled = !pick;
}

function applyBackdrop(url) {
  if (!url) return;
  $('bg').style.backgroundImage = 'url("' + url.replace(/"/g, '\\"') + '")';
  loadWallSample(url);
}

/* ---------- adaptive glass tint ----------
   Liquid glass takes colour from what sits behind it: sample the wallpaper
   under every pane and expose it as --adapt, so each card is subtly tinted by
   its own backdrop instead of one flat theme colour. */
const wallSample = { img: null, ready: false, grid: null };
let tintTimer = 0;
const TINT_GRID = 192;   // 壁纸只缩小采样一次，之后 tint 全是纯数组运算
function loadWallSample(url) {
  if (!url || wallSample.src === url) return;
  wallSample.src = url;
  wallSample.ready = false;
  pixelAccentSeed = false; // 换了壁纸就回到「从壁纸取色」
  const img = new Image();
  img.onload = () => {
    wallSample.img = img; wallSample.ready = true;
    buildWallGrid(img);
    applyPixelPalette(); repaintChartsIfNeeded(); scheduleAdaptiveTint();
  };
  img.onerror = () => { wallSample.ready = false; };
  img.src = url;
}
function scheduleAdaptiveTint() {
  if (tintTimer) return;
  tintTimer = setTimeout(() => { tintTimer = 0; tintCards(); }, 140);
}
function buildWallGrid(img) {
  const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
  const gw = Math.max(8, Math.min(TINT_GRID, nw));
  const gh = Math.max(8, Math.round(gw * nh / nw));
  const c = document.createElement('canvas');
  c.width = gw; c.height = gh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  try {
    ctx.drawImage(img, 0, 0, gw, gh);
    wallSample.grid = { w: gw, h: gh, data: ctx.getImageData(0, 0, gw, gh).data };
  } catch (e) {
    wallSample.grid = null;
  }
}
function tintCards() {
  if (!wallSample.ready || document.hidden) return;
  const grid = wallSample.grid;
  if (!grid) return;
  const W = window.innerWidth, H = window.innerHeight;
  const bw = W * 1.06, bh = H * 1.06;          // .bg is inset -3%
  const img = wallSample.img;
  const sc = Math.max(bw / img.naturalWidth, bh / img.naturalHeight);
  const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
  const ox = -0.03 * W + (bw - dw) / 2, oy = -0.03 * H + (bh - dh) / 2;
  const dark = !isLightTheme();
  const gw = grid.w, gh = grid.h, px = grid.data;
  els('.glass').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24 || r.bottom < 0 || r.top > H) return;
    // 把卡片矩形映射到已缩小的壁纸网格，最多取约 8x8 个点做平均
    let x0 = Math.floor(((r.left - ox) / dw) * gw);
    let x1 = Math.ceil(((r.right - ox) / dw) * gw);
    let y0 = Math.floor(((r.top - oy) / dh) * gh);
    let y1 = Math.ceil(((r.bottom - oy) / dh) * gh);
    x0 = Math.max(0, Math.min(gw - 1, x0)); x1 = Math.max(x0 + 1, Math.min(gw, x1));
    y0 = Math.max(0, Math.min(gh - 1, y0)); y1 = Math.max(y0 + 1, Math.min(gh, y1));
    const stepX = Math.max(1, Math.ceil((x1 - x0) / 8));
    const stepY = Math.max(1, Math.ceil((y1 - y0) / 8));
    let rr = 0, gg = 0, bb = 0, n = 0;
    const lums = [];
    for (let y = y0; y < y1; y += stepY) {
      const row = y * gw;
      for (let x = x0; x < x1; x += stepX) {
        const i = (row + x) << 2;
        rr += px[i]; gg += px[i + 1]; bb += px[i + 2]; n++;
        lums.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      }
    }
    if (!n) return;
    rr /= n; gg /= n; bb /= n;
    lums.sort((a, b) => a - b);
    const lum = lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.85))];
    // Apple-style adaptive pane: bright backdrops get a darker tint so type stays
    // legible, dark backdrops stay almost perfectly clear. The sampled hue also
    // bleeds slightly into the tint.
    const bright = Math.max(0, Math.min(1, (lum - 64) / 132));
    const a = dark ? (0.04 + bright * 0.21) : (0.05 + bright * 0.11);
    const shade = dark
      ? [Math.round(rr * 0.22 + 7), Math.round(gg * 0.22 + 12), Math.round(bb * 0.22 + 21)]
      : [Math.round(rr * 0.18 + 247), Math.round(gg * 0.18 + 250), Math.round(bb * 0.18 + 254)];
    el.style.setProperty('--adapt', 'rgba(' + shade[0] + ',' + shade[1] + ',' + shade[2] + ',' + a.toFixed(3) + ')');
  });
}
(function initAdaptiveTint() {
  window.addEventListener('resize', scheduleAdaptiveTint);
  const content = document.getElementById('content');
  if (content) content.addEventListener('scroll', scheduleAdaptiveTint, { passive: true });
})();

// Scrolling is the one interaction where a moving backdrop forces every glass pane to
// re-run its blur + SVG lens. Swap in the cheap blur-only path while the wheel is active.
function initScrollFastPath() {
  const content = document.getElementById('content');
  const root = document.documentElement;
  let timer = 0;
  const start = () => {
    if (!root.classList.contains('is-scrolling')) root.classList.add('is-scrolling');
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      root.classList.remove('is-scrolling');
    }, 220);
  };
  if (content) content.addEventListener('scroll', start, { passive: true });
  window.addEventListener('resize', () => { root.classList.add('is-scrolling'); start(); });
}

function initPointerGlow() {
  const g = $('pointerGlow');
  if (!g) return;
  let raf = 0, tx = 0, ty = 0;
  document.addEventListener('mousemove', (e) => {
    tx = e.clientX; ty = e.clientY;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      g.style.left = tx + 'px';
      g.style.top = ty + 'px';
    });
  });
}

/* ---------- navigation ---------- */
let navHandler = null;
function syncNavPill() {
  const nav = document.getElementById('navRail');
  const pill = nav && nav.querySelector('.nav-pill');
  if (!nav || !pill) return;
  const active = nav.querySelector('.nav-item.active');
  if (!active) return;
  const nr = nav.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  pill.style.height = ar.height + 'px';
  pill.style.transform = 'translateY(' + (ar.top - nr.top) + 'px)';
  pill.classList.add('ready');
}

function switchView(name) {
  els('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  els('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  const content = $('content');
  if (content) content.scrollTop = 0;
  // 图表在页面隐藏时画不出来，切过来之后补画一次（否则会显示上一次的拉伸位图）
  requestAnimationFrame(() => { repaintChartsIfNeeded(); updateSegIndicators(); syncNavPill(); });
  if (name === 'terminal') { ensureTerm(); setTimeout(() => { fitTerm(); }, 60); }
  if (navHandler) navHandler(name);
}

/* ---------- stat computation ---------- */
function snapshotView(s) {
  const cpu = s.cpu || {};
  const mem = s.mem || {};
  const disk = s.disk || {};
  const net = s.net || {};
  const io = s.io || {};
  const hist = Array.isArray(s.cpuHistory) ? s.cpuHistory : [];
  const cores = num(cpu.cores) || 1;
  const load = Array.isArray(cpu.load) ? cpu.load : [];
  const load1 = num(load[0]);
  const id = identity();
  return {
    online: s.online !== false,
    mode: s.mode || 'demo',
    name: id.primary,
    host: id.secondary,
    system: s.system || '未知系统',
    version: s.panelVersion || s.version || '—',
    uptime: fmtUptime(s.uptime),
    cpu: pct(cpu.usage),
    cores,
    cpuModel: cpu.model || '',
    mem: pct(mem.percent),
    memTotalBytes: toBytes(mem.total, mem.totalKb),
    memUsedBytes: toBytes(mem.used),
    disk: pct(disk.percent),
    diskTotal: num(disk.total),
    diskUsed: num(disk.used),
    diskFree: num(disk.free),
    parts: Array.isArray(disk.parts) ? disk.parts : [],
    up: num(net.up),
    down: num(net.down),
    upTotal: num(net.upTotal),
    downTotal: num(net.downTotal),
    ioRead: num(io.read),
    ioWrite: num(io.write),
    load,
    hist,
    containers: Array.isArray(s.containers) ? s.containers : [],
    sites: Array.isArray(s.siteList) ? s.siteList : Array.isArray(s.sites) ? s.sites : [],
    error: s.error || '',
    ts: s.ts || Date.now()
  };
}

/* ---------- overview render ---------- */
function render(snap) {
  if (!snap) return;
  const v = snapshotView(snap);
  state.snap = snap;

  $('ssDot').className = 'dot' + (v.online ? (v.mode === 'demo' ? ' warn' : '') : ' off');
  $('ssState').textContent = v.online ? (v.mode === 'demo' ? '演示模式' : '在线') : '离线';
  $('ssMode').textContent = (v.mode || 'demo').toUpperCase();
  $('ssHost').textContent = v.name + (v.host ? ' · ' + v.host : '');
  $('ssPoll').textContent = '每 ' + (state.settings ? state.settings.pollSeconds : 3) + ' 秒刷新';
  $('ssUpdated').textContent = relTime(v.ts);

  const banner = $('offlineBanner');
  if (v.online) banner.classList.remove('show');
  else {
    banner.classList.add('show');
    $('offlineText').textContent = v.error ? '连接中断：' + v.error : '连接中断，正在重试…';
  }

  $('heroLive').className = 'live-pill' + (v.online ? '' : ' off');
  $('heroLive').textContent = v.online ? '运行中' : '已离线';
  $('heroName').textContent = v.name;
  const heroIp = $('heroIp');
  if (heroIp) {
    heroIp.textContent = v.host ? 'IP ' + v.host : '';
    heroIp.classList.toggle('hidden', !v.host);
  }
  $('heroSystem').textContent = v.system;
  $('heroUptime').textContent = v.uptime;
  $('heroVersion').textContent = v.version;
  $('heroSource').textContent = MODE_LABEL[v.mode] || v.mode;

  $('cpuValue').textContent = v.cpu.toFixed(0);
  $('cpuBar').style.width = v.cpu + '%';
  $('cpuSub').textContent = v.cores + ' 核' + (v.cpuModel ? ' · ' + v.cpuModel.slice(0, 22) : '');
  $('cpuLoad').textContent = '负载 ' + num(v.load[0]).toFixed(2);
  setTrend('cpuTrend', v.hist, 'cpu');

  $('memValue').textContent = v.mem.toFixed(0);
  $('memBar').style.width = v.mem + '%';
  $('memSub').textContent = fmtPair(v.memUsedBytes, v.memTotalBytes);
  $('memFree').textContent = '可用 ' + fmtSize(Math.max(0, v.memTotalBytes - v.memUsedBytes));
  setTrend('memTrend', v.hist, 'mem');

  $('diskValue').textContent = v.disk.toFixed(0);
  $('diskBar').style.width = v.disk + '%';
  $('diskSub').textContent = fmtPair(v.diskUsed, v.diskTotal);
  $('diskFree').textContent = '剩余 ' + fmtSize(v.diskFree);
  $('diskTrend').textContent = v.parts.length ? v.parts.length + ' 个分区' : '—';

  $('netUp').textContent = fmtRate(v.up);
  $('netDown').textContent = fmtRate(v.down);
  $('netUpTotal').textContent = '累计 ' + fmtSize(v.upTotal);
  $('netDownTotal').textContent = '累计 ' + fmtSize(v.downTotal);
  $('load1').textContent = num(v.load[0]).toFixed(2);
  $('load5').textContent = num(v.load[1]).toFixed(2);
  $('ioRead').textContent = fmtRate(v.ioRead);
  $('ioWrite').textContent = fmtRate(v.ioWrite);

  const link = Math.max(1, v.up, v.down);
  $('nbUp').style.width = clamp((v.up / link) * 100, 2, 100) + '%';
  $('nbDown').style.width = clamp((v.down / link) * 100, 2, 100) + '%';

  $('dockerSub').textContent = v.containers.length ? v.containers.filter(isRunning).length + ' / ' + v.containers.length + ' 运行中' : 'Docker 运行状态';

  renderDockerMini(v);
  renderSiteMini(v);
  renderMainChart(v);
  renderHeroSpark(v);
  renderMetricSparks(v);
  renderPerformance(v);
  renderContainers(v);
  renderSites(v);
}

function isRunning(c) {
  const s = String(c && (c.status || c.state) || '').toLowerCase();
  return /up|running|healthy|started|active/.test(s) && !/exited|stopped|dead|created/.test(s);
}

function renderDockerMini(v) {
  const box = $('dockerListMini');
  if (!box) return;
  if (!v.containers.length) {
    box.innerHTML = '<div class="empty">没有容器数据 · 配置宝塔 API 或 SSH 后显示</div>';
    return;
  }
  box.innerHTML = v.containers.slice(0, 4).map((c) => {
    const on = isRunning(c);
    return '<div class="row-item"><span class="dot' + (on ? '' : ' off') + '"></span><div class="ri-main"><b>' + esc(c.name || c.container_id || '未命名') + '</b><i>' + esc(c.image || '') + '</i></div><span class="ri-state' + (on ? '' : ' off') + '">' + (on ? '运行' : '停止') + '</span></div>';
  }).join('');
}

function renderSiteMini(v) {
  const box = $('siteListMini');
  if (!box) return;
  if (!v.sites.length) {
    box.innerHTML = '<div class="empty">尚未读取站点 · 宝塔 API 可返回站点列表</div>';
    return;
  }
  box.innerHTML = v.sites.slice(0, 4).map((s) => {
    const name = typeof s === 'string' ? s : (s.name || s.domain || s.siteName || '站点');
    const dom = typeof s === 'string' ? '' : (s.domain || s.path || '');
    return '<div class="row-item"><span class="dot"></span><div class="ri-main"><b>' + esc(name) + '</b><i>' + esc(dom) + '</i></div><span class="ri-state">在线</span></div>';
  }).join('');
}

/* ---------- charts ---------- */
function prepareCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  // 视图隐藏时宽度是 0：这时候画会得到一张 60x30 的位图，等视图显示出来就被拉伸成
  // 一团模糊的色带（切页瞬间的糊影）。隐藏状态下直接跳过，等切到该页再重画。
  if (rect.width < 2 || rect.height < 2) return null;
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function histSeries(v, metric) {
  const hist = v.hist.length ? v.hist : [];
  if (metric === 'cpu') return hist.map((p) => num(p.cpu));
  if (metric === 'mem') return hist.map((p) => num(p.mem));
  return hist.map((p) => (num(p.net) / 1024 / 1024) * 8); // KB/s-ish => ratio
}

function currentMetric(v, metric) {
  if (metric === 'cpu') return v.cpu;
  if (metric === 'mem') return v.mem;
  return (v.up + v.down) / 1024;
}

function drawLineChart(canvas, values, color, opts = {}) {
  if (!canvas) return;
  const prep = prepareCanvas(canvas);
  if (!prep) return;
  const { ctx, w, h } = prep;
  ctx.clearRect(0, 0, w, h);
  if (values.length < 1) values = [0];
  const axis = opts.axis || null;                       // null | 'percent' | 'auto'
  const padLeft = axis ? 34 : 2;
  const padRight = 2, padTop = 8, padBottom = 6;
  const peak = Math.max(...values, 1);
  const softMin = opts.softMin || 0;
  const maxVal = Math.max(opts.max || 0, peak * 1.25, softMin) * 1.06;
  const minVal = 0;
  const yOf = (val) => padTop + (1 - (val - minVal) / (maxVal - minVal)) * (h - padTop - padBottom);
  const pts = values.map((val, i) => {
    const x = padLeft + (i / Math.max(1, values.length - 1)) * (w - padLeft - padRight);
    return [x, yOf(val)];
  });

  // grid + y-axis ticks
  ctx.save();
  ctx.strokeStyle = opts.gridColor || (isLightTheme() ? 'rgba(20,50,90,.10)' : 'rgba(255,255,255,.06)');
  ctx.lineWidth = 1;
  if (axis) {
    const ticks = axis === 'percent'
      ? [{ v: 0, label: '0' }, { v: 50, label: '50' }, { v: 100, label: '100' }]
      : [{ v: 0, label: '0' }, { v: maxVal / 2, label: String(Math.round(maxVal / 2)) }, { v: maxVal, label: String(Math.round(maxVal)) }];
    ctx.fillStyle = isLightTheme() ? 'rgba(60,64,67,.55)' : 'rgba(206,216,238,.66)';
    ctx.font = '10px "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of ticks) {
      const y = clamp(yOf(t.v), padTop, h - padBottom);
      ctx.beginPath(); ctx.moveTo(padLeft - 4, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(t.label, padLeft - 10, clamp(y, padTop + 4, h - padBottom - 4));
    }
  } else {
    for (let i = 1; i <= 3; i++) {
      const y = padTop + (i / 4) * (h - padTop - padBottom);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }
  ctx.restore();

  // area fill
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, hexA(color, 0.34));
  grad.addColorStop(0.6, hexA(color, 0.10));
  grad.addColorStop(1, hexA(color, 0));
  ctx.beginPath();
  ctx.moveTo(pts[0][0], h);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(pts[pts.length - 1][0], h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // glow line
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = hexA(color, isLightTheme() ? 0.45 : 0.85);
  ctx.shadowBlur = isLightTheme() ? Math.min(5, opts.glow || 5) : (opts.glow || 14);
  ctx.strokeStyle = color;
  ctx.lineWidth = opts.width || 2;
  ctx.beginPath();
  pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.stroke();
  ctx.restore();

  // endpoint
  const [lx, ly] = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(lx, ly, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = isLightTheme() ? '#12304e' : '#fff';
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function hexA(hex, a) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return 'rgba(120,215,255,' + a + ')';
  return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
}

/* 只有 1 个采样点时画一条平线，避免首屏图表空白 */
function padSeries(vals, n = 40) {
  if (Array.isArray(vals) && vals.length === 1) return new Array(n).fill(vals[0]);
  return vals;
}

function renderMainChart(v) {
  const metric = state.chartMetric;
  const vals = padSeries(histSeries(v, metric));
  const color = paintTint(metric === 'mem' ? '#c0aaff' : metric === 'net' ? '#5ef0c0' : accentForChart());
  drawLineChart($('mainChart'), vals, color, { max: metric === 'net' ? 0 : 100, softMin: metric === 'net' ? 8 : 28, axis: metric === 'net' ? 'auto' : 'percent' });

  const cur = currentMetric(v, metric);
  const suffix = metric === 'net' ? ' KB/s' : '%';
  $('chartNow').textContent = cur.toFixed(metric === 'net' ? 1 : 0) + suffix;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  $('chartAvg').textContent = avg.toFixed(metric === 'net' ? 1 : 0) + suffix;
  $('chartMax').textContent = (vals.length ? Math.max(...vals) : 0).toFixed(metric === 'net' ? 1 : 0) + suffix;
}

function renderHeroSpark(v) {
  const vals = padSeries(v.hist.map((p) => num(p.cpu)), 24);
  return drawLineChart($('heroSpark'), vals.length ? vals : [v.cpu], paintTint(accentForChart()), { max: 100, softMin: 26, glow: 8, width: 1.6 });
}

/* 三张指标卡里的迷你曲线：数据不够时退回当前值，保证不空白 */
function renderMetricSparks(v) {
  const hist = Array.isArray(v.hist) ? v.hist : [];
  const hasKey = (key) => hist.some((p) => p[key] !== undefined);
  const series = (key, fallback) => {
    if (!hist.length || !hasKey(key)) return padSeries([fallback], 24);
    return padSeries(hist.map((p) => num(p[key])), 24);
  };
  const colors = { cpu: accentForChart(), mem: '#a98bff', disk: '#3fc79a' };
  [['cpu', v.cpu], ['mem', v.mem], ['disk', v.disk]].forEach(([key, cur]) => {
    const cv = $(key + 'Spark');
    if (!cv) return;
    drawLineChart(cv, series(key, cur), paintTint(colors[key]), { max: 100, softMin: 18, glow: 5, width: 1.3 });
  });
}

function renderPerformance(v) {
  const metric = state.perfMetric;
  const vals = padSeries(histSeries(v, metric));
  const color = paintTint(metric === 'mem' ? '#c0aaff' : metric === 'net' ? '#5ef0c0' : accentForChart());
  drawLineChart($('perfChart'), vals, color, { max: metric === 'net' ? 0 : 100, softMin: metric === 'net' ? 8 : 28, axis: metric === 'net' ? 'auto' : 'percent' });

  $('pLoad1').textContent = num(v.load[0]).toFixed(2);
  $('pLoad5').textContent = num(v.load[1]).toFixed(2);
  $('pLoad15').textContent = num(v.load[2]).toFixed(2);
  const loadPct = clamp((num(v.load[0]) / Math.max(1, v.cores)) * 100, 0, 100);
  $('loadBar').style.width = loadPct + '%';
  $('loadHint').textContent = loadPct > 85 ? '负载偏高，注意排查高占用进程' : loadPct > 60 ? '负载中等，系统仍有余量' : '负载处于安全范围';

  $('pIoRead').textContent = fmtSize(v.ioRead).replace(/ (B|KB|MB|GB|TB)/, '');
  $('pIoWrite').textContent = fmtSize(v.ioWrite).replace(/ (B|KB|MB|GB|TB)/, '');
  const ioMax = Math.max(1, v.ioRead, v.ioWrite);
  $('ioBarR').style.width = clamp((v.ioRead / ioMax) * 100, 3, 100) + '%';
  $('ioBarW').style.width = clamp((v.ioWrite / ioMax) * 100, 3, 100) + '%';
  $('pSystem').textContent = v.system;
  $('pCores').textContent = v.cores + ' 核';
  $('pVersion').textContent = v.version;
  $('pSource').textContent = MODE_LABEL[v.mode] || v.mode;

  const parts = v.parts.length ? v.parts : (v.disk ? [{ path: '/', percent: v.disk, used: v.diskUsed, total: v.diskTotal }] : []);
  $('diskParts').innerHTML = parts.slice(0, 4).map((p) => {
    const pctv = pct(p.percent ?? (num(p.used) / Math.max(1, num(p.total)) * 100));
    return '<div class="part"><div class="pt"><span>' + esc(p.path || p.mount || '/') + '</span><span>' + pctv.toFixed(0) + '% · ' + fmtSize(p.used) + ' / ' + fmtSize(p.total) + '</span></div><div class="pb"><i style="width:' + pctv + '%"></i></div></div>';
  }).join('') || '<div class="empty">暂无分区数据</div>';
}

/* ---------- containers / sites views ---------- */
function renderContainers(v) {
  const box = $('containerTable');
  if (!box) return;
  if (!v.containers.length) {
    box.innerHTML = '<div class="empty">还没有容器数据。宝塔 API 模式会从面板读取 Docker 容器列表。</div>';
    return;
  }
  box.innerHTML = v.containers.map((c) => {
    const on = isRunning(c);
    const name = c.name || c.container_id || '未命名';
    const status = c.status || (on ? 'Up' : 'Exited');
    return '<div class="table-row"><span class="state-pill' + (on ? '' : ' off') + '"><i></i>' + (on ? '运行中' : '已停止') + '</span><span class="cname" title="' + esc(name) + '">' + esc(name) + '</span><span class="cimage" title="' + esc(c.image || '') + '">' + esc(c.image || '—') + '</span><span class="row-action" title="' + esc(status) + '">' + esc(String(status).slice(0, 18)) + '</span></div>';
  }).join('');
}

function renderSites(v) {
  const box = $('siteGrid');
  if (!box) return;
  if (!v.sites.length) {
    box.innerHTML = '<div class="empty" style="grid-column:span 3">暂无站点数据。宝塔 API 模式下会读取站点列表。</div>';
    return;
  }
  box.innerHTML = v.sites.map((s) => {
    const name = typeof s === 'string' ? s : (s.name || s.domain || s.siteName || '站点');
    const dom = typeof s === 'string' ? s : (s.domain || s.path || '');
    return '<article class="glass site-card"><div class="sc-top"><span class="sc-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span><span class="state-pill"><i></i>在线</span></div><h3>' + esc(name) + '</h3><p>' + esc(dom || '运行中') + '</p><div class="sc-foot"><span>HTTPS</span><b>正常</b></div></article>';
  }).join('');
}

/* ---------- terminal ---------- */
function setTermStatus(text, cls) {
  const s = $('termStatus');
  if (!s) return;
  s.className = 'term-status ' + (cls || '');
  s.innerHTML = '<i></i>' + text;
}

function ensureTerm() {
  if (state.termReady) return;
  if (typeof Terminal !== 'function' || typeof FitAddon === 'undefined') {
    setTimeout(ensureTerm, 200);
    return;
  }
  try {
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Microsoft YaHei Mono", monospace',
      lineHeight: 1.35,
      letterSpacing: 0,
      scrollback: 4000,
      convertEol: true,
      allowTransparency: true,
      theme: {
        background: 'rgba(0,0,0,0)',
        foreground: '#dbe9ff',
        cursor: '#9fe3ff',
        cursorAccent: '#04121f',
        selectionBackground: 'rgba(120,215,255,.25)',
        black: '#0b1220', red: '#ff8093', green: '#5ef0c0', yellow: '#ffcf6b',
        blue: '#78d7ff', magenta: '#c0aaff', cyan: '#7cf0e0', white: '#e8f2ff',
        brightBlack: '#5b6f8c', brightRed: '#ffa2ae', brightGreen: '#8bffdb', brightYellow: '#ffe0a0',
        brightBlue: '#a3e5ff', brightMagenta: '#d8c9ff', brightCyan: '#a9fff2', brightWhite: '#ffffff'
      }
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open($('termBody'));
    state.term = term;
    state.fit = fit;
    state.termReady = true;
    term.writeln('\x1b[38;2;160;220;255m' + state.appName + '终端\x1b[0m  \x1b[38;2;130;160;195m' + (state.appSubtitle ? state.appSubtitle + ' Terminal' : 'Terminal') + '\x1b[0m');
    term.writeln('\x1b[38;2;120;150;180m──────────────────────────────────────────────\x1b[0m');
    term.onData(onTermData);
    setTimeout(fitTerm, 80);
    window.addEventListener('resize', () => fitTerm());
    setTermStatus('未连接', '');
  } catch (e) {
    console.error(e);
    setTermStatus('终端初始化失败', 'err');
  }
}

function fitTerm() {
  if (!state.fit || !state.term) return;
  try {
    const dims = state.fit.proposeDimensions();
    if (!dims || !dims.cols || !dims.rows) return;
    state.fit.fit();
    if (state.termMode === 'ssh') window.sentinel.terminal.resize(dims.cols, dims.rows);
  } catch {}
}

function onTermData(data) {
  if (state.termMode === 'demo') { demoScreenKey(data); return; }
  if (state.termMode === 'ssh') window.sentinel.terminal.input(data);
}

function printDemo(text) {
  if (!state.term) return;
  state.term.write(String(text).replace(/\r?\n/g, '\r\n'));
}

function demoPrompt() {
  return '\r\n\x1b[38;2;110;240;200mdemo@server\x1b[0m:\x1b[38;2;140;200;255m' + state.demoShell.cwd + '\x1b[0m$ ';
}

function demoScreenKey(data) {
  const shell = state.demoShell;
  if (data === '\r') {
    const line = shell.buffer;
    shell.buffer = '';
    printDemo(demoPrompt());
    demoExec(line.trim());
    if (state.termMode === 'demo') printDemo('\x1b[0m');
    return;
  }
  if (data === '\u007f') {
    if (shell.buffer.length) { shell.buffer = shell.buffer.slice(0, -1); state.term.write('\b \b'); }
    return;
  }
  if (data === '\u0003') {
    shell.buffer = '';
    printDemo('^C');
    printDemo(demoPrompt());
    return;
  }
  if (data === '\t') return;
  if (data.length && data >= ' ' && data !== '\u001b') {
    shell.buffer += data;
    state.term.write(data);
  }
}

function demoExec(cmd) {
  const shell = state.demoShell;
  if (!cmd) return;
  const parts = cmd.split(/\s+/);
  const c = parts[0];
  const out = [];
  if (c === 'help') {
    out.push('可用演示命令：');
    out.push('  \x1b[38;2;120;215;255mls\x1b[0m  \x1b[38;2;120;215;255mcat /etc/os-release\x1b[0m  \x1b[38;2;120;215;255mdf -h\x1b[0m  \x1b[38;2;120;215;255mfree -h\x1b[0m  \x1b[38;2;120;215;255muptime\x1b[0m');
    out.push('  \x1b[38;2;120;215;255mdocker ps\x1b[0m  \x1b[38;2;120;215;255mneofetch\x1b[0m  \x1b[38;2;120;215;255mopening\x1b[0m  \x1b[38;2;120;215;255mclear\x1b[0m');
    out.push('  \x1b[38;2;120;150;180m提示：配置 SSH 后可执行真实命令。\x1b[0m');
  } else if (c === 'ls') {
    out.push('\x1b[38;2;120;215;255mbin\x1b[0m  \x1b[38;2;120;215;255metc\x1b[0m  \x1b[38;2;120;215;255mhome\x1b[0m  \x1b[38;2;120;215;255mopt\x1b[0m  \x1b[38;2;120;215;255mroot\x1b[0m  \x1b[38;2;120;215;255msrv\x1b[0m  \x1b[38;2;120;215;255mtmp\x1b[0m  \x1b[38;2;120;215;255mvar\x1b[0m');
  } else if (c === 'pwd') {
    out.push('/root');
  } else if (c === 'whoami') {
    out.push('root');
  } else if (c === 'uname') {
    out.push('Linux demo-server 6.6.0-28-generic #29-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux');
  } else if (c === 'cat' && /os-release/.test(cmd)) {
    out.push('PRETTY_NAME="Debian GNU/Linux 13 (trixie)"');
    out.push('NAME="Debian GNU/Linux"');
    out.push('VERSION_ID="13"');
    out.push('ID=debian');
  } else if (c === 'df') {
    out.push('Filesystem      Size  Used Avail Use% Mounted on');
    out.push('/dev/vda1        60G   18G   42G  30% /');
    out.push('tmpfs           3.9G   23M  3.9G   1% /run');
    out.push('/dev/vdb1       200G   27G  173G  14% /www');
  } else if (c === 'free') {
    out.push('               total        used        free      shared  buff/cache   available');
    out.push('Mem:           3.9Gi       1.6Gi       216Mi        52Mi       2.1Gi       2.2Gi');
    out.push('Swap:          2.0Gi          0B       2.0Gi');
  } else if (c === 'uptime') {
    out.push(' 14:22:07 up 12 days,  4:18,  1 user,  load average: 0.42, 0.38, 0.35');
  } else if (c === 'docker') {
    out.push('CONTAINER ID   IMAGE                         STATUS          NAMES');
    out.push('a1b2c3d4e5f6   astrbot/astrbot:latest        Up 12 days      astrbot_jdfy-astrbot_jdfY-1');
    out.push('f6e5d4c3b2a1   mysql:8.0                     Up 12 days      mysql');
    out.push('9c8b7a6f5e4d   redis:7-alpine                Up 12 days      redis');
    out.push('4d3c2b1a0f9e   containrrr/watchtower:latest  Up 12 days      watchtower');
  } else if (c === 'neofetch') {
    out.push('\x1b[38;2;120;215;255m       .---.      \x1b[0m  \x1b[1mdemo@server\x1b[0m');
    out.push('\x1b[38;2;120;215;255m      /     \\     \x1b[0m  ----------------');
    out.push('\x1b[38;2;120;215;255m     | () () |    \x1b[0m  OS: Debian GNU/Linux 13');
    out.push('\x1b[38;2;120;215;255m      \\  ^  /     \x1b[0m  Host: Cloud VPS');
    out.push('\x1b[38;2;120;215;255m       \'---\'      \x1b[0m  Shell: bash 5.2.21');
    out.push('                   CPU: 2 vCPU');
    out.push('                   Memory: 1.6Gi / 3.9Gi');
  } else if (c === 'clear') {
    state.term.clear();
    return;
  } else if (c === 'sudo' || c === 'su') {
    out.push('\x1b[38;2;255;160;120m演示模式已是 root 身份。\x1b[0m');
  } else {
    out.push('bash: ' + c + ': command not found  \x1b[38;2;120;150;180m（演示模式，输入 help 查看可用命令）\x1b[0m');
  }
  out.forEach((line) => printDemo(line));
}

async function connectTerminal() {
  ensureTerm();
  if (!state.termReady) { toast('终端尚未就绪'); return; }
  setTermStatus('正在连接…', '');
  const dims = state.fit ? state.fit.proposeDimensions() : { cols: 120, rows: 32 };
  const res = await window.sentinel.terminal.connect({ cols: dims && dims.cols, rows: dims && dims.rows });
  if (res && res.ok && res.mode === 'demo') {
    state.termMode = 'demo';
    state.demoShell.active = true;
    $('termEmpty').classList.add('hidden');
    $('termConnect').classList.add('hidden');
    $('termDisconnect').classList.remove('hidden');
    $('termTitle').textContent = 'demo@server — demo';
    setTermStatus('演示 Shell', 'on');
    printDemo('\r\n\x1b[38;2;255;207;107m演示模式：本地模拟 Shell，不连接真实服务器。\x1b[0m');
    printDemo(demoPrompt());
    state.term.focus();
    return;
  }
  if (res && res.ok && res.mode === 'ssh') {
    state.termMode = 'ssh';
    $('termEmpty').classList.add('hidden');
    $('termConnect').classList.add('hidden');
    $('termDisconnect').classList.remove('hidden');
    $('termTitle').textContent = (state.settings && state.settings.ssh.username ? state.settings.ssh.username : 'root') + '@' + (state.settings && state.settings.ssh.host || 'server') + ' — ssh';
    setTermStatus('SSH 已连接', 'on');
    state.term.focus();
    setTimeout(fitTerm, 120);
    return;
  }
  setTermStatus('连接失败', 'err');
  $('termEmpty').classList.remove('hidden');
  $('termEmptyText').textContent = (res && res.message) || 'SSH 连接失败，请在设置中检查主机、端口与密码。';
  toast((res && res.message) || '终端连接失败', 'err');
}

function disconnectTerminal() {
  window.sentinel.terminal.disconnect();
  state.termMode = 'idle';
  $('termEmpty').classList.remove('hidden');
  $('termConnect').classList.remove('hidden');
  $('termDisconnect').classList.add('hidden');
  setTermStatus('未连接', '');
  if (state.term) {
    printDemo('\r\n\x1b[38;2;255;160;175m连接已断开。\x1b[0m');
  }
}

/* ---------- settings ---------- */
function syncAppControls() {
  const setSeg = (id, attr, value) => {
    const row = $(id);
    if (!row) return;
    els('button', row).forEach((b) => b.classList.toggle('active', b.dataset[attr] === value));
  };
  if ($('appName')) $('appName').value = state.appName;
  if ($('appSubtitle')) $('appSubtitle').value = state.appSubtitle;
  setSeg('widgetSizeSeg', 'size', state.widgetSize);
  setSeg('startupSeg', 'startup', state.startup);
  setSeg('widgetStartSeg', 'wstart', state.widgetAutostart ? 'auto' : 'manual');
  els('input[name="closeAction"]').forEach((r) => {
    r.checked = r.value === (state.closeAction === 'quit' ? 'quit' : 'tray');
  });
  if ($('showWidget')) $('showWidget').checked = state.showWidget;
  if ($('closeNotify')) $('closeNotify').checked = state.closeNotify;
  if ($('closeTip')) $('closeTip').value = state.closeTip;
  if ($('closeTipText')) $('closeTipText').value = state.closeTipText;
  if ($('closeTipSilent')) $('closeTipSilent').checked = state.closeTipSilent;
  updateSegIndicators();
}

function collectAppPatch() {
  return {
    appName: state.appName,
    appSubtitle: state.appSubtitle,
    startup: state.startup,
    showWidget: state.showWidget,
    widgetAutostart: state.widgetAutostart,
    widgetSize: state.widgetSize,
    closeAction: state.closeAction,
    closeNotify: state.closeNotify,
    closeTip: state.closeTip,
    closeTipText: state.closeTipText,
    closeTipSilent: state.closeTipSilent
  };
}

function persistApp() {
  clearTimeout(persistApp._t);
  persistApp._t = setTimeout(() => {
    window.sentinel.saveSettings({ ui: collectAppPatch() }).then((res) => {
      if (res && res.settings) state.settings = res.settings;
    }).catch(() => {});
  }, 220);
}

function fillSettings(s) {
  if (!s) return;
  state.settings = s;
  els('#modeGrid .mode-card').forEach((b) => b.classList.toggle('active', b.dataset.mode === s.mode));
  $('btUrl').value = (s.bt && s.bt.baseUrl) || '';
  $('btKey').value = '';
  $('btKey').placeholder = (s.bt && (s.bt.hasApiKey || s.bt.hasKey)) ? '已保存（留空保持不变）' : '留空则保持不变';
  $('btSelfSigned').checked = !s.bt || s.bt.allowSelfSigned !== false;
  $('sshHost').value = (s.ssh && s.ssh.host) || '';
  $('sshPort').value = (s.ssh && s.ssh.port) || 22;
  $('sshUser').value = (s.ssh && s.ssh.username) || 'root';
  $('sshPass').value = '';
  $('sshPass').placeholder = (s.ssh && s.ssh.hasPassword) ? '已保存（留空保持不变）' : '留空则保持不变';
  $('sshKeyPath').value = (s.ssh && s.ssh.privateKeyPath) || '';
  $('displayName').value = s.displayName === 'my-server' ? '' : (s.displayName || '');
  $('pollSeconds').value = s.pollSeconds || 3;
  $('alwaysOnTop').checked = !s.ui || s.ui.alwaysOnTop !== false;
  applyAccent((s.ui && s.ui.accent) || '#1a73e8');
  applyTheme(s.ui && s.ui.theme);
  applyAppearance((s.ui && s.ui.appearance) || 'system');
  applyLanguage((s.ui && s.ui.language) || 'zh');
  applyDisplay(s.ui || {});
  const ui = s.ui || {};
  applyAppName(ui.appName, ui.appSubtitle);
  state.startup = ui.startup === 'dashboard' || ui.startup === 'widget' ? ui.startup : 'both';
  state.showWidget = ui.showWidget !== false;
  state.widgetAutostart = ui.widgetAutostart !== false;
  state.widgetSize = ui.widgetSize === 'mini' ? 'mini' : 'normal';
  state.closeAction = ['tray', 'quit', 'ask'].indexOf(ui.closeAction) >= 0 ? ui.closeAction : 'tray';
  state.closeNotify = ui.closeNotify !== false;
  state.closeTip = ['tray', 'widget', 'quit', 'custom'].indexOf(ui.closeTip) >= 0 ? ui.closeTip : 'tray';
  state.closeTipText = ui.closeTipText || '';
  state.closeTipSilent = ui.closeTipSilent === true;
  syncAppControls();
  const btReady = !!(s.bt && (s.bt.hasApiKey || s.bt.hasKey));
  $('btBadge').textContent = btReady ? '已配置' : '未配置';
  $('btBadge').className = 'cfg-badge' + (btReady ? ' ok' : '');
  $('sshBadge').textContent = s.ssh && s.ssh.host && (s.ssh.hasPassword || s.ssh.privateKeyPath) ? '已配置' : '未配置';
  $('sshBadge').className = 'cfg-badge' + (s.ssh && s.ssh.host && (s.ssh.hasPassword || s.ssh.privateKeyPath) ? ' ok' : '');
  const panelVisible = s.mode === 'bt';
  $('btPanel').classList.toggle('hidden', !panelVisible);
  $('sshPanel').classList.toggle('hidden', false);
}

function collectSettings() {
  const patch = {
    mode: (el('#modeGrid .mode-card.active') || {}).dataset ? el('#modeGrid .mode-card.active').dataset.mode : 'demo',
    displayName: $('displayName').value.trim(),
    pollSeconds: clamp(Number($('pollSeconds').value) || 3, 1, 30),
    bt: {
      baseUrl: $('btUrl').value.trim(),
      apiKey: $('btKey').value ? $('btKey').value : '__KEEP__',
      allowSelfSigned: $('btSelfSigned').checked
    },
    ssh: {
      host: $('sshHost').value.trim(),
      port: clamp(Number($('sshPort').value) || 22, 1, 65535),
      username: $('sshUser').value.trim() || 'root',
      password: $('sshPass').value ? $('sshPass').value : '__KEEP__',
      privateKeyPath: $('sshKeyPath').value.trim()
    },
    ui: Object.assign({
      accent: state.accent,
      theme: state.theme,
      appearance: state.appearance,
      language: state.language,
      showIp: $('showIp') ? $('showIp').checked : state.showIp,
      showDomain: $('showDomain') ? $('showDomain').checked : state.showDomain,
      alwaysOnTop: $('alwaysOnTop').checked
    }, collectAppPatch(), {
      appName: $('appName') ? $('appName').value.trim() : state.appName,
      appSubtitle: $('appSubtitle') ? $('appSubtitle').value.trim() : state.appSubtitle
    })
  };
  return patch;
}

async function saveSettings(silent) {
  const patch = collectSettings();
  try {
    const res = await window.sentinel.saveSettings(patch);
    if (res && res.settings) fillSettings(res.settings);
    state.settings = res.settings || state.settings;
    applyAccent(state.accent);
    if (!silent) toast('设置已保存');
    window.sentinel.refresh();
    return true;
  } catch (e) {
    toast('保存失败：' + (e.message || e), 'err');
    return false;
  }
}

async function testBt() {
  const out = $('btTestResult');
  out.className = 'test-result';
  out.textContent = '正在测试…';
  try {
    const res = await window.sentinel.testBt({
      baseUrl: $('btUrl').value.trim(),
      apiKey: $('btKey').value || '__KEEP__',
      allowSelfSigned: $('btSelfSigned').checked
    });
    if (res && res.ok) {
      out.className = 'test-result ok';
      out.textContent = '✓ 连接成功 · ' + (res.system || '') + ' · 宝塔 ' + (res.version || '') + ' · ' + (res.cpuNum || '?') + ' 核';
    } else {
      out.className = 'test-result err';
      out.textContent = '连接失败：' + ((res && res.message) || '未知错误');
    }
  } catch (e) {
    out.className = 'test-result err';
    out.textContent = '连接失败：' + (e.message || e);
  }
}

async function testSsh() {
  const out = $('sshTestResult');
  out.className = 'test-result';
  out.textContent = '正在测试…';
  await saveSettings(true);
  try {
    const res = await window.sentinel.testSsh();
    out.className = 'test-result ok';
    out.textContent = '✓ SSH 连接成功 · ' + ((res && res.system) || '');
  } catch (e) {
    out.className = 'test-result err';
    out.textContent = 'SSH 失败：' + (e.message || e);
  }
}

/* ---------- wiring ---------- */
function wireEvents() {
  els('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  els('[data-nav]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.nav)));

  $('refreshBtn').addEventListener('click', async () => {
    const btn = $('refreshBtn');
    btn.classList.add('spin');
    await window.sentinel.refresh();
    setTimeout(() => btn.classList.remove('spin'), 700);
  });
  $('refreshBtn2').addEventListener('click', async () => { await window.sentinel.refresh(); toast('已刷新'); });
  $('ssRefresh').addEventListener('click', async () => { await window.sentinel.refresh(); toast('已刷新'); });

  $('minBtn').addEventListener('click', () => window.sentinel.window.minimize());
  $('maxBtn').addEventListener('click', () => window.sentinel.window.maximize());
  $('closeBtn').addEventListener('click', () => window.sentinel.window.closeDashboard());

  // app & window behavior controls
  const bindSeg = (id, attr, key) => {
    const row = $(id);
    if (!row) return;
    row.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-' + attr + ']');
      if (!b) return;
      state[key] = b.dataset[attr];
      syncAppControls();
      persistApp();
    });
  };
  bindSeg('widgetSizeSeg', 'size', 'widgetSize');
  bindSeg('startupSeg', 'startup', 'startup');
  // 小窗是否随软件启动（下一次启动生效，不影响当前窗口）
  const ws = $('widgetStartSeg');
  if (ws) ws.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-wstart]');
    if (!b) return;
    state.widgetAutostart = b.dataset.wstart !== 'manual';
    syncAppControls();
    persistApp();
  });
  // 关闭主界面时：最小化到托盘 / 退出程序
  els('input[name="closeAction"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    state.closeAction = r.value === 'quit' ? 'quit' : 'tray';
    persistApp();
  }));
  const renameBtn = $('heroRename');
  if (renameBtn) renameBtn.addEventListener('click', beginHeroRename);
  const heroNameEl = $('heroName');
  if (heroNameEl) heroNameEl.addEventListener('dblclick', beginHeroRename);
  const an = $('appName');
  if (an) {
    an.addEventListener('input', (e) => { applyAppName(e.target.value); persistApp(); });
    an.addEventListener('change', () => {
      state.appName = String(an.value || '').trim();
      applyAppName(state.appName);
      persistApp();
    });
  }
  const sub = $('appSubtitle');
  if (sub) {
    sub.addEventListener('input', (e) => applyAppName(state.appName, e.target.value));
    sub.addEventListener('change', (e) => {
      state.appSubtitle = String(e.target.value || '').trim();
      e.target.value = state.appSubtitle;
      applyAppName(state.appName, state.appSubtitle);
      persistApp();
    });
  }
  const sw = $('showWidget');
  if (sw) sw.addEventListener('change', () => {
    state.showWidget = sw.checked;
    window.sentinel.window.setWidgetVisible(state.showWidget);
    persistApp();
  });
  const cn = $('closeNotify');
  if (cn) cn.addEventListener('change', () => { state.closeNotify = cn.checked; persistApp(); });
  const ct = $('closeTip');
  if (ct) ct.addEventListener('change', () => { state.closeTip = ct.value; persistApp(); });
  const ctt = $('closeTipText');
  if (ctt) ctt.addEventListener('input', () => { state.closeTipText = ctt.value; persistApp(); });
  const cts = $('closeTipSilent');
  if (cts) cts.addEventListener('change', () => { state.closeTipSilent = cts.checked; persistApp(); });
  const pv = $('previewTip');
  if (pv) pv.addEventListener('click', async () => {
    const tip = state.closeTip === 'custom' ? (state.closeTipText || '') : null;
    await window.sentinel.previewTip(tip || undefined);
    toast('已发送提醒预览');
  });
  const q2 = $('quitBtn2');
  if (q2) q2.addEventListener('click', () => window.sentinel.quit());
  $('openPanelBtn').addEventListener('click', () => window.sentinel.openPanel());
  $('qPanel').addEventListener('click', () => window.sentinel.openPanel());
  $('qTerminal').addEventListener('click', () => switchView('terminal'));
  $('qRefresh').addEventListener('click', async () => { await window.sentinel.refresh(); toast('已刷新'); });
  $('fixConnBtn').addEventListener('click', () => switchView('settings'));

  $('chartSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.chartMetric = b.dataset.metric;
    els('#chartSeg button').forEach((x) => x.classList.toggle('active', x === b));
    if (state.snap) renderMainChart(snapshotView(state.snap));
  });
  $('perfSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.perfMetric = b.dataset.metric;
    els('#perfSeg button').forEach((x) => x.classList.toggle('active', x === b));
    if (state.snap) renderPerformance(snapshotView(state.snap));
  });

  $('dockerRefresh').addEventListener('click', async () => { await window.sentinel.refresh(); toast('容器状态已刷新'); });
  const panelUrl = (p) => {
    const s = state.settings || {};
    const base = String((s.bt && s.bt.baseUrl) || '').replace(/\/+$/, '');
    return base ? base + p : '';
  };
  const openPanelPage = (p) => { const u = panelUrl(p); if (u) window.sentinel.openExternal(u); else toast('请先在设置里填写宝塔面板地址'); };
  $('dockerOpenPanel').addEventListener('click', () => openPanelPage('/docker'));
  $('sitesOpenPanel').addEventListener('click', () => openPanelPage('/site'));

  $('termConnect').addEventListener('click', connectTerminal);
  $('teConnect').addEventListener('click', connectTerminal);
  $('termDisconnect').addEventListener('click', disconnectTerminal);
  $('termOpenPanel').addEventListener('click', () => window.sentinel.openPanel());
  $('tePanel').addEventListener('click', () => window.sentinel.openPanel());
  $('termClear').addEventListener('click', () => { if (state.term) state.term.clear(); });
  $('termCopy').addEventListener('click', async () => {
    const sel = state.term ? state.term.getSelection() : '';
    if (!sel) { toast('先选中终端文本'); return; }
    try { await navigator.clipboard.writeText(sel); toast('已复制'); } catch { toast('复制失败', 'err'); }
  });

  els('#modeGrid .mode-card').forEach((b) => b.addEventListener('click', () => {
    els('#modeGrid .mode-card').forEach((x) => x.classList.toggle('active', x === b));
    $('btPanel').classList.toggle('hidden', b.dataset.mode !== 'bt');
  }));
  $('btTest').addEventListener('click', testBt);
  $('sshTest').addEventListener('click', testSsh);
  $('saveSettings').addEventListener('click', () => saveSettings(false));
  $('saveSettings2').addEventListener('click', () => saveSettings(false));
  els('#themeGrid .theme-card').forEach((b) => b.addEventListener('click', () => {
    applyTheme(b.dataset.theme);
    persistLook();
  }));
  const gp = $('glassWpPick');
  if (gp) gp.addEventListener('click', async () => {
    try {
      const r = await window.sentinel.wallpaper.pickGlass();
      if (!r || r.canceled || !r.url) return;
      state.glassWallpaper = { path: r.path, url: r.url, thumb: r.thumb };
      applyThemeBackdrop();
      scheduleAdaptiveTint();
      toast('玻璃壁纸已更新');
    } catch (e) { toast('选择壁纸失败：' + (e.message || e), 'err'); }
  });
  const gr = $('glassWpReset');
  if (gr) gr.addEventListener('click', async () => {
    try {
      await window.sentinel.wallpaper.clearGlass();
      state.glassWallpaper = null;
      applyThemeBackdrop();
      scheduleAdaptiveTint();
      toast('已恢复跟随桌面壁纸');
    } catch (e) { toast('操作失败：' + (e.message || e), 'err'); }
  });
  els('#accentRow button').forEach((b) => b.addEventListener('click', () => {
    pixelAccentSeed = true;
    applyAccent(b.dataset.accent);
    persistLook();
  }));
  els('#appearanceSeg button').forEach((b) => b.addEventListener('click', () => { applyAppearance(b.dataset.appearance); persistLook(); }));
  const langToggle = $('langToggle');
  if (langToggle) langToggle.addEventListener('click', () => setLangOpen($('langBody').hidden));
  const langRow = $('langSeg');
  if (langRow) langRow.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (!b) return;
    applyLanguage(b.dataset.lang);
    persistLook();
    toast(state.language === 'cat' ? '切成猫猫语啦喵~ 🐾' : '已切回简体中文');
  });
  const custom = $('accentCustom');
  if (custom) custom.addEventListener('input', (e) => {
    pixelAccentSeed = true;
    applyAccent(e.target.value);
    els('#accentRow button').forEach((b) => b.classList.remove('active'));
    custom.classList.add('is-active');
    persistLook();
  });
  const si = $('showIp');
  if (si) si.addEventListener('change', () => { applyDisplay({ showIp: si.checked, showDomain: state.showDomain }); persistLook(); });
  const sd = $('showDomain');
  if (sd) sd.addEventListener('change', () => { applyDisplay({ showIp: state.showIp, showDomain: sd.checked }); persistLook(); });
  $('btDocs').addEventListener('click', (e) => { e.preventDefault(); window.sentinel.openExternal('https://docs.bt.cn/api'); });
  $('quitBtn').addEventListener('click', () => window.sentinel.quit());

  // maximize icon/state
  window.sentinel.onWindowState(({ maximized }) => {
    $('maxBtn').title = maximized ? '还原' : '最大化';
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5') { e.preventDefault(); window.sentinel.refresh(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); window.sentinel.window.hideDashboard(); }
  });
}

/* ---------- boot ---------- */
function startClock() {
  const tick = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    $('tbClock').textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    if (state.settings) $('ssUpdated').textContent = state.snap ? relTime(state.snap.ts) : '—';
  };
  tick();
  setInterval(tick, 1000);
}

async function boot() {
  initPointerGlow();
  initScrollFastPath();
  wireEvents();
  startClock();
  initSegIndicators();
  const navRail = document.getElementById('navRail');
  if (navRail) {
    requestAnimationFrame(() => { syncNavPill(); document.body.classList.add('nav-ready'); });
    if (window.ResizeObserver) new ResizeObserver(() => syncNavPill()).observe(navRail);
    window.addEventListener('resize', syncNavPill);
  }

  try {
    const boot = await window.sentinel.bootstrap();
    if (boot) {
      fillSettings(boot.settings);
      $('aboutVersion').textContent = boot.appVersion || '1.0.0';
      $('aboutElectron').textContent = boot.electron || '—';
      if ($('aboutStorage')) $('aboutStorage').textContent = (boot.storage && boot.storage.label) || '—';
      state.sysWallpaper = (boot.wallpaper && boot.wallpaper.url) ? boot.wallpaper : { path: '', url: '', thumb: '' };
      state.wallpaper = state.sysWallpaper;
      state.glassWallpaper = boot.glassWallpaper || null;
      applyThemeBackdrop();
    }
  } catch (e) { console.error('bootstrap failed', e); }

  window.sentinel.onStats((snap) => {
    state.pendingSnap = snap;
    if (document.hidden) return;
    try { render(snap); } catch (e) { console.error(e); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.pendingSnap) return;
    try { render(state.pendingSnap); } catch (e) { console.error(e); }
    if (state.snap) { try { renderMainChart(state.snap); renderPerformance(state.snap); } catch (e) {} }
  });
  window.sentinel.onSettings((s) => {
    if (!s) return;
    const prev = state.settings || {};
    state.settings = Object.assign({}, prev, s, { ui: Object.assign({}, prev.ui || {}, s.ui || {}) });
    const ui = s.ui || {};
    applyTheme(ui.theme);
    applyAppearance(ui.appearance || 'system');
    applyLanguage(ui.language || 'zh');
    applyDisplay(ui);
    if (Object.prototype.hasOwnProperty.call(ui, 'glassWallpaper')) {
      window.sentinel.wallpaper.get().then((wp) => {
        if (!wp) return;
        state.glassWallpaper = wp.glass || null;
        applyThemeBackdrop();
        scheduleAdaptiveTint();
      }).catch(() => {});
    }
    if (ui.appName || ui.appSubtitle !== undefined) applyAppName(ui.appName, ui.appSubtitle);
    if (ui.accent) applyAccent(ui.accent);
    state.startup = ui.startup || 'both';
    state.showWidget = ui.showWidget !== false;
    state.widgetAutostart = ui.widgetAutostart !== false;
    state.widgetSize = ui.widgetSize === 'mini' ? 'mini' : 'normal';
    state.closeAction = ['tray', 'quit', 'ask'].indexOf(ui.closeAction) >= 0 ? ui.closeAction : 'tray';
    state.closeNotify = ui.closeNotify !== false;
    state.closeTip = ui.closeTip || 'tray';
    state.closeTipText = ui.closeTipText || '';
    state.closeTipSilent = ui.closeTipSilent === true;
    syncAppControls();
  });
  window.sentinel.onTerminalData((data) => { if (state.term) state.term.write(data); });
  window.sentinel.onTerminalStatus((st) => {
    if (!st) return;
    if (st.connected) { setTermStatus('SSH 已连接', 'on'); $('termEmpty').classList.add('hidden'); state.termMode = 'ssh'; }
    else if (state.termMode === 'ssh') { setTermStatus('连接已断开', 'err'); state.termMode = 'idle'; $('termEmpty').classList.remove('hidden'); $('termConnect').classList.remove('hidden'); $('termDisconnect').classList.add('hidden'); }
  });
  window.sentinel.onNavigate((view) => { if (view) switchView(view); });

  const snap = await window.sentinel.getStats();
  if (snap) render(snap);
  switchView('overview');
  setTermStatus('未连接', '');
}

document.addEventListener('DOMContentLoaded', boot);