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
  style: 10,
  selectedWallpaper: null,
  accent: '#78d7ff',
  theme: 'deep',
  liquid: true,
  lowFx: false,
  showIp: true,
  showDomain: true,
  glass: 'std',
  appName: '星语哨兵',
  startup: 'both',
  showWidget: true,
  widgetSize: 'normal',
  minimizeToTray: true,
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
  demoShell: { buffer: '', active: false, cwd: '~' },
  lastWallpaperList: []
};

const MODE_LABEL = { demo: '演示', bt: '宝塔 API', ssh: 'SSH' };

/* ---------- 身份展示（IP / 域名） ---------- */
function hostFromUrl(url) {
  try { return new URL(String(url || '')).hostname || ''; } catch { return ''; }
}

function identity() {
  const s = state.settings || {};
  const showIp = state.showIp !== false;
  const showDomain = state.showDomain !== false;
  const domain = String(s.displayName || '').trim();
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
function isLightTheme() { return document.documentElement.getAttribute('data-theme') === 'dawn'; }

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
}

const THEMES = ['deep', 'violet', 'ocean', 'ember', 'graphite', 'dawn'];

function applyTheme(id) {
  state.theme = THEMES.indexOf(id) >= 0 ? id : 'deep';
  document.documentElement.setAttribute('data-theme', state.theme);
  document.documentElement.style.setProperty('--accent', paintTint(state.accent));
  els('#themeGrid .theme-card').forEach((b) => b.classList.toggle('active', b.dataset.theme === state.theme));
}

function applyFx(ui) {
  ui = ui || {};
  state.liquid = ui.liquid !== false;
  state.lowFx = !!ui.lowFx;
  document.documentElement.setAttribute('data-liquid', state.liquid ? '1' : '0');
  document.documentElement.setAttribute('data-fx', state.lowFx ? 'low' : '');
  const lg = $('liquidGlass');
  const lf = $('lowFx');
  if (lg) lg.checked = state.liquid;
  if (lf) lf.checked = state.lowFx;
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

function applyAppName(name) {
  const n = String(name || '').trim() || '星语哨兵';
  state.appName = n;
  const brand = $('brandName');
  if (brand) brand.textContent = n;
  document.title = n + ' · StarWhisper Sentinel';
  const aboutName = el('.about-name');
  if (aboutName) aboutName.innerHTML = esc(n) + ' <b>StarWhisper Sentinel</b>';
}

const GLASS_LEVELS = ['clear', 'std', 'rich'];
function applyGlass(level) {
  state.glass = GLASS_LEVELS.indexOf(level) >= 0 ? level : 'std';
  document.documentElement.setAttribute('data-glass', state.glass);
  els('#glassRow button').forEach((b) => b.classList.toggle('active', b.dataset.glass === state.glass));
}

let lookTimer = 0;
function persistLook() {
  clearTimeout(lookTimer);
  lookTimer = setTimeout(async () => {
    try {
      await window.sentinel.saveSettings({
        ui: {
          theme: state.theme, accent: state.accent, liquid: state.liquid, lowFx: state.lowFx,
          showIp: state.showIp, showDomain: state.showDomain, glass: state.glass
        }
      });
    } catch (e) { /* ignore */ }
  }, 260);
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
const wallSample = { img: null, ready: false };
let tintTimer = 0;
function loadWallSample(url) {
  if (!url || wallSample.src === url) return;
  wallSample.src = url;
  wallSample.ready = false;
  const img = new Image();
  img.onload = () => { wallSample.img = img; wallSample.ready = true; scheduleAdaptiveTint(); };
  img.onerror = () => { wallSample.ready = false; };
  img.src = url;
}
function scheduleAdaptiveTint() {
  if (tintTimer) return;
  tintTimer = setTimeout(() => { tintTimer = 0; tintCards(); }, 140);
}
function tintCards() {
  if (!wallSample.ready || document.hidden) return;
  const sheet = document.getElementById('adaptSheet');
  if (!sheet) return;
  const W = window.innerWidth, H = window.innerHeight;
  const bw = W * 1.06, bh = H * 1.06;          // .bg is inset -3%
  const img = wallSample.img;
  const sc = Math.max(bw / img.naturalWidth, bh / img.naturalHeight);
  const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
  const ox = -0.03 * W + (bw - dw) / 2, oy = -0.03 * H + (bh - dh) / 2;
  const cvs = sheet;
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, 8, 8);
  const dark = state.theme !== 'dawn';
  els('.glass').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24 || r.bottom < 0 || r.top > H) return;
    const sx = (r.left - ox) / sc, sy = (r.top - oy) / sc;
    const sw = r.width / sc, sh = r.height / sc;
    try { ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 8, 8); } catch (e) { return; }
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let rr = 0, gg = 0, bb = 0;
    const lums = [];
    for (let i = 0; i < d.length; i += 4) {
      rr += d[i]; gg += d[i + 1]; bb += d[i + 2];
      lums.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    }
    const n = d.length / 4;
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
  const c = document.createElement('canvas');
  c.id = 'adaptSheet'; c.width = 8; c.height = 8;
  c.style.cssText = 'position:absolute;left:-9999px;top:0;width:8px;height:8px';
  document.body.appendChild(c);
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

