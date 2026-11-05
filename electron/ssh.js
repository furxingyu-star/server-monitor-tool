'use strict';
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { Client } = require('ssh2');

function parseSections(text) {
  const out = {};
  let key = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^@@([A-Z_]+)$/.exec(line.trim());
    if (m) { key = m[1]; out[key] = []; continue; }
    if (key) out[key].push(line);
  }
  return out;
}

function humanUptime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return d + ' 天 ' + h + ' 小时';
  if (h) return h + ' 小时 ' + m + ' 分';
  return m + ' 分钟';
}

const METRICS_CMD = [
  'printf "@@SYS\\n"; (cat /etc/os-release 2>/dev/null | head -n 6) || uname -srm',
  'printf "@@HOST\\n"; hostname 2>/dev/null',
  'printf "@@UP\\n"; cat /proc/uptime 2>/dev/null',
  'printf "@@CPU\\n"; grep -E "^cpu[0-9]* " /proc/stat 2>/dev/null',
  'printf "@@MEM\\n"; cat /proc/meminfo 2>/dev/null',
  'printf "@@DISK\\n"; df -Pk / 2>/dev/null',
  'printf "@@LOAD\\n"; cat /proc/loadavg 2>/dev/null',
  'printf "@@NET\\n"; cat /proc/net/dev 2>/dev/null',
  'printf "@@DOCKER\\n"; (docker ps --format "{{.Names}}|{{.State}}|{{.Image}}" 2>/dev/null | head -n 30) || true',
  'printf "@@END\\n"'
].join('; ');

function parseMetrics(text, prev) {
  const sec = parseSections(text);
  const cores = (sec.CPU || []).filter((l) => /^cpu\d+\s/.test(l)).length;
  const cpuLines = sec.CPU || [];
  const statLine = cpuLines.find((l) => /^cpu\s/.test(l)) || cpuLines[0] || '';
  const stat = statLine.trim().split(/\s+/).slice(1).map(Number);
  const cpuTotal = stat.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const cpuIdle = (stat[3] || 0) + (stat[4] || 0);
  let cpuUsage = 0;
  if (prev && prev.cpuTotal != null && cpuTotal > prev.cpuTotal) {
    cpuUsage = 100 * (1 - (cpuIdle - prev.cpuIdle) / (cpuTotal - prev.cpuTotal));
    cpuUsage = Math.max(0, Math.min(100, cpuUsage));
  }

  const memLines = sec.MEM || [];
  const memGet = (name) => {
    const l = memLines.find((x) => x.startsWith(name + ':'));
    return l ? Number((l.split(/\s+/)[1] || 0)) * 1024 : 0;
  };
  const memTotal = memGet('MemTotal');
  const memAvailable = memGet('MemAvailable') || (memGet('MemFree') + memGet('Buffers') + memGet('Cached'));
  const memUsed = Math.max(0, memTotal - memAvailable);

  const diskLine = (sec.DISK || []).find((l) => /^\S+\s+\d+\s+\d+\s+\d+\s+\d+/.test(l) && !/^Filesystem/.test(l));
  let diskTotal = 0, diskUsed = 0, diskFree = 0;
  if (diskLine) {
    const p = diskLine.trim().split(/\s+/);
    diskTotal = Number(p[1]) * 1024; diskUsed = Number(p[2]) * 1024; diskFree = Number(p[3]) * 1024;
  }

  const loadParts = ((sec.LOAD && sec.LOAD[0]) || '').trim().split(/\s+/).map(Number);
  const osLines = sec.SYS || [];
  const pretty = osLines.find((l) => l.startsWith('PRETTY_NAME='));
  const system = pretty ? pretty.split('=')[1].replace(/^"|"$/g, '') : (osLines[0] || 'Linux');

  let netUp = 0, netDown = 0, upTotal = 0, downTotal = 0;
  const now = Date.now();
  for (const line of sec.NET || []) {
    const m = /^\s*([^:]+):\s*(.+)$/.exec(line);
    if (!m || /lo|docker|veth|br-/.test(m[1])) continue;
    const nums = m[2].trim().split(/\s+/).map(Number);
    const rx = nums[0] || 0, tx = nums[8] || 0;
    upTotal += tx; downTotal += rx;
  }
  if (prev && prev.netAt && now > prev.netAt && (upTotal >= prev.upTotal || downTotal >= prev.downTotal)) {
    const dt = (now - prev.netAt) / 1000;
    netUp = Math.max(0, (upTotal - prev.upTotal) / dt);
    netDown = Math.max(0, (downTotal - prev.downTotal) / dt);
  }

  const containers = (sec.DOCKER || []).filter(Boolean).map((line) => {
    const [name, state, image] = line.split('|');
    return { name, status: state === 'running' ? 'running' : (state || 'unknown'), image: image || '' };
  });

  const uptimeSec = Number(((sec.UP && sec.UP[0]) || '0').split(/\s+/)[0]) || 0;

  return {
    snapshot: {
      mode: 'ssh',
      online: true,
      source: 'ssh',
      host: ((sec.HOST && sec.HOST[0]) || '').trim() || 'server',
      system,
      uptime: humanUptime(uptimeSec),
      cpu: { usage: cpuUsage, cores, load: [loadParts[0] || 0, loadParts[1] || 0, loadParts[2] || 0] },
      mem: { total: memTotal, used: memUsed, percent: memTotal ? (memUsed / memTotal) * 100 : 0 },
      disk: { total: diskTotal, used: diskUsed, free: diskFree, percent: diskTotal ? (diskUsed / diskTotal) * 100 : 0, parts: [] },
      net: { up: netUp, down: netDown, upTotal, downTotal },
      io: { read: 0, write: 0 },
      containers,
      warning: null
    },
    state: { cpuTotal, cpuIdle, netAt: now, upTotal, downTotal, uptimeSec }
  };
}

