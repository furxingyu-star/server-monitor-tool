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

function applyWallpaper(url) {
  if (!url) return;
  const el = $('wallpaper');
  el.style.backgroundImage = 'url("' + url.replace(/"/g, '\\"') + '")';
}

function hostFromUrl(url) {
  try { return new URL(String(url || '')).hostname || ''; } catch { return ''; }
}

function identity() {
  const s = (boot && boot.settings) || {};
  const ui = s.ui || {};
  const showIp = ui.showIp !== false;
  const showDomain = ui.showDomain !== false;
  const domain = String(s.displayName || '').trim();
  const ip = ((s.ssh && s.ssh.host) || hostFromUrl(s.bt && s.bt.baseUrl) || '').trim();
  const primary = showDomain && domain ? domain : (showIp && ip ? ip : '服务器');
  const secondary = showDomain && showIp && domain && ip ? ip : '';
  return { primary, secondary };
}

function render(s) {
  latest = s;
  const online = !!s.online;
  $('widget').classList.toggle('offline', !online);
  $('statusDot').className = 'status-dot' + (online ? '' : ' off');
  const id = identity();
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
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(124,216,255,.30)');
  grad.addColorStop(1, 'rgba(124,216,255,0)');
  ctx.beginPath();
  ctx.moveTo(0, h);
  pts.forEach((v, i) => ctx.lineTo(i * stepX, yOf(v)));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  pts.forEach((v, i) => { const x = i * stepX, y = yOf(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = 'rgba(150,226,255,.85)'; ctx.lineWidth = 1.4;
  ctx.shadowColor = 'rgba(110,200,255,.6)'; ctx.shadowBlur = 6; ctx.stroke();
  ctx.shadowBlur = 0;

  const lx = (pts.length - 1) * stepX, ly = yOf(pts[pts.length - 1]);
  ctx.beginPath(); ctx.arc(lx - 0.5, ly, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = '#ccf3ff'; ctx.shadowColor = 'rgba(140,220,255,.9)'; ctx.shadowBlur = 8; ctx.fill();
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
  document.documentElement.setAttribute('data-theme', ui.theme || 'deep');
  if (ui.accent) document.documentElement.style.setProperty('--accent', ui.accent);
  const liquid = ui.liquid !== false;
  document.documentElement.setAttribute('data-liquid', liquid ? '1' : '0');
  document.documentElement.setAttribute('data-fx', ui.lowFx ? 'low' : '');
  document.documentElement.setAttribute('data-glass', ['clear','std','rich'].indexOf(ui.glass) >= 0 ? ui.glass : 'std');
  const size = ui.widgetSize === 'mini' ? 'mini' : 'normal';
  document.documentElement.setAttribute('data-size', size);
  document.body.classList.toggle('low-fx', !!ui.lowFx);
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
    applyLook(s);
    const prev = boot.settings || {};
    boot.settings = Object.assign({}, prev, s, { ui: Object.assign({}, prev.ui || {}, s.ui || {}) });
    if (latest) render(latest);
  });
  applyWallpaper((boot.wallpaper && boot.wallpaper.thumb) || (boot.wallpaper && boot.wallpaper.url));
  pinned = !!(boot.settings && boot.settings.ui && boot.settings.ui.alwaysOnTop !== false);
  updatePin();
  const stats = await window.sentinel.getStats();
  if (stats) render(stats);
  window.sentinel.onStats(render);
  window.sentinel.onWallpaper((w) => applyWallpaper(w.thumb || w.url));
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
