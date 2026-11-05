'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, screen, Notification } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store');
const { BtClient } = require('./btapi');
const { SshManager } = require('./ssh');
const { DemoSource } = require('./demo');
const wallpaper = require('./wallpaper');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');

const argv = process.argv.slice(1);
const argValue = (name) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : null;
};
const SHOT = argValue('shot');
const SHOT_VIEW = argValue('view');
const SHOT_SCROLL = Number(argValue('scroll') || 0);
const OUT_DIR = argValue('out') || path.join(ROOT, 'shots');
const isShot = !!SHOT;

let store, engine, tray = null, widgetWin = null, dashWin = null, isQuitting = false;
let lastWallpaper = { path: '', url: '' };
const terminal = { mode: 'idle', message: '' };

const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !isShot) {
  app.quit();
} else {
  app.on('second-instance', () => { showDashboard(); });
}

app.commandLine.appendSwitch('force-color-profile', 'srgb');
if (process.platform === 'win32') app.setAppUserModelId('com.starwhisper.sentinel');

function fileUrl(p) {
  try { return p ? pathToFileURL(p).href : ''; } catch { return ''; }
}

function safeOpenExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(url);
  } catch {}
}

class DataEngine {
  constructor() {
    this.settings = store.load();
    this.bt = null;
    this.ssh = new SshManager();
    this.demo = new DemoSource();
    this.timer = null;
    this.last = null;
    this.busy = false;
    this.tick = 0;
    this.lastError = null;
    this.ssh.on('terminal:data', (data) => {
      for (const w of [dashWin, widgetWin]) if (w && !w.isDestroyed()) w.webContents.send('terminal:data', data);
    });
    this.ssh.on('terminal:open', () => {
      for (const w of [dashWin, widgetWin]) if (w && !w.isDestroyed()) w.webContents.send('terminal:status', { connected: true });
    });
    this.ssh.on('terminal:close', () => {
      for (const w of [dashWin, widgetWin]) if (w && !w.isDestroyed()) w.webContents.send('terminal:status', { connected: false });
    });
  }

  configure() {
    this.settings = store.load();
    this.bt = null;
    if (this.settings.mode === 'bt') {
      this.bt = new BtClient(this.settings.bt);
    }
    if (this.settings.mode !== 'ssh') this.ssh.disconnect();
    this.restartTimer();
  }

  restartTimer() {
    if (this.timer) clearInterval(this.timer);
    const sec = Math.max(1, Math.min(30, Number(this.settings.pollSeconds) || 3));
    this.timer = setInterval(() => this.refresh(), sec * 1000);
  }

  start() {
    this.configure();
    this.refresh();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ssh.disconnect();
  }

  async refresh() {
    if (this.busy) return this.last;
    this.busy = true;
    this.tick++;
    try {
      let snap;
      const mode = this.settings.mode;
      if (mode === 'bt') {
        if (!this.bt || this.bt.baseUrl !== new BtClient(this.settings.bt).baseUrl) this.bt = new BtClient(this.settings.bt);
        snap = await this.bt.snapshot(this.last || {});
        snap.name = this.settings.displayName || '';
        if (this.tick % 5 === 1) {
          try {
            const list = await this.bt.dockerList();
            snap.containers = list.map((c) => ({
              name: c.name || c.container_id || '', status: c.status || 'unknown', image: c.image || '', raw: c
            }));
          } catch { snap.containers = (this.last && this.last.containers) || []; }
        } else {
          snap.containers = (this.last && this.last.containers) || [];
        }
      } else if (mode === 'ssh') {
        if (!this.ssh.connected) await this.ssh.connect(this.settings);
        snap = await this.ssh.metrics();
        snap.name = this.settings.displayName || '';
        snap.cpuHistory = [...((this.last && this.last.cpuHistory) || []), { t: Date.now(), cpu: snap.cpu.usage, mem: snap.mem.percent, net: snap.net.up + snap.net.down }].slice(-60);
      } else {
        snap = this.demo.next();
      }
      this.last = snap;
      this.lastError = null;
      this.publish(snap);
    } catch (e) {
      this.lastError = e.message;
      const base = this.last || { cpuHistory: [] };
      const snap = {
        ...base,
        ts: Date.now(),
        mode: this.settings.mode,
        online: false,
        error: e.message,
        cpu: base.cpu || { usage: 0, cores: 0, load: [0, 0, 0] },
        mem: base.mem || { total: 0, used: 0, percent: 0 },
        disk: base.disk || { total: 0, used: 0, free: 0, percent: 0, parts: [] },
        net: base.net || { up: 0, down: 0, upTotal: 0, downTotal: 0 },
        io: base.io || { read: 0, write: 0 },
        containers: base.containers || [],
        cpuHistory: [...(base.cpuHistory || []), { t: Date.now(), cpu: 0, mem: 0, net: 0 }].slice(-60)
      };
      this.last = snap;
      this.publish(snap);
    } finally {
      this.busy = false;
    }
    return this.last;
  }

