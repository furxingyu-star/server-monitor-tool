'use strict';
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function sign(apiKey) {
  const requestTime = String(Math.floor(Date.now() / 1000));
  const requestToken = md5(requestTime + md5(apiKey));
  return { request_time: requestTime, request_token: requestToken };
}

function normalizeBaseUrl(raw) {
  if (!raw) throw new Error('面板地址为空');
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  u.hash = '';
  u.search = '';
  return u.toString().replace(/\/+$/, '');
}

function request(urlString, { method = 'POST', form, timeout = 12000, allowSelfSigned = true } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const body = form ? new URLSearchParams(form).toString() : '';
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method,
      rejectUnauthorized: !allowSelfSigned,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'StarSentinel/1.0',
        Accept: 'application/json, text/plain, */*'
      },
      timeout
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size < 8 * 1024 * 1024) chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          const err = new Error('面板返回 HTTP ' + res.statusCode);
          err.statusCode = res.statusCode;
          err.body = text.slice(0, 300);
          return reject(err);
        }
        let data;
        try { data = JSON.parse(text); }
        catch { return reject(new Error('面板返回的不是 JSON（可能是安全入口/登录页）: ' + text.replace(/\s+/g, ' ').slice(0, 120))); }
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('连接面板超时（' + timeout + 'ms）')));
    req.on('error', reject);
    if (body) req.write(body); else req.end();
    if (!body) return;
    req.end();
  });
}

class BtClient {
  constructor({ baseUrl, apiKey, allowSelfSigned = true }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.allowSelfSigned = allowSelfSigned;
    this.cache = new Map();
  }

  async post(pathname, params = {}) {
    if (!this.apiKey) throw new Error('尚未配置宝塔 API 密钥');
    const form = { ...sign(this.apiKey), ...params };
    const data = await request(this.baseUrl + pathname, { method: 'POST', form, allowSelfSigned: this.allowSelfSigned });
    if (data && typeof data === 'object' && data.status === false) {
      throw new Error(data.msg || '宝塔 API 返回失败');
    }
    return data;
  }

  async get(pathname, params = {}) {
    if (!this.apiKey) throw new Error('尚未配置宝塔 API 密钥');
    const s = sign(this.apiKey);
    const q = new URLSearchParams({ ...params, ...s }).toString();
    const data = await request(this.baseUrl + pathname + '?' + q, { method: 'GET', allowSelfSigned: this.allowSelfSigned });
    if (data && typeof data === 'object' && data.status === false) throw new Error(data.msg || '宝塔 API 返回失败');
    return data;
  }

  async test() {
    const t = await this.post('/system', { action: 'GetSystemTotal' });
    if (!t || typeof t !== 'object' || !('memTotal' in t)) throw new Error('API 可用，但返回结构异常');
    return t;
  }

  async dockerList() {
    const r = await this.get('/btdocker/container/get_list');
    return Array.isArray(r && r.container_list) ? r.container_list : [];
  }

  async sites() {
    const r = await this.post('/site', { action: 'GetSiteList' });
    const list = Array.isArray(r) ? r : (r && (r.data || r.sites)) || [];
    return list.map((s) => ({
      name: s.name || s.siteName || s.domain || '',
      path: s.path || s.sitePath || '',
      status: s.status === undefined ? '1' : String(s.status),
      domains: s.domain || s.domains || s.name || ''
    }));
  }

  async snapshot(prev = {}) {
    const [total, disk, load, net] = await Promise.allSettled([
      this.post('/system', { action: 'GetSystemTotal' }),
      this.post('/system', { action: 'GetDiskInfo' }),
      this.post('/system', { action: 'GetLoadAverage' }),
      this.post('/system', { action: 'GetNetWork' })
    ]);
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    const err = (r) => (r.status === 'rejected' ? r.reason.message : null);
    const t = val(total), d = val(disk), l = val(load), n = val(net);
    if (!t && !d && !l && !n) {
      throw new Error(err(total) || err(net) || '无法获取服务器状态');
    }
    const memTotal = Number(t && t.memTotal) || Number(n && n.mem && n.mem.memTotal) || 0;
    const memUsed = Number(t && t.memRealUsed) || (n && n.mem && Number(n.mem.memRealUsed)) || 0;
    const cpuUsage = Number(
      (t && t.cpuRealUsed) ??
      (n && Array.isArray(n.cpu) ? n.cpu[0] : n && n.cpu && n.cpu.usage) ?? 0
    ) || 0;
    const cpuNum = Number(t && t.cpuNum) || (n && n.online_cpus) || 0;
    const mainDisk = Array.isArray(d) && d.length
      ? (d.find((x) => x.path === '/') || d[0])
      : (Array.isArray(n && n.disk) && n.disk[0]) || null;
    let diskTotal = 0, diskUsed = 0, diskFree = 0;
    if (mainDisk && Array.isArray(mainDisk.byte_size)) {
      [diskTotal, diskUsed, diskFree] = mainDisk.byte_size.map(Number);
    } else if (mainDisk && Array.isArray(mainDisk.size)) {
      diskTotal = Number(mainDisk.size[0]) || 0;
      diskUsed = Number(mainDisk.size[1]) || 0;
      diskFree = Number(mainDisk.size[2]) || 0;
    }
    const upKBs = Number(n && n.up) || 0;
    const downKBs = Number(n && n.down) || 0;
    const now = Date.now();
    const hist = Array.isArray(prev.cpuHistory) ? prev.cpuHistory.slice(-59) : [];
    hist.push({ t: now, cpu: cpuUsage, mem: memTotal ? (memUsed / memTotal) * 100 : 0, net: upKBs + downKBs });

    return {
      ts: now,
      mode: 'bt',
      online: true,
      source: 'bt',
      host: this.baseUrl.replace(/^https?:\/\//, ''),
      name: '',
      system: (t && t.system) || (n && n.system) || 'Linux 服务器',
      uptime: (t && t.time) || '—',
      panelVersion: (t && t.version) || '',
      cpu: {
        usage: Math.max(0, Math.min(100, cpuUsage)),
        cores: cpuNum,
        model: Array.isArray(t && t.cpu) ? t.cpu[3] : '',
        load: l ? [Number(l.one) || 0, Number(l.five) || 0, Number(l.fifteen) || 0] : (n && n.load ? [Number(n.load.one) || 0, Number(n.load.five) || 0, Number(n.load.fifteen) || 0] : [0, 0, 0])
      },
      mem: {
        total: memTotal * 1024 * 1024,
        used: memUsed * 1024 * 1024,
        percent: memTotal ? Math.min(100, (memUsed / memTotal) * 100) : 0
      },
      disk: {
        total: diskTotal,
        used: diskUsed,
        free: diskFree,
        percent: diskTotal ? Math.min(100, (diskUsed / diskTotal) * 100) : 0,
        parts: Array.isArray(d) ? d.map((x) => ({
          path: x.path,
          total: Array.isArray(x.byte_size) ? Number(x.byte_size[0]) : 0,
          used: Array.isArray(x.byte_size) ? Number(x.byte_size[1]) : 0,
          percent: Array.isArray(x.size) ? parseFloat(x.size[3]) || 0 : 0,
          fs: x.filesystem || '', type: x.type || ''
        })) : []
      },
      net: {
        up: upKBs * 1024,
        down: downKBs * 1024,
        upTotal: Number(n && n.upTotal) || 0,
        downTotal: Number(n && n.downTotal) || 0
      },
      io: {
        read: Number((n && n.iostat && (n.iostat.read || n.iostat.r)) || 0) * 1024,
        write: Number((n && n.iostat && (n.iostat.write || n.iostat.w)) || 0) * 1024
      },
      sites: Number(n && n.site_total) || 0,
      databases: Number(n && n.database_total) || 0,
      ftp: Number(n && n.ftp_total) || 0,
      containers: Array.isArray(prev.containers) ? prev.containers : [],
      services: prev.services || [],
      cpuHistory: hist,
      error: null,
      warning: [err(total), err(disk), err(load), err(net)].filter(Boolean).join(' · ') || null
    };
  }
}

module.exports = { BtClient, sign, md5, normalizeBaseUrl, request };
