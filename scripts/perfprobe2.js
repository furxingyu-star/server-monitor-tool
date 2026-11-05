'use strict';
/* decompose frame cost: baseline -> animations paused -> backdrop-filter off -> svg lens off */
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
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
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
    return {
      frames: f.length, seconds: +dur.toFixed(2),
      fps: +((f.length - 1) / dur).toFixed(1),
      p50: +d[Math.floor(d.length * .5)].toFixed(1),
      p95: +d[Math.floor(d.length * .95)].toFixed(1),
      over33: d.filter(function(x){ return x > 33.4; }).length
    };
  };
  return 'installed';
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let list = await targets();
  let page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  if (!page) {
    const w = list.find((t) => t.type === 'page' && /widget\.html/.test(t.url));
    if (!w) { console.log(JSON.stringify({ label, error: 'no widget', urls: list.map(t=>t.url) })); process.exit(1); }
    const wc = await connect(w.webSocketDebuggerUrl);
    const r = await wc.send('Runtime.evaluate', { expression: '(async function(){ var s = window.sentinel || {}; if (s.window && s.window.openDashboard) { await s.window.openDashboard(); return "dash"; } return "none"; })()', awaitPromise: true, returnByValue: true });
    wc.close();
    await sleep(2600);
    list = await targets();
    page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
    if (!page) { console.log(JSON.stringify({ label, error: 'no dashboard', opener: r && r.result, urls: list.map(t=>t.url) })); process.exit(1); }
  }
  const c = await connect(page.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Page.bringToFront');
  await c.send('Runtime.enable');
  await c.send('Performance.enable');
  await sleep(1200);
  await c.send('Runtime.evaluate', { expression: EVAL, returnByValue: true });

  let gpu = null;
  try { gpu = (await c.send('SystemInfo.getInfo')).gpu; } catch (e) { gpu = { error: String(e.message) }; }

  const env = (await c.send('Runtime.evaluate', { expression: 'JSON.stringify({dpr:devicePixelRatio, w:innerWidth, h:innerHeight, sw:screen.width, sh:screen.height, lg:document.documentElement.getAttribute("data-lg"), liquid:document.documentElement.getAttribute("data-liquid"), glass:document.documentElement.getAttribute("data-glass"), fx:document.documentElement.getAttribute("data-fx"), theme:document.documentElement.getAttribute("data-theme"), glassCount:document.querySelectorAll(".glass").length, backdrop:getComputedStyle(document.querySelector(".glass")).backdropFilter.slice(0,120)})', returnByValue: true })).result.value;
  const envObj = JSON.parse(env);

  async function measure(name, ms) {
    await c.send('Runtime.evaluate', { expression: 'window.__startPerf()' });
    await sleep(ms);
    return (await c.send('Runtime.evaluate', { expression: 'window.__stopPerf()', returnByValue: true })).result.value;
  }
  const out = { label, env: envObj, gpu: { devices: (gpu && gpu.devices || []).map(d => ({ vendor: d.vendorString, device: d.deviceString, vendorId: d.vendorId, deviceId: d.deviceId })), aux: gpu && gpu.auxAttributes, featureStatus: gpu && gpu.featureStatus } };

  out.p1_baseline_idle = await measure('baseline', 2600);

  // scroll under baseline
  const metrics = (await c.send('Page.getLayoutMetrics')).cssLayoutViewport;
  const x = Math.round(metrics.clientWidth * 0.6);
  const y = Math.round(metrics.clientHeight * 0.55);
  await c.send('Runtime.evaluate', { expression: 'window.__startPerf()' });
  for (let i = 0; i < 40; i++) {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: i % 2 ? 120 : -120, modifiers: 0, pointerType: 'mouse' });
    await sleep(16);
  }
  await sleep(400);
  out.p1_baseline_scroll = (await c.send('Runtime.evaluate', { expression: 'window.__stopPerf()', returnByValue: true })).result.value;

  // phase 2: pause all animations (visuals stay, no motion)
  await c.send('Runtime.evaluate', { expression: 'window.__pauseTag = document.createElement("style"); window.__pauseTag.textContent = "*,*::before,*::after{animation-play-state:paused !important; transition:none !important}"; document.head.appendChild(window.__pauseTag);' });
  await sleep(900);
  out.p2_paused_idle = await measure('paused', 2600);

  // phase 3: also remove backdrop blur everywhere
  await c.send('Runtime.evaluate', { expression: 'window.__nobf = document.createElement("style"); window.__nobf.textContent = ".glass,.quick,.titlebar,.sidebar,.mode-card,.theme-card,.widget::after{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}"; document.head.appendChild(window.__nobf);' });
  await sleep(900);
  out.p3_nobackdrop_idle = await measure('nobackdrop', 2600);

  // phase 4: restore blur, but hide the huge blurred aurora layer
  await c.send('Runtime.evaluate', { expression: 'window.__nobf.remove(); var a=document.querySelector(".aurora"); if(a) a.style.display="none"; var g=document.querySelector(".grain"); if(g) g.style.display="none"; var pg=document.querySelector(".pointer-glow"); if(pg) pg.style.display="none";' });
  await sleep(900);
  out.p4_blur_noaurora_idle = await measure('blur-noaurora', 2600);

  const pm = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  out.perf = Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','JSHeapUsedSize','Nodes','LayoutCount','RecalcStyleCount'].filter(k => pm[k] != null).map(k => [k, pm[k]]));
  console.log(JSON.stringify(out, null, 1));
  c.close();
  process.exit(0);
})().catch((e) => { console.log(JSON.stringify({ label, error: String(e && e.message || e) })); process.exit(1); });