  publish(snap) {
    for (const w of [widgetWin, dashWin]) {
      if (w && !w.isDestroyed()) w.webContents.send('stats', snap);
    }
  }
}

function applyWallpaperToStore(filePath, source = 'custom') {
  lastWallpaper = { path: filePath, url: fileUrl(filePath) };
}

async function bootstrapPayload() {
  const s = store.sanitized();
  let wpPath = store.load().wallpaper.path;
  if (!wpPath || !fs.existsSync(wpPath)) wpPath = await wallpaper.getCurrentWallpaper();
  lastWallpaper = { path: wpPath, url: fileUrl(wpPath) };
  const items = wallpaper.listWallpapers().map((it) => ({ ...it, url: fileUrl(it.path) }));
  return {
    settings: s,
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    wallpaper: { path: wpPath, url: lastWallpaper.url, thumb: wallpaper.thumbDataUrl(wpPath, 1440) },
    wallpapers: items,
    dataModes: [
      { id: 'demo', name: '演示模式', desc: '无需配置，立即预览全部界面' },
      { id: 'bt', name: '宝塔 API', desc: '官方 API，读取 CPU / 内存 / 磁盘 / Docker' },
      { id: 'ssh', name: 'SSH', desc: '指标 + 内嵌终端，需要服务器开放 SSH' }
    ],
    terminal
  };
}

const WIDGET_SIZES = {
  normal: { w: 392, h: 316 },
  mini: { w: 252, h: 100 }
};

function uiPrefs() {
  return (store && store.load().ui) || {};
}

function appTitle() {
  const name = String(uiPrefs().appName || '').trim();
  return name || '星语哨兵';
}

function widgetDims() {
  const size = uiPrefs().widgetSize;
  return WIDGET_SIZES[size] || WIDGET_SIZES.normal;
}

function broadcastSettings() {
  if (!store) return;
  const payload = store.sanitized();
  for (const w of [widgetWin, dashWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('settings:changed', payload);
  }
}

const TIPS = {
  tray: '星语哨兵仍在托盘运行，双击托盘图标即可重新打开。',
  widget: '悬浮窗还在桌面显示服务器实时状态，随时可以瞟一眼。',
  quit: '程序仍在后台运行。需要彻底退出时，右键托盘图标选择“退出”。'
};

function resolveTip(ui) {
  const key = (ui && ui.closeTip) || 'tray';
  if (key === 'custom') return String((ui && ui.closeTipText) || '').trim() || TIPS.tray;
  return TIPS[key] || TIPS.tray;
}

function showCloseTip(text) {
  const body = String(text || '').trim();
  if (!body) return false;
  try {
    const n = new Notification({
      title: appTitle(),
      body,
      icon: path.join(ROOT, 'assets', 'icon-256.png'),
      silent: true
    });
    n.on('click', () => showDashboard());
    n.show();
    return true;
  } catch {
    try { if (tray) tray.displayBalloon({ title: appTitle(), content: body }); } catch {}
    return false;
  }
}

function hideDashboardWithTip() {
  if (!dashWin || dashWin.isDestroyed()) return;
  const ui = uiPrefs();
  dashWin.hide();
  if (ui.closeNotify !== false && ui.closeTipSilent !== true) showCloseTip(resolveTip(ui));
}

async function askCloseAction() {
  const ui = uiPrefs();
  const res = await dialog.showMessageBox(dashWin, {
    type: 'question',
    buttons: ['最小化到托盘', '退出程序'],
    defaultId: 0,
    cancelId: 0,
    title: appTitle(),
    message: '关闭主面板时要怎么做？',
    detail: '最小化到托盘后程序仍在后台运行，可随时再次打开；退出则完全结束进程。',
    checkboxLabel: '记住我的选择（不再询问）',
    checkboxChecked: false,
    noLink: true
  });
  const quit = res.response === 1;
  if (res.checkboxChecked) {
    store.save({ ui: { closeAction: quit ? 'quit' : 'tray' } });
    broadcastSettings();
  }
  if (quit) quitApp();
  else hideDashboardWithTip();
}

function handleDashboardClose() {
  if (isQuitting || isShot) return;
  const action = (uiPrefs().closeAction) || 'tray';
  if (action === 'quit') { quitApp(); return; }
  if (action === 'ask') { askCloseAction(); return; }
  hideDashboardWithTip();
}

function createWidget() {
  const { workArea } = screen.getPrimaryDisplay();
  const dims = widgetDims();
  const W = dims.w, H = dims.h;
  const saved = store.load().ui.widget || {};
  let x = Number.isFinite(saved.x) ? saved.x : workArea.x + workArea.width - W - 18;
  let y = Number.isFinite(saved.y) ? saved.y : workArea.y + workArea.height - H - 18;
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return x + W > a.x && x < a.x + a.width && y + H > a.y && y < a.y + a.height;
  });
  if (!visible) { x = workArea.x + workArea.width - W - 18; y = workArea.y + workArea.height - H - 18; }

  widgetWin = new BrowserWindow({
    width: W, height: H, x, y,
    frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: store.load().ui.alwaysOnTop !== false,
    hasShadow: false, show: false, roundedCorners: false, thickFrame: false,
    title: appTitle(),
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false }
  });
  widgetWin.setAlwaysOnTop(store.load().ui.alwaysOnTop !== false, 'floating');
  widgetWin.loadFile(path.join(RENDERER, 'widget.html'));
  widgetWin.once('ready-to-show', () => { if (!isShot) widgetWin.showInactive(); });
  widgetWin.on('moved', () => {
    const [wx, wy] = widgetWin.getPosition();
    store.save({ ui: { widget: { x: wx, y: wy } } });
  });
  widgetWin.on('closed', () => { widgetWin = null; });
}

function createDashboard(show = true) {
  if (dashWin && !dashWin.isDestroyed()) {
    if (show) { dashWin.show(); dashWin.focus(); }
    return dashWin;
  }
  const { workArea } = screen.getPrimaryDisplay();
  const W = Math.min(1240, workArea.width - 40);
  const H = Math.min(820, workArea.height - 40);
  dashWin = new BrowserWindow({
    width: W, height: H,
    x: workArea.x + Math.round((workArea.width - W) / 2),
    y: workArea.y + Math.round((workArea.height - H) / 2),
    minWidth: 980, minHeight: 640,
    frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: true, show: false, title: appTitle(),
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false }
  });
  dashWin.loadFile(path.join(RENDERER, 'index.html'));
  dashWin.once('ready-to-show', () => { if (show && !isShot) { dashWin.show(); dashWin.focus(); } });
  dashWin.on('close', (e) => {
    if (isQuitting || isShot) return;
    e.preventDefault();
    handleDashboardClose();
  });
  dashWin.on('maximize', () => dashWin.webContents.send('window:state', { maximized: true }));
  dashWin.on('unmaximize', () => dashWin.webContents.send('window:state', { maximized: false }));
  dashWin.on('closed', () => { dashWin = null; });
  return dashWin;
}

function showDashboard() {
  if (!dashWin) createDashboard(true);
  else { if (dashWin.isMinimized()) dashWin.restore(); dashWin.show(); dashWin.focus(); }
  refreshTrayMenu();
}

function buildTray() {
  let img;
  const iconPath = path.join(ROOT, 'assets', 'icon.png');
  try { img = nativeImage.createFromPath(iconPath); } catch { img = nativeImage.createEmpty(); }
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip(appTitle() + ' · StarWhisper Sentinel');
  refreshTrayMenu();
  tray.on('double-click', () => showDashboard());
  tray.on('click', () => showDashboard());
}