/* 指针高光：液态玻璃表面的镜面反光跟随鼠标 */
function initSpecular() {
  let raf = 0, lastEl = null, mx = 0, my = 0;
  document.addEventListener('pointermove', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('.quick, .mode-card, .theme-card') : null;
    if (!t) return;
    mx = e.clientX; my = e.clientY;
    lastEl = t;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!lastEl) return;
      const r = lastEl.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const px = Math.max(0, Math.min(100, ((mx - r.left) / r.width) * 100));
      const py = Math.max(0, Math.min(100, ((my - r.top) / r.height) * 100));
      lastEl.style.setProperty('--mx', px.toFixed(1) + '%');
      lastEl.style.setProperty('--my', py.toFixed(1) + '%');
    });
  }, { passive: true });
}

/* ---------- navigation ---------- */
let navHandler = null;
function switchView(name) {
  els('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  els('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  const content = $('content');
  if (content) content.scrollTop = 0;
  if (name === 'terminal') { ensureTerm(); setTimeout(() => { fitTerm(); }, 60); }
  if (name === 'wallpaper') refreshWallpaperView();
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

  $('tbHost').textContent = v.name + (v.host ? ' · ' + v.host : '');
  $('tbStatus').textContent = v.online ? (v.mode === 'demo' ? '演示数据' : MODE_LABEL[v.mode] + ' 在线') : '连接中断';
  $('tbDot').className = 'dot' + (v.online ? (v.mode === 'demo' ? ' warn' : '') : ' off');
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
  $('heroLive').innerHTML = '<span></span>' + (v.online ? 'LIVE' : 'OFFLINE');
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
  $('cpuTrend').textContent = trendOf(v.hist, 'cpu');

  $('memValue').textContent = v.mem.toFixed(0);
  $('memBar').style.width = v.mem + '%';
  $('memSub').textContent = fmtSize(v.memUsedBytes) + ' / ' + fmtSize(v.memTotalBytes);
  $('memFree').textContent = '可用 ' + fmtSize(Math.max(0, v.memTotalBytes - v.memUsedBytes));
  $('memTrend').textContent = trendOf(v.hist, 'mem');

  $('diskValue').textContent = v.disk.toFixed(0);
  $('diskBar').style.width = v.disk + '%';
  $('diskSub').textContent = fmtSize(v.diskUsed) + ' / ' + fmtSize(v.diskTotal);
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

  $('navDocker').textContent = v.containers.length;
  $('dockerSub').textContent = v.containers.length ? v.containers.filter(isRunning).length + ' / ' + v.containers.length + ' 运行中' : 'Docker 运行状态';

  renderDockerMini(v);
  renderSiteMini(v);
  renderMainChart(v);
  renderHeroSpark(v);
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
  const w = Math.max(60, Math.round(rect.width));
  const h = Math.max(30, Math.round(rect.height));
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
  const { ctx, w, h } = prepareCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  if (values.length < 1) values = [0];
  const padX = 2, padTop = 8, padBottom = 4;
  const peak = Math.max(...values, 1);
  const softMin = opts.softMin || 0;
  const maxVal = Math.max(opts.max || 0, peak * 1.25, softMin) * 1.06;
  const minVal = 0;
  const pts = values.map((val, i) => {
    const x = padX + (i / Math.max(1, values.length - 1)) * (w - padX * 2);
    const y = padTop + (1 - (val - minVal) / (maxVal - minVal)) * (h - padTop - padBottom);
    return [x, y];
  });

  // grid
  ctx.save();
  ctx.strokeStyle = isLightTheme() ? 'rgba(20,50,90,.10)' : 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const y = padTop + (i / 4) * (h - padTop - padBottom);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
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
  const color = paintTint(metric === 'mem' ? '#c0aaff' : metric === 'net' ? '#5ef0c0' : state.accent);
  drawLineChart($('mainChart'), vals, color, { max: metric === 'net' ? 0 : 100, softMin: metric === 'net' ? 8 : 28 });

  const cur = currentMetric(v, metric);
  const suffix = metric === 'net' ? ' KB/s' : '%';
  $('chartNow').textContent = cur.toFixed(metric === 'net' ? 1 : 0) + suffix;
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  $('chartAvg').textContent = avg.toFixed(metric === 'net' ? 1 : 0) + suffix;
  $('chartMax').textContent = (vals.length ? Math.max(...vals) : 0).toFixed(metric === 'net' ? 1 : 0) + suffix;
}

function renderHeroSpark(v) {
  const vals = padSeries(v.hist.map((p) => num(p.cpu)), 24);
  return drawLineChart($('heroSpark'), vals.length ? vals : [v.cpu], paintTint(state.accent), { max: 100, softMin: 26, glow: 8, width: 1.6 });
}

function renderPerformance(v) {
  const metric = state.perfMetric;
  const vals = padSeries(histSeries(v, metric));
  const color = paintTint(metric === 'mem' ? '#c0aaff' : metric === 'net' ? '#5ef0c0' : state.accent);
  drawLineChart($('perfChart'), vals, color, { max: metric === 'net' ? 0 : 100, softMin: metric === 'net' ? 8 : 28 });

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
    term.writeln('\x1b[38;2;160;220;255m星语哨兵终端\x1b[0m  \x1b[38;2;130;160;195mStarWhisper Sentinel Terminal\x1b[0m');
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

/* ---------- wallpaper ---------- */
const PRESETS = [
  { id: 'aurora', name: '极光之夜', desc: '深空青紫', seed: 7, base: ['#05101f', '#0a1c3a', '#071426'], blobs: [['#2f7bff', .30, .18, .55], ['#6d4bff', .78, .82, .55], ['#2fe0b0', .62, .22, .45], ['#58b6ff', .18, .72, .42]] },
  { id: 'deep', name: '深海微光', desc: '静谧蓝绿', seed: 21, base: ['#03121a', '#062a33', '#04141f'], blobs: [['#00a9c8', .24, .30, .55], ['#0ee0b0', .72, .68, .50], ['#1a5f9e', .55, .16, .45], ['#7ef7e0', .86, .24, .30]] },
  { id: 'violet', name: '紫霭流云', desc: '柔雾紫粉', seed: 33, base: ['#120a20', '#2a1440', '#160b26'], blobs: [['#8f4dff', .30, .26, .58], ['#ff6fae', .76, .72, .45], ['#5a5bff', .60, .86, .42], ['#c78bff', .12, .74, .35]] },
  { id: 'lime', name: '青柠晨雾', desc: '森系青绿', seed: 48, base: ['#061410', '#0a2a1e', '#051712'], blobs: [['#22c55e', .26, .70, .45], ['#7ef7c0', .70, .24, .48], ['#0e7a5e', .58, .58, .42], ['#d9ff8a', .88, .66, .25]] },
  { id: 'sunset', name: '熔金落日', desc: '暖橙暮色', seed: 61, base: ['#1a0912', '#3a1220', '#1c0a10'], blobs: [['#ff8a3d', .28, .68, .52], ['#ff4d6d', .72, .34, .45], ['#ffc46b', .52, .16, .35], ['#9b2cff', .88, .78, .28]] },
  { id: 'graphite', name: '极简石墨', desc: '低饱和灰蓝', seed: 76, base: ['#0b0e13', '#161c26', '#0a0d12'], blobs: [['#4f6a8a', .32, .30, .45], ['#7f93ad', .74, .70, .40], ['#2a3342', .55, .85, .50], ['#c9d8ea', .86, .20, .18]] }
];

function paintPreset(ctx, w, h, def) {
  const rnd = mulberry32(def.seed);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, def.base[0]);
  g.addColorStop(0.55, def.base[1]);
  g.addColorStop(1, def.base[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const [color, cx, cy, r] of def.blobs) {
    const x = cx * w + (rnd() - 0.5) * w * 0.08;
    const y = cy * h + (rnd() - 0.5) * h * 0.08;
    const rad = Math.max(w, h) * (r * 0.9 + 0.18) * (0.9 + rnd() * 0.2);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, hexA(color, 0.55));
    rg.addColorStop(0.45, hexA(color, 0.22));
    rg.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // flowing ribbon
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.translate(w * 0.5, h * 0.55);
  ctx.rotate(-0.32 + (def.seed % 10) * 0.02);
  const ribbon = ctx.createLinearGradient(-w * 0.6, 0, w * 0.6, 0);
  ribbon.addColorStop(0, hexA(def.blobs[0][0], 0));
  ribbon.addColorStop(0.35, hexA(def.blobs[0][0], 0.16));
  ribbon.addColorStop(0.65, hexA(def.blobs[1][0], 0.14));
  ribbon.addColorStop(1, hexA(def.blobs[1][0], 0));
  ctx.fillStyle = ribbon;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.62, h * 0.075, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.5)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  // fine grain
  const nw = 160, nh = Math.max(90, Math.round(160 * h / w));
  const nc = document.createElement('canvas');
  nc.width = nw; nc.height = nh;
  const nctx = nc.getContext('2d');
  const id = nctx.createImageData(nw, nh);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = 110 + Math.floor(rnd() * 90);
    id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = v; id.data[i + 3] = 26;
  }
  nctx.putImageData(id, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(nc, 0, 0, w, h);
  ctx.restore();
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function renderPresets() {
  const grid = $('presetGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const p of PRESETS) {
    const card = document.createElement('div');
    card.className = 'preset';
    card.dataset.preset = p.id;
    const c = document.createElement('canvas');
    c.width = 640; c.height = 336;
    paintPreset(c.getContext('2d'), 640, 336, p);
    card.appendChild(c);
    const meta = document.createElement('div');
    meta.className = 'p-meta';
    meta.innerHTML = '<span>' + esc(p.name) + '</span><small>' + esc(p.desc) + '</small>';
    card.appendChild(meta);
    card.addEventListener('click', () => {
      els('#presetGrid .preset').forEach((x) => x.classList.remove('selected'));
      card.classList.add('selected');
      const url = c.toDataURL('image/png');
      state.selectedWallpaper = { preset: p.id, name: p.name, previewUrl: url };
      $('wpPreview').style.backgroundImage = 'url("' + url + '")';
      $('wpName').textContent = p.name + '（内置）';
      $('wpDims').textContent = '2560 × 1440 · 生成';
      $('wpStatus').textContent = '已选择「' + p.name + '」，点击上方应用';
    });
    grid.appendChild(card);
  }
}

function renderGallery() {
  const box = $('gallery');
  if (!box) return;
  const list = state.lastWallpaperList || [];
  $('galleryCount').textContent = list.length + ' 张可用图片';
  if (!list.length) {
    box.innerHTML = '<div class="empty" style="grid-column:span 4">没有找到可用图片</div>';
    return;
  }
  box.innerHTML = '';
  list.forEach((it) => {
    const item = document.createElement('div');
    item.className = 'gal-item';
    item.dataset.path = it.path;
    const img = document.createElement('img');
    img.src = it.url;
    img.loading = 'lazy';
    img.alt = it.name || '';
    item.appendChild(img);
    const cap = document.createElement('span');
    cap.textContent = it.name || it.path.split(/[\\/]/).pop();
    item.appendChild(cap);
    item.addEventListener('click', () => {
      els('#gallery .gal-item').forEach((x) => x.classList.remove('selected'));
      item.classList.add('selected');
      els('#presetGrid .preset').forEach((x) => x.classList.remove('selected'));
      state.selectedWallpaper = { path: it.path, url: it.url };
      $('wpPreview').style.backgroundImage = 'url("' + it.url + '")';
      $('wpName').textContent = it.name || '';
      $('wpDims').textContent = it.width && it.height ? it.width + ' × ' + it.height : '本机图片';
      $('wpStatus').textContent = '已选择本机图片，点击上方应用';
    });
    box.appendChild(item);
  });
}

async function refreshWallpaperView() {
  try {
    const wp = await window.sentinel.wallpaper.get();
    if (wp) {
      state.wallpaper = wp;
      $('wpPreview').style.backgroundImage = 'url("' + (wp.thumb || wp.url) + '")';
      $('wpName').textContent = (wp.path || '').split(/[\\/]/).pop() || '当前壁纸';
      $('wpDims').textContent = '当前桌面壁纸';
    }
    const list = await window.sentinel.wallpaper.list();
    state.lastWallpaperList = Array.isArray(list) ? list : [];
    renderGallery();
  } catch (e) { console.error(e); }
}

async function applySelectedWallpaper() {
  const sel = state.selectedWallpaper;
  if (!sel) { toast('请先选择一张壁纸'); return; }
  const style = state.style;
  $('wpStatus').textContent = '正在应用…';
  try {
    let res;
    if (sel.preset) {
      const def = PRESETS.find((p) => p.id === sel.preset);
      const c = document.createElement('canvas');
      c.width = 2560; c.height = 1440;
      paintPreset(c.getContext('2d'), 2560, 1440, def);
      const dataUrl = c.toDataURL('image/jpeg', 0.92);
      res = await window.sentinel.wallpaper.apply({ dataUrl, name: 'sentinel-' + def.id, source: 'preset', style });
    } else {
      res = await window.sentinel.wallpaper.apply({ path: sel.path, source: 'custom', style });
    }
    if (res && res.url) {
      state.wallpaper = res;
      applyBackdrop(res.url);
      $('wpPreview').style.backgroundImage = 'url("' + (res.thumb || res.url) + '")';
      $('wpName').textContent = (res.path || '').split(/[\\/]/).pop() || '壁纸';
      $('wpDims').textContent = '已应用到桌面';
      $('wpStatus').textContent = '✓ 已同步到界面与桌面';
      toast('壁纸已更换');
    }
  } catch (e) {
    $('wpStatus').textContent = '应用失败：' + (e.message || e);
    toast('壁纸应用失败', 'err');
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
  setSeg('widgetSizeSeg', 'size', state.widgetSize);
  setSeg('startupSeg', 'startup', state.startup);
  setSeg('closeActionSeg', 'close', state.closeAction);
  if ($('showWidget')) $('showWidget').checked = state.showWidget;
  if ($('minimizeToTray')) $('minimizeToTray').checked = state.minimizeToTray;
  if ($('closeNotify')) $('closeNotify').checked = state.closeNotify;
  if ($('closeTip')) $('closeTip').value = state.closeTip;
  if ($('closeTipText')) $('closeTipText').value = state.closeTipText;
  if ($('closeTipSilent')) $('closeTipSilent').checked = state.closeTipSilent;
}

function collectAppPatch() {
  return {
    appName: state.appName,
    startup: state.startup,
    showWidget: state.showWidget,
    widgetSize: state.widgetSize,
    minimizeToTray: state.minimizeToTray,
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
  $('displayName').value = s.displayName || '';
  $('pollSeconds').value = s.pollSeconds || 3;
  $('alwaysOnTop').checked = !s.ui || s.ui.alwaysOnTop !== false;
  applyAccent((s.ui && s.ui.accent) || '#78d7ff');
  applyTheme(s.ui && s.ui.theme);
  applyFx(s.ui || {});
  applyGlass(s.ui && s.ui.glass);
  applyDisplay(s.ui || {});
  const ui = s.ui || {};
  applyAppName(ui.appName);
  state.startup = ui.startup === 'dashboard' || ui.startup === 'widget' ? ui.startup : 'both';
  state.showWidget = ui.showWidget !== false;
  state.widgetSize = ui.widgetSize === 'mini' ? 'mini' : 'normal';
  state.minimizeToTray = ui.minimizeToTray !== false;
  state.closeAction = ['tray', 'quit', 'ask'].indexOf(ui.closeAction) >= 0 ? ui.closeAction : 'tray';
  state.closeNotify = ui.closeNotify !== false;
  state.closeTip = ['tray', 'widget', 'quit', 'custom'].indexOf(ui.closeTip) >= 0 ? ui.closeTip : 'tray';
  state.closeTipText = ui.closeTipText || '';
  state.closeTipSilent = ui.closeTipSilent === true;
  syncAppControls();
  state.style = (s.wallpaper && s.wallpaper.style) || 10;
  els('#wpStyleChips button').forEach((b) => b.classList.toggle('active', Number(b.dataset.style) === Number(state.style)));
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
    displayName: $('displayName').value.trim() || 'my-server',
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
      liquid: state.liquid,
      lowFx: state.lowFx,
      glass: state.glass,
      showIp: $('showIp') ? $('showIp').checked : state.showIp,
      showDomain: $('showDomain') ? $('showDomain').checked : state.showDomain,
      alwaysOnTop: $('alwaysOnTop').checked
    }, collectAppPatch(), {
      appName: $('appName') ? ($('appName').value.trim() || '星语哨兵') : state.appName
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
  bindSeg('closeActionSeg', 'close', 'closeAction');
  const an = $('appName');
  if (an) {
    an.addEventListener('input', (e) => { applyAppName(e.target.value); persistApp(); });
    an.addEventListener('change', (e) => {
      applyAppName(e.target.value);
      state.appName = String(e.target.value || '').trim() || '星语哨兵';
      e.target.value = state.appName;
      persistApp();
    });
  }
  const sw = $('showWidget');
  if (sw) sw.addEventListener('change', () => {
    state.showWidget = sw.checked;
    window.sentinel.window.setWidgetVisible(state.showWidget);
    persistApp();
  });
  const mt = $('minimizeToTray');
  if (mt) mt.addEventListener('change', () => { state.minimizeToTray = mt.checked; persistApp(); });
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
  $('qWallpaper').addEventListener('click', () => switchView('wallpaper'));
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

  $('wpStyleChips').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.style = Number(b.dataset.style);
    els('#wpStyleChips button').forEach((x) => x.classList.toggle('active', x === b));
  });
  $('wpApplyBtn').addEventListener('click', applySelectedWallpaper);
  $('wpPickBtn').addEventListener('click', async () => {
    try {
      const pick = await window.sentinel.wallpaper.pick();
      if (!pick) return;
      state.selectedWallpaper = pick;
      $('wpPreview').style.backgroundImage = 'url("' + (pick.thumb || pick.url) + '")';
      $('wpName').textContent = (pick.path || '').split(/[\\/]/).pop();
      $('wpDims').textContent = '本机图片';
      $('wpStatus').textContent = '已选择本机图片，点击上方应用';
    } catch (e) { toast('选择图片失败', 'err'); }
  });
  $('wpOpenFolder').addEventListener('click', () => window.sentinel.wallpaper.openFolder());

  els('#modeGrid .mode-card').forEach((b) => b.addEventListener('click', () => {
    els('#modeGrid .mode-card').forEach((x) => x.classList.toggle('active', x === b));
    $('btPanel').classList.toggle('hidden', b.dataset.mode !== 'bt');
  }));
  $('btTest').addEventListener('click', testBt);
  $('sshTest').addEventListener('click', testSsh);
  $('saveSettings').addEventListener('click', () => saveSettings(false));
  $('saveSettings2').addEventListener('click', () => saveSettings(false));
  els('#accentRow button').forEach((b) => b.addEventListener('click', () => { applyAccent(b.dataset.accent); persistLook(); }));
  els('#themeGrid .theme-card').forEach((b) => b.addEventListener('click', () => { applyTheme(b.dataset.theme); persistLook(); }));
  const custom = $('accentCustom');
  if (custom) custom.addEventListener('input', (e) => { applyAccent(e.target.value); els('#accentRow button').forEach((b) => b.classList.remove('active')); custom.classList.add('is-active'); persistLook(); });
  const lg = $('liquidGlass');
  if (lg) lg.addEventListener('change', () => { applyFx({ liquid: lg.checked, lowFx: state.lowFx }); persistLook(); });
  const lf = $('lowFx');
  if (lf) lf.addEventListener('change', () => { applyFx({ liquid: state.liquid, lowFx: lf.checked }); persistLook(); });
  const si = $('showIp');
  if (si) si.addEventListener('change', () => { applyDisplay({ showIp: si.checked, showDomain: state.showDomain }); persistLook(); });
  const sd = $('showDomain');
  if (sd) sd.addEventListener('change', () => { applyDisplay({ showIp: state.showIp, showDomain: sd.checked }); persistLook(); });
  const gr = $('glassRow');
  if (gr) gr.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-glass]');
    if (!b) return;
    applyGlass(b.dataset.glass);
    persistLook();
  });
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
  initSpecular();
  wireEvents();
  startClock();
  renderPresets();

  try {
    const boot = await window.sentinel.bootstrap();
    if (boot) {
      fillSettings(boot.settings);
      $('aboutVersion').textContent = boot.appVersion || '1.0.0';
      $('aboutElectron').textContent = boot.electron || '—';
      if (boot.wallpaper && boot.wallpaper.url) {
        state.wallpaper = boot.wallpaper;
        applyBackdrop(boot.wallpaper.url);
        $('wpPreview').style.backgroundImage = 'url("' + (boot.wallpaper.thumb || boot.wallpaper.url) + '")';
      }
      state.lastWallpaperList = Array.isArray(boot.wallpapers) ? boot.wallpapers : [];
      renderGallery();
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
    applyFx(ui);
    applyGlass(ui.glass);
    applyDisplay(ui);
    if (ui.appName) applyAppName(ui.appName);
    if (ui.accent) applyAccent(ui.accent);
    state.startup = ui.startup || 'both';
    state.showWidget = ui.showWidget !== false;
    state.widgetSize = ui.widgetSize === 'mini' ? 'mini' : 'normal';
    state.minimizeToTray = ui.minimizeToTray !== false;
    state.closeAction = ['tray', 'quit', 'ask'].indexOf(ui.closeAction) >= 0 ? ui.closeAction : 'tray';
    state.closeNotify = ui.closeNotify !== false;
    state.closeTip = ui.closeTip || 'tray';
    state.closeTipText = ui.closeTipText || '';
    state.closeTipSilent = ui.closeTipSilent === true;
    syncAppControls();
  });
  window.sentinel.onWallpaper((wp) => {
    if (!wp) return;
    state.wallpaper = wp;
    applyBackdrop(wp.url);
    if (wp.thumb) $('wpPreview').style.backgroundImage = 'url("' + wp.thumb + '")';
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