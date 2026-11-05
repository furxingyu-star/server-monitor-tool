'use strict';
/* measure rAF cadence inside the running app via CDP: idle + scrolling */
const port = Number(process.argv[2] || 9333);
const label = process.argv[3] || 'run';

async function targets() {
  const res = await fetch('http://127.0.0.1:' + port + '/json');
  return res.json();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id;
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        });
      },
      close() { try { ws.close(); } catch {} },
    });
    ws.onerror = () => reject(new Error('ws error'));
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
      }
    };
  });
}

const EVAL = `(function(){
  if (window.__perf) return 'already';
  window.__perf = { frames: [], on: false };
  window.__startPerf = function(){
    window.__perf.frames = []; window.__perf.on = true;
    var tick = function(t){ window.__perf.frames.push(t); if (window.__perf.on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
  window.__stopPerf = function(){
    window.__perf.on = false;
    var f = window.__perf.frames;
    if (f.length < 2) return { frames: f.length };
    var d = [];
    for (var i = 1; i < f.length; i++) d.push(f[i] - f[i-1]);
    d.sort(function(a,b){ return a-b; });
    var dur = (f[f.length-1] - f[0]) / 1000;
    var sum = d.reduce(function(a,b){ return a+b; }, 0);
    return {
      frames: f.length,
      seconds: +dur.toFixed(2),
      fps: +((f.length - 1) / dur).toFixed(1),
      avgMs: +(sum / d.length).toFixed(2),
      p50: +d[Math.floor(d.length * .5)].toFixed(2),
      p95: +d[Math.floor(d.length * .95)].toFixed(2),
      max: +d[d.length - 1].toFixed(2),
      over33: d.filter(function(x){ return x > 33.4; }).length
    };
  };
  return 'installed';
})()`;

(async () => {
  let list = await targets();
  let page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  if (!page) {
    const w = list.find((t) => t.type === 'page' && /widget\.html/.test(t.url));
    if (!w) { console.log(JSON.stringify({ label, error: 'no page', urls: list.map(t=>t.url) })); process.exit(1); }
    const wc = await connect(w.webSocketDebuggerUrl);
    await wc.send('Runtime.evaluate', { expression: '(async function(){ var s = window.sentinel || {}; if (s.window && s.window.openDashboard) { await s.window.openDashboard(); return "dash"; } if (s.openPanel) { await s.openPanel(); return "panel"; } return "none"; })()', awaitPromise: true, returnByValue: true });
    wc.close();
    await new Promise((r) => setTimeout(r, 2200));
    list = await targets();
    page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  }
  if (!page) { console.log(JSON.stringify({ label, error: 'no dashboard', urls: list.map(t=>t.url) })); process.exit(1); }

  const c = await connect(page.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Page.bringToFront');
  await c.send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 900));
  await c.send('Runtime.evaluate', { expression: EVAL, returnByValue: true });

  // idle
  await c.send('Runtime.evaluate', { expression: 'window.__startPerf()' });
  await new Promise((r) => setTimeout(r, 2500));
  const idle = (await c.send('Runtime.evaluate', { expression: 'window.__stopPerf()', returnByValue: true })).result.value;

  // scroll: wheel over the content column
  const metrics = (await c.send('Page.getLayoutMetrics')).cssLayoutViewport;
  const x = Math.round(metrics.clientWidth * 0.6);
  const y = Math.round(metrics.clientHeight * 0.55);
  await c.send('Runtime.evaluate', { expression: 'window.__startPerf()' });
  for (let i = 0; i < 45; i++) {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: i % 2 ? 140 : -140, modifiers: 0, pointerType: 'mouse' });
    await new Promise((r) => setTimeout(r, 16));
  }
  await new Promise((r) => setTimeout(r, 600));
  const scroll = (await c.send('Runtime.evaluate', { expression: 'window.__stopPerf()', returnByValue: true })).result.value;

  let pm = null;
  try {
    await c.send('Performance.enable');
    const raw = await c.send('Performance.getMetrics');
    pm = Object.fromEntries(raw.metrics.map((m) => [m.name, m.value]));
  } catch {}

  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] != null).map((k) => [k, o[k]]));
  console.log(JSON.stringify({
    label,
    idle,
    scroll,
    perf: pick(pm, ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount']),
  }, null, 1));
  c.close();
  process.exit(0);
})().catch((e) => { console.log(JSON.stringify({ label, error: String(e && e.message || e) })); process.exit(1); });