function refreshTrayMenu() {
  if (!tray) return;
  const ui = uiPrefs();
  const size = ui.widgetSize === 'mini' ? 'mini' : 'normal';
  const visible = !!(widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible());
  tray.setToolTip(appTitle() + ' · StarWhisper Sentinel');
  const menu = Menu.buildFromTemplate([
    { label: '打开主面板', click: () => showDashboard() },
    { label: (visible ? '隐藏悬浮窗' : '显示悬浮窗'), click: () => toggleWidget() },
    {
      label: '悬浮窗尺寸',
      submenu: [
        { label: '标准', type: 'radio', checked: size === 'normal', click: () => setWidgetSize('normal') },
        { label: '迷你', type: 'radio', checked: size === 'mini', click: () => setWidgetSize('mini') }
      ]
    },
    { type: 'separator' },
    { label: '立即刷新', click: () => engine.refresh() },
    { label: '壁纸…', click: () => { showDashboard(); if (dashWin) dashWin.webContents.send('navigate', 'wallpaper'); } },
    { label: '设置…', click: () => { showDashboard(); if (dashWin) dashWin.webContents.send('navigate', 'settings'); } },
    { type: 'separator' },
    { label: '退出' + appTitle(), click: () => quitApp() }
  ]);
  tray.setContextMenu(menu);
}

function toggleWidget() {
  if (!widgetWin || widgetWin.isDestroyed()) {
    store.save({ ui: { showWidget: true } });
    createWidget();
    broadcastSettings();
    refreshTrayMenu();
    return;
  }
  if (widgetWin.isVisible()) {
    widgetWin.hide();
    store.save({ ui: { showWidget: false } });
  } else {
    widgetWin.showInactive();
    widgetWin.setAlwaysOnTop(uiPrefs().alwaysOnTop !== false, 'floating');
    store.save({ ui: { showWidget: true } });
  }
  broadcastSettings();
  refreshTrayMenu();
}

function setWidgetVisible(visible, opts = {}) {
  const v = !!visible;
  store.save({ ui: { showWidget: v } });
  if (v) {
    if (!widgetWin || widgetWin.isDestroyed()) createWidget();
    else { widgetWin.showInactive(); widgetWin.setAlwaysOnTop(uiPrefs().alwaysOnTop !== false, 'floating'); }
  } else if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.hide();
  }
  if (!opts.silent) { broadcastSettings(); refreshTrayMenu(); }
}

function setWidgetSize(size, opts = {}) {
  const key = size === 'mini' ? 'mini' : 'normal';
  store.save({ ui: { widgetSize: key } });
  if (widgetWin && !widgetWin.isDestroyed()) {
    const d = WIDGET_SIZES[key];
    const b = widgetWin.getBounds();
    const nx = b.x + (b.width - d.w);
    const ny = b.y + (b.height - d.h);
    widgetWin.setBounds({ x: nx, y: ny, width: d.w, height: d.h });
    store.save({ ui: { widget: { x: nx, y: ny } } });
  }
  if (!opts.silent) { broadcastSettings(); refreshTrayMenu(); }
}

function quitApp() {
  isQuitting = true;
  try { engine.stop(); } catch {}
  try { if (tray) tray.destroy(); } catch {}
  app.quit();
}

function applyWindowSettings(prev, next) {
  const title = String(next.appName || '').trim() || '星语哨兵';
  if (prev.appName !== next.appName || !prev.appName) {
    try { if (dashWin && !dashWin.isDestroyed()) dashWin.setTitle(title); } catch {}
    try { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.setTitle(title); } catch {}
    try { if (tray) tray.setToolTip(title + ' · StarWhisper Sentinel'); } catch {}
  }
  if (prev.showWidget !== next.showWidget) setWidgetVisible(next.showWidget !== false, { silent: true });
  if (prev.widgetSize !== next.widgetSize) setWidgetSize(next.widgetSize, { silent: true });
  if (prev.alwaysOnTop !== next.alwaysOnTop && widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.setAlwaysOnTop(next.alwaysOnTop !== false, 'floating');
  }
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', async () => bootstrapPayload());
  ipcMain.handle('app:save-settings', async (_e, patch) => {
    const prevMode = store.load().mode;
    const prevUi = Object.assign({}, store.load().ui || {});
    const next = store.save(patch || {});
    engine.configure();
    if (prevMode !== next.mode) engine.refresh();
    applyWindowSettings(prevUi, next.ui || {});
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.setAlwaysOnTop(next.ui.alwaysOnTop !== false, 'floating');
    const payload = { settings: store.sanitized(), ok: true };
    for (const w of [widgetWin, dashWin]) {
      if (w && !w.isDestroyed()) w.webContents.send('settings:changed', payload.settings);
    }
    refreshTrayMenu();
    return payload;
  });
  ipcMain.handle('stats:get', () => engine.last);
  ipcMain.handle('stats:refresh', async () => engine.refresh());
  ipcMain.handle('stats:test-bt', async (_e, cfg) => {
    const apiKey = cfg.apiKey && cfg.apiKey !== '__KEEP__' ? cfg.apiKey : store.load().bt.apiKey;
    const client = new BtClient({ baseUrl: cfg.baseUrl, apiKey, allowSelfSigned: cfg.allowSelfSigned !== false });
    const t = await client.test();
    return { ok: true, system: t.system, version: t.version, memTotal: t.memTotal, cpuNum: t.cpuNum };
  });
  ipcMain.handle('stats:test-ssh', async () => {
    const mgr = new SshManager();
    try {
      await mgr.connect(store.load());
      const snap = await mgr.metrics();
      mgr.disconnect();
      return { ok: true, host: snap.host, system: snap.system };
    } catch (e) { mgr.disconnect(); throw e; }
  });

  ipcMain.handle('window:open-dashboard', () => showDashboard());
  ipcMain.handle('window:hide-dashboard', () => { if (dashWin) dashWin.hide(); });
  ipcMain.handle('window:close-dashboard', () => { handleDashboardClose(); return true; });
  ipcMain.handle('window:minimize', () => {
    if (!dashWin) return false;
    if (uiPrefs().minimizeToTray !== false) { dashWin.hide(); return true; }
    dashWin.minimize();
    return true;
  });
  ipcMain.handle('window:set-widget-visible', (_e, v) => { setWidgetVisible(!!v); return !!v; });
  ipcMain.handle('app:preview-tip', (_e, tip) => {
    showCloseTip(tip || resolveTip(uiPrefs()));
    return true;
  });
  ipcMain.handle('window:maximize', () => {
    if (!dashWin) return false;
    if (dashWin.isMaximized()) dashWin.unmaximize(); else dashWin.maximize();
    return dashWin.isMaximized();
  });
  ipcMain.handle('window:hide-widget', () => { setWidgetVisible(false, { silent: true }); return true; });
  ipcMain.handle('window:show-widget', () => { setWidgetVisible(true, { silent: true }); return true; });
  ipcMain.handle('window:set-pin', (_e, pinned) => {
    store.save({ ui: { alwaysOnTop: !!pinned } });
    if (widgetWin) widgetWin.setAlwaysOnTop(!!pinned, 'floating');
    return !!pinned;
  });
  ipcMain.handle('window:is-pinned', () => store.load().ui.alwaysOnTop !== false);
  ipcMain.handle('app:quit', () => quitApp());
  ipcMain.handle('app:open-external', (_e, url) => safeOpenExternal(url));
  ipcMain.handle('app:open-panel', () => {
    const base = store.load().bt.baseUrl;
    safeOpenExternal(base.replace(/\/+$/, '') + '/xterm');
  });

  ipcMain.handle('wallpaper:get', async () => {
    let p = store.load().wallpaper.path;
    if (!p || !fs.existsSync(p)) p = await wallpaper.getCurrentWallpaper();
    lastWallpaper = { path: p, url: fileUrl(p) };
    return { path: p, url: lastWallpaper.url, thumb: wallpaper.thumbDataUrl(p, 1440) };
  });
  ipcMain.handle('wallpaper:list', () => wallpaper.listWallpapers().map((it) => ({ ...it, url: fileUrl(it.path) })));
  ipcMain.handle('wallpaper:pick', async () => {
    const r = await dialog.showOpenDialog(dashWin || undefined, {
      title: '选择壁纸', properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], url: fileUrl(r.filePaths[0]), thumb: wallpaper.thumbDataUrl(r.filePaths[0], 1440) };
  });
  ipcMain.handle('wallpaper:apply', async (_e, payload) => {
    let filePath = payload.path;
    if (payload.dataUrl) filePath = wallpaper.saveDataUrl(payload.dataUrl, payload.name || 'generated');
    if (!filePath || !fs.existsSync(filePath)) throw new Error('壁纸文件不存在');
    store.save({ wallpaper: { path: filePath, source: payload.source || 'custom', style: payload.style ?? store.load().wallpaper.style } });
    if (payload.setDesktop !== false) await wallpaper.setWallpaper(filePath, payload.style ?? store.load().wallpaper.style);
    lastWallpaper = { path: filePath, url: fileUrl(filePath) };
    const thumb = wallpaper.thumbDataUrl(filePath, 1440);
    for (const w of [widgetWin, dashWin]) if (w && !w.isDestroyed()) w.webContents.send('wallpaper:changed', { path: filePath, url: lastWallpaper.url, thumb });
    return { path: filePath, url: lastWallpaper.url, thumb };
  });
  ipcMain.handle('wallpaper:open-folder', () => shell.openPath(wallpaper.wallpaperDir()));

  ipcMain.handle('terminal:connect', async (_e, opts = {}) => {
    const mode = store.load().mode;
    if (mode === 'demo') { terminal.mode = 'demo'; terminal.message = '演示终端'; return { ok: true, mode: 'demo' }; }
    if (mode === 'bt' && !store.load().ssh.host) {
      terminal.mode = 'no-ssh'; terminal.message = '宝塔 API 不提供命令执行，请配置 SSH';
      return { ok: false, mode: 'no-ssh', message: terminal.message };
    }
    try {
      if (!engine.ssh.connected) await engine.ssh.connect(store.load());
      const cols = Math.max(40, Math.min(300, Number(opts.cols) || 120));
      const rows = Math.max(10, Math.min(120, Number(opts.rows) || 32));
      await engine.ssh.openShell(cols, rows);
      terminal.mode = 'ssh'; terminal.message = '';
      return { ok: true, mode: 'ssh' };
    } catch (e) {
      terminal.mode = 'error'; terminal.message = e.message;
      return { ok: false, mode: 'error', message: e.message };
    }
  });
  ipcMain.on('terminal:input', (_e, data) => { if (engine.ssh.connected) engine.ssh.write(String(data)); });
  ipcMain.on('terminal:resize', (_e, { cols, rows }) => { engine.ssh.resize(Number(cols) || 120, Number(rows) || 32); });
  ipcMain.handle('terminal:disconnect', () => { engine.ssh.disconnect(); return true; });
  ipcMain.handle('terminal:info', () => terminal);
}

async function captureShot() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Wait until the engine has produced at least one snapshot (real data needs a full API round-trip).
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !(engine.last && engine.last.ts)) {
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 900));
  const targets = SHOT === 'both' ? ['widget', 'dashboard'] : [SHOT];
  for (const t of targets) {
    const win = t === 'widget' ? widgetWin : dashWin;
    if (!win) continue;
    await new Promise((r) => setTimeout(r, 600));
    if (t === 'dashboard' && SHOT_VIEW) {
      try { await win.webContents.executeJavaScript('switchView(' + JSON.stringify(SHOT_VIEW) + ')'); } catch {}
      await new Promise((r) => setTimeout(r, 700));
    }
    if (t === 'dashboard' && SHOT_SCROLL > 0) {
      try { await win.webContents.executeJavaScript('document.getElementById("content").scrollTo({top:' + SHOT_SCROLL + ',behavior:"instant"})'); } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (process.argv.includes('--fps')) {
      try {
        const fps = await win.webContents.executeJavaScript(`new Promise((res) => {
          const t0 = performance.now(); let n = 0, long = 0, last = t0;
          function tick(now) {
            n++; if (now - last > 32) long++; last = now;
            if (now - t0 < 2500) requestAnimationFrame(tick);
            else res({ fps: Math.round(n / ((now - t0) / 1000)), long, frames: n });
          }
          requestAnimationFrame(tick);
        })`);
        console.log('FPS ' + t + ' ' + JSON.stringify(fps));
      } catch (e) { console.log('FPS_ERR ' + e.message); }
    }
    if (process.argv.includes('--probe')) {
      try {
        const info = await win.webContents.executeJavaScript(`(() => {
          const q = (s) => {
            const e = document.querySelector(s);
            if (!e) return null;
            const r = e.getBoundingClientRect();
            return { t: Math.round(r.top), h: Math.round(r.height),
              kids: Array.from(e.children).slice(0, 6).map((k) => {
                const kr = k.getBoundingClientRect();
                return { tag: k.tagName, cls: String(k.className || ''), t: Math.round(kr.top), h: Math.round(kr.height) };
              }) };
          };
          const hero = document.querySelector('.hero-card');
          const cs = hero && getComputedStyle(hero, '::after');
          return { hero: q('.hero-card'), metric: q('.metric-card'), grid: q('.overview-grid'),
            defs: document.querySelectorAll('.lg-defs').length, bodyKids: document.body.children.length,
            after: cs ? { bf: cs.backdropFilter, filter: cs.filter, z: cs.zIndex, pos: cs.position } : null,
            htmlAttrs: document.documentElement.getAttribute('data-liquid') + '/' + document.documentElement.getAttribute('data-lg') };
        })()`);
        console.log('PROBE ' + JSON.stringify(info));
      } catch (e) { console.log('PROBE_ERR ' + e.message); }
    }
    const img = await win.webContents.capturePage();
    const out = path.join(OUT_DIR, 'star-sentinel-' + t + (t === 'dashboard' && SHOT_VIEW ? '-' + SHOT_VIEW : '') + '.png');
    fs.writeFileSync(out, img.toPNG());
    console.log('saved', out);
  }
  setTimeout(() => quitApp(), 200);
}

