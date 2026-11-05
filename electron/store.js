'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');

// Shipped defaults are deliberately empty/neutral: credentials never live in the
// repository. Real values are entered in the app and stored encrypted (safeStorage)
// in the per-user settings file.
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
    liquid: true,
    lowFx: false,
    showIp: true,
    showDomain: true,
    glass: 'std',
    alwaysOnTop: true,
    opacity: 0.96,
    reduceMotion: false,
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

class Store {
  constructor() {
    this.dir = app.getPath('userData');
    this.file = path.join(this.dir, 'settings.json');
    this.data = null;
  }

  encrypt(plain) {
    if (!plain) return '';
    try {
      if (safeStorage.isEncryptionAvailable()) return 'enc:v1:' + safeStorage.encryptString(plain).toString('base64');
    } catch {}
    // Fallback obfuscation only; never advertised as strong encryption.
    return 'obf:v1:' + Buffer.from(plain, 'utf8').toString('base64');
  }

  decrypt(value) {
    if (!value) return '';
    try {
      if (value.startsWith('enc:v1:')) return safeStorage.decryptString(Buffer.from(value.slice(7), 'base64'));
      if (value.startsWith('obf:v1:')) return Buffer.from(value.slice(7), 'base64').toString('utf8');
    } catch {}
    return '';
  }

  load() {
    if (this.data) return this.data;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    const merged = deepMerge(structuredClone(DEFAULTS), saved || {});
    if (saved && saved.bt && saved.bt.apiKey) merged.bt.apiKey = this.decrypt(saved.bt.apiKey);
    if (saved && saved.ssh && saved.ssh.password) merged.ssh.password = this.decrypt(saved.ssh.password);
    this.data = merged;
    return merged;
  }

  save(patch) {
    const current = this.load();
    const next = deepMerge(structuredClone(current), patch || {});
    // Never allow renderer to overwrite a secret with a masked placeholder.
    if (patch && patch.bt && patch.bt.apiKey === '__KEEP__') next.bt.apiKey = current.bt.apiKey;
    if (patch && patch.ssh && patch.ssh.password === '__KEEP__') next.ssh.password = current.ssh.password;
    this.data = next;
    const disk = deepMerge(structuredClone(next), {
      bt: { ...next.bt, apiKey: this.encrypt(next.bt.apiKey) },
      ssh: { ...next.ssh, password: this.encrypt(next.ssh.password) }
    });
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(disk, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return next;
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

module.exports = { Store, DEFAULTS };
