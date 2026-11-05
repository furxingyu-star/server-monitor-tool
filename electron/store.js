'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { app, safeStorage } = require('electron');

// Shipped defaults are deliberately empty/neutral: credentials never live in the
// repository. Everything the user types is written to a single encrypted envelope
// (Windows DPAPI through safeStorage, AES-256-GCM key file as the fallback).
const FILE_FORMAT = 3;

const DEFAULTS = {
  mode: 'demo',
  displayName: 'my-server',
  pollSeconds: 3,
  bt: { baseUrl: 'https://panel.example.com:8888', apiKey: '', allowSelfSigned: true },
  ssh: { host: '192.0.2.10', port: 22, username: 'root', password: '', privateKeyPath: '' },
  wallpaper: { path: '', source: 'current', style: 10, tint: 0.62, blur: 18, dim: 0.35 },
  ui: {
    accent: '#78d7ff',
    theme: 'deep',
    appearance: 'system',
    liquid: true,
    lowFx: false,
    showIp: true,
    showDomain: true,
    glass: 'std',
    alwaysOnTop: true,
    opacity: 0.96,
    reduceMotion: false,
    appName: '星语哨兵',
    appSubtitle: 'StarWhisper Sentinel',
    startup: 'both',
    showWidget: true,
    widgetAutostart: true,
    widgetSize: 'normal',
    minimizeToTray: true,
    closeAction: 'tray',
    closeNotify: true,
    closeTip: 'tray',
    closeTipText: '',
    closeTipSilent: false,
    widget: { x: null, y: null },
    dashboard: { width: 1200, height: 800 }
  },
  seenWelcome: false
};

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Best effort: only the current user (plus SYSTEM) may read the encrypted files.
function hardenAcl(target) {
  if (!target) return;
  if (process.platform !== 'win32') {
    try { fs.chmodSync(target, 0o600); } catch {}
    return;
  }
  const user = process.env.USERNAME;
  if (!user) return;
  try {
    execFile('icacls', [target, '/inheritance:r', '/grant:r', user + ':F', 'SYSTEM:F'], { windowsHide: true }, () => {});
  } catch {}
}

class Store {
  constructor() {
    this.dir = app.getPath('userData');
    this.file = path.join(this.dir, 'settings.json');
    this.keyFile = path.join(this.dir, 'store.key');
    this.data = null;
    this.mode = 'none';
    this.needsMigration = false;
    this.lastError = '';
  }

  _dpapiReady() {
    try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
  }

  _fallbackKey() {
    try {
      if (fs.existsSync(this.keyFile)) {
        const key = fs.readFileSync(this.keyFile);
        if (key && key.length === 32) return key;
      }
      fs.mkdirSync(this.dir, { recursive: true });
      const key = crypto.randomBytes(32);
      fs.writeFileSync(this.keyFile, key, { mode: 0o600 });
      hardenAcl(this.keyFile);
      return key;
    } catch (e) {
      this.lastError = '生成本地密钥失败：' + ((e && e.message) || e);
      return null;
    }
  }

  encryptText(text) {
    if (this._dpapiReady()) {
      try {
        this.mode = 'dpapi';
        return 'dpapi:v1:' + safeStorage.encryptString(text).toString('base64');
      } catch {}
    }
    const key = this._fallbackKey();
    if (!key) return null;
    try {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
      this.mode = 'aes';
      return 'aes:v1:' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
    } catch (e) {
      this.lastError = '加密失败：' + ((e && e.message) || e);
      return null;
    }
  }

  decryptText(payload) {
    if (!payload || typeof payload !== 'string') return null;
    try {
      if (payload.startsWith('dpapi:v1:')) {
        if (!this._dpapiReady()) return null;
        const text = safeStorage.decryptString(Buffer.from(payload.slice(9), 'base64'));
        this.mode = 'dpapi';
        return text;
      }
      if (payload.startsWith('aes:v1:')) {
        const key = this._fallbackKey();
        const buf = Buffer.from(payload.slice(7), 'base64');
        if (!key || buf.length < 29) return null;
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const ct = buf.subarray(28);
        const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
        d.setAuthTag(tag);
        this.mode = 'aes';
        return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
      }
      // legacy per-field formats from <=1.2
      if (payload.startsWith('enc:v1:')) {
        if (!this._dpapiReady()) return null;
        return safeStorage.decryptString(Buffer.from(payload.slice(7), 'base64'));
      }
      if (payload.startsWith('obf:v1:')) return Buffer.from(payload.slice(7), 'base64').toString('utf8');
    } catch (e) {
      this.lastError = '解密失败：' + ((e && e.message) || e);
    }
    return null;
  }

  _readLegacyField(value) {
    if (!value || typeof value !== 'string') return '';
    if (value.startsWith('enc:v1:') || value.startsWith('obf:v1:')) return this.decryptText(value) || '';
    return value;
  }

  load() {
    if (this.data) return this.data;
    let parsed = null;
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch {}
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = null; }
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.payload === 'string') {
      const inner = this.decryptText(parsed.payload);
      let ok = false;
      if (inner) {
        try { parsed = JSON.parse(inner); ok = true; } catch { parsed = null; }
      }
      if (!ok) {
        // Never overwrite a file we cannot decrypt; fall back to defaults in memory.
        if (!this.lastError) this.lastError = '无法解密设置文件，已按默认配置启动';
        parsed = null;
      }
    } else if (parsed && typeof parsed === 'object') {
      // plaintext settings from <=1.2: read, then rewrite encrypted on first save
      if (parsed.bt && parsed.bt.apiKey) parsed.bt.apiKey = this._readLegacyField(parsed.bt.apiKey);
      if (parsed.ssh && parsed.ssh.password) parsed.ssh.password = this._readLegacyField(parsed.ssh.password);
      this.needsMigration = true;
    }
    this.data = deepMerge(structuredClone(DEFAULTS), parsed || {});
    if (this.needsMigration) {
      this.needsMigration = false;
      try { this.save({}); } catch {}
    }
    return this.data;
  }

  save(patch) {
    const current = this.load();
    const next = deepMerge(structuredClone(current), patch || {});
    // Never allow renderer to overwrite a secret with a masked placeholder.
    if (patch && patch.bt && patch.bt.apiKey === '__KEEP__') next.bt.apiKey = current.bt.apiKey;
    if (patch && patch.ssh && patch.ssh.password === '__KEEP__') next.ssh.password = current.ssh.password;
    this.data = next;
    this._write(next);
    return next;
  }

  _write(data) {
    const payload = this.encryptText(JSON.stringify(data));
    if (!payload) throw new Error(this.lastError || '设置加密失败');
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    const body = { format: FILE_FORMAT, app: 'star-sentinel', savedAt: new Date().toISOString(), payload };
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    hardenAcl(this.file);
  }

  protection() {
    this.load();
    const label = this.mode === 'dpapi' ? 'Windows DPAPI' : this.mode === 'aes' ? 'AES-256-GCM' : 'unknown';
    return { mode: this.mode, label, file: this.file, format: FILE_FORMAT, error: this.lastError || '' };
  }

  sanitized() {
    const s = this.load();
    return {
      ...s,
      bt: { ...s.bt, apiKey: '', hasApiKey: !!(s.bt.apiKey && s.bt.apiKey.length > 6) },
      ssh: { ...s.ssh, password: '', hasPassword: !!s.ssh.password, hasPrivateKey: !!s.ssh.privateKeyPath }
    };
  }
}

module.exports = { Store, DEFAULTS, FILE_FORMAT };