app.whenReady().then(async () => {
  store = new Store();
  engine = new DataEngine();
  registerIpc();

  if (isShot) {
    const target = SHOT === 'widget' ? 'widget' : 'dashboard';
    if (target === 'widget') {
      createWidget();
      widgetWin.show();
      await new Promise((r) => widgetWin.webContents.once('did-finish-load', r));
    } else {
      createDashboard(false);
      await new Promise((r) => dashWin.webContents.once('did-finish-load', r));
      dashWin.show();
    }
    engine.start();
    setTimeout(() => captureShot().catch((e) => { console.error(e); app.quit(); }), 400);
  } else {
    const ui = uiPrefs();
    const firstRun = !store.load().seenWelcome;
    if (ui.showWidget !== false) createWidget();
    buildTray();
    engine.start();
    // Startup preference: dashboard / widget-only / both.
    const startup = ui.startup || 'both';
    const wantDashboard = firstRun || startup !== 'widget';
    if (wantDashboard) {
      setTimeout(() => { showDashboard(); }, firstRun ? 900 : 600);
    }
    store.save({ seenWelcome: true });
    // Render-cost probe: measure real compositor fps while the dashboard is visible.
    if (process.argv.includes('--fps')) {
      showDashboard();
      setTimeout(async () => {
        try {
          const fps = await dashWin.webContents.executeJavaScript(`new Promise((res) => {
            const t0 = performance.now(); let n = 0, long = 0, last = t0;
            function tick(now) {
              n++; if (now - last > 32) long++; last = now;
              if (now - t0 < 3000) requestAnimationFrame(tick);
              else res({ fps: Math.round((n / (now - t0)) * 1000), long, frames: n,
                liquid: document.documentElement.getAttribute('data-liquid'),
                fx: document.documentElement.getAttribute('data-fx') });
            }
            requestAnimationFrame(tick);
          })`);
          console.log('FPS ' + JSON.stringify(fps));
        } catch (e) { console.log('FPS_ERR ' + e.message); }
        setTimeout(() => quitApp(), 300);
      }, 4000);
    }
  }
});

app.on('window-all-closed', (e) => {
  if (isShot) app.quit();
  else e.preventDefault();
});
app.on('before-quit', () => { isQuitting = true; try { if (engine) engine.stop(); } catch {} });
app.on('activate', () => showDashboard());