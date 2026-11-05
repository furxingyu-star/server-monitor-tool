'use strict';

const CONTAINERS = [
  { name: 'astrbot_jdfy-astrbot_jdfY-1', status: 'running', image: 'soulter/astrbot:latest', cpu: 1.8, mem: 186 },
  { name: 'mysql-8.0', status: 'running', image: 'mysql:8.0', cpu: 0.6, mem: 324 },
  { name: 'redis', status: 'running', image: 'redis:7-alpine', cpu: 0.2, mem: 42 },
  { name: 'allinssl', status: 'running', image: 'allinssl/allinssl:latest', cpu: 0.3, mem: 76 },
  { name: 'watchtower', status: 'exited', image: 'containrrr/watchtower', cpu: 0, mem: 0 }
];

const SITES = [
  { name: 'demo.example.com', path: '/www/wwwroot/demo.example.com', status: '1', domains: 'demo.example.com www.demo.example.com' },
  { name: 'api.example.com', path: '/www/wwwroot/api', status: '1', domains: 'api.example.com' },
  { name: 'panel.example.com', path: '/www/wwwroot/panel', status: '1', domains: 'panel.example.com' }
];

class DemoSource {
  constructor() {
    this.history = [];
    this.cpu = 21;
    this.memPct = 63;
    this.diskPct = 46.8;
    this.netUp = 42 * 1024;
    this.netDown = 680 * 1024;
    this.upTotal = 86.4e9;
    this.downTotal = 412.7e9;
    this.started = Date.now() - (12 * 86400 + 4 * 3600) * 1000;
    this.t = 0;
    // 预热历史曲线，首次启动就有完整的 3 分钟走势
    const now = Date.now();
    for (let i = 59; i >= 0; i--) {
      const jitter = (a) => (Math.random() - 0.5) * a;
      this.cpu = Math.max(3, Math.min(93, this.cpu + jitter(9)));
      this.memPct = Math.max(38, Math.min(88, this.memPct + jitter(1.6)));
      this.history.push({
        t: now - i * 3000,
        cpu: this.cpu,
        mem: this.memPct,
        disk: this.diskPct,
        net: this.netUp + this.netDown
      });
    }
  }

  next() {
    this.t++;
    const jitter = (a) => (Math.random() - 0.5) * a;
    this.cpu = Math.max(3, Math.min(93, this.cpu + jitter(9) + (this.cpu < 18 ? 2.2 : this.cpu > 70 ? -2.4 : 0)));
    this.memPct = Math.max(38, Math.min(88, this.memPct + jitter(1.6)));
    this.diskPct = Math.min(71, this.diskPct + 0.004);
    this.netUp = Math.max(2e3, this.netUp * (0.82 + Math.random() * 0.36));
    this.netDown = Math.max(20e3, this.netDown * (0.8 + Math.random() * 0.4));
    this.upTotal += this.netUp * 3;
    this.downTotal += this.netDown * 3;
    const now = Date.now();
    this.history.push({ t: now, cpu: this.cpu, mem: this.memPct, disk: this.diskPct, net: (this.netUp + this.netDown) });
    if (this.history.length > 60) this.history.shift();
    const memTotal = 3.9 * 1024 ** 3;
    const diskTotal = 40 * 1024 ** 3;
    const load = this.cpu / 100 * 2 + jitter(0.3);
    return {
      ts: now,
      mode: 'demo',
      online: true,
      source: 'demo',
      host: 'demo-server',
      name: '星语 · 云主机',
      system: 'Debian GNU/Linux 13 (x86_64)',
      uptime: '12 天 4 小时',
      panelVersion: '11.7.0',
      cpu: { usage: this.cpu, cores: 2, model: 'Intel Xeon Platinum 8255C', load: [Math.max(0, load), Math.max(0, load * 0.8), Math.max(0, load * 0.62)] },
      mem: { total: memTotal, used: memTotal * this.memPct / 100, percent: this.memPct },
      disk: {
        total: diskTotal,
        used: diskTotal * this.diskPct / 100,
        free: diskTotal * (1 - this.diskPct / 100),
        percent: this.diskPct,
        parts: [
          { path: '/', total: diskTotal, used: diskTotal * this.diskPct / 100, percent: this.diskPct, fs: '/dev/vda1', type: 'ext4' },
          { path: '/www', total: 80 * 1024 ** 3, used: 31.2 * 1024 ** 3, percent: 39, fs: '/dev/vdb1', type: 'ext4' }
        ]
      },
      net: { up: this.netUp, down: this.netDown, upTotal: this.upTotal, downTotal: this.downTotal },
      io: { read: 120 * 1024, write: 340 * 1024 },
      sites: 3,
      databases: 2,
      ftp: 1,
      containers: CONTAINERS,
      services: [
        { name: 'nginx', status: 'running' },
        { name: 'mysqld', status: 'running' },
        { name: 'docker', status: 'running' },
        { name: 'redis', status: 'running' }
      ],
      siteList: SITES,
      cpuHistory: this.history.slice(),
      warning: null,
      error: null
    };
  }
}

module.exports = { DemoSource, CONTAINERS, SITES };