class SshManager extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.stream = null;
    this.opts = null;
    this.connected = false;
    this.prev = null;
  }

  optionsFrom(settings) {
    const s = settings.ssh || {};
    const o = {
      host: s.host,
      port: Number(s.port) || 22,
      username: s.username || 'root',
      readyTimeout: 15000,
      keepaliveInterval: 5000,
      keepaliveCountMax: 3
    };
    if (s.password) o.password = s.password;
    if (s.privateKeyPath) {
      try { o.privateKey = fs.readFileSync(s.privateKeyPath); } catch (e) { throw new Error('读取私钥失败: ' + e.message); }
    }
    if (!o.password && !o.privateKey) throw new Error('SSH 未配置密码或私钥');
    return o;
  }

  async connect(settings) {
    if (this.connected && this.client) return true;
    this.disconnect();
    const opts = this.optionsFrom(settings);
    this.opts = opts;
    await new Promise((resolve, reject) => {
      const c = new Client();
      this.client = c;
      const timer = setTimeout(() => { try { c.destroy(); } catch {} reject(new Error('SSH 连接超时')); }, 16000);
      c.once('ready', () => { clearTimeout(timer); this.connected = true; resolve(); });
      c.once('error', (e) => { clearTimeout(timer); this.connected = false; reject(new Error('SSH: ' + e.message)); });
      c.on('close', () => { this.connected = false; this.stream = null; this.emit('status', { connected: false }); });
      c.connect(opts);
    });
    this.emit('status', { connected: true });
    return true;
  }

  async exec(command, timeout = 12000) {
    if (!this.client || !this.connected) throw new Error('SSH 未连接');
    return new Promise((resolve, reject) => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; reject(new Error('SSH 命令超时')); } }, timeout);
      this.client.exec(command, (err, stream) => {
        if (err) { clearTimeout(to); done = true; return reject(err); }
        let out = '', errOut = '';
        stream.on('data', (d) => { out += d.toString('utf8'); });
        stream.stderr.on('data', (d) => { errOut += d.toString('utf8'); });
        stream.on('close', () => {
          clearTimeout(to);
          if (done) return;
          done = true;
          if (!out && errOut) return reject(new Error(errOut.trim()));
          resolve(out);
        });
      });
    });
  }

  async metrics() {
    const text = await this.exec(METRICS_CMD);
    const { snapshot, state } = parseMetrics(text, this.prev);
    this.cores = snapshot.cpu.cores || this.cores || 0;
    snapshot.cpu.cores = this.cores;
    this.prev = state;
    return snapshot;
  }

  async openShell(cols = 120, rows = 32) {
    if (!this.client || !this.connected) throw new Error('SSH 尚未连接');
    if (this.stream) { try { this.stream.close(); } catch {} this.stream = null; }
    await new Promise((resolve, reject) => {
      this.client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) return reject(err);
        this.stream = stream;
        this.emit('terminal:open');
        stream.on('data', (d) => this.emit('terminal:data', d.toString('utf8')));
        stream.stderr.on('data', (d) => this.emit('terminal:data', d.toString('utf8')));
        stream.on('close', () => { this.stream = null; this.emit('terminal:close'); });
        resolve();
      });
    });
  }

  write(data) { if (this.stream) this.stream.write(data); }
  resize(cols, rows) { try { if (this.stream) this.stream.setWindow(rows, cols, 0, 0); } catch {} }

  disconnect() {
    try { if (this.stream) this.stream.close(); } catch {}
    try { if (this.client) this.client.end(); } catch {}
    this.stream = null; this.client = null; this.connected = false; this.prev = null;
  }
}

module.exports = { SshManager, parseMetrics, humanUptime };