'use strict';
/* StarWhisper Sentinel — liquid glass lens layer (v3).

   Chromium supports SVG filter references inside backdrop-filter, so the lens
   refraction is applied to the real backdrop (wallpaper + tint + aurora) rather
   than a duplicated overlay: an SDF displacement map bends the rim, a gentle
   radial dome magnifies the interior, and three slightly different scales feed
   R/G/B for chromatic dispersion — the look of a thick, bevelled glass slab.

   Maps are generated once per aspect bucket so the rim band stays the same
   optical width on wide cards and on nearly square ones. Technique inspired by
   shuding/liquid-glass, rdev/liquid-glass-react and ybouane/liquidglass. */

(function () {
  const NS = 'http://www.w3.org/2000/svg';

  /* ---- rounded-rect signed distance field (pixels) ---- */
  function sdfRoundRect(px, py, hw, hh, r) {
    const qx = Math.abs(px) - hw + r;
    const qy = Math.abs(py) - hh + r;
    return Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) + Math.min(Math.max(qx, qy), 0) - r;
  }

  /* ---- displacement map for one aspect bucket ----
     rim: gaussian band just inside the edge, sampling pushes inward so the
     backdrop appears compressed into the bevelled border.
     dome: tiny radial magnification, continuous at the rim (no seam). */
  function buildLensMap(W, H) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    const data = img.data;
    const hw = W / 2, hh = H / 2;
    const rad = Math.min(0.09 * H, hw * 0.5);
    const band = 0.085 * hh;         // falloff width of the bevelled rim
    const edge = 0.042 * hh;         // rim peak sits slightly inside the edge
    const gain = 0.60;               // rim strength (channel units, 0.5 = scale px)
    const dome = 0.09;               // faint centre magnification, mostly flat interior
    const d = new Float32Array(W * H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        d[y * W + x] = sdfRoundRect(x + 0.5 - hw, y + 0.5 - hh, hw, hh, rad);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sd = d[y * W + x];
        const xl = x > 0 ? x - 1 : x, xr = x < W - 1 ? x + 1 : x;
        const yu = y > 0 ? y - 1 : y, yd = y < H - 1 ? y + 1 : y;
        const gx = d[y * W + xr] - d[y * W + xl];
        const gy = d[yd * W + x] - d[yu * W + x];
        const gl = Math.hypot(gx, gy) || 1;
        const nx = gx / gl, ny = gy / gl;
        const rim = Math.exp(-(((sd + edge) / band) ** 2));
        const inside = Math.max(0, Math.min(1, -sd / (0.9 * hh)));
        const mx = (x + 0.5 - hw) / hw;
        const my = (y + 0.5 - hh) / hh;
        const dx = -nx * rim * gain - mx * inside * dome;
        const dy = -ny * rim * gain - my * inside * dome;
        const i = (y * W + x) * 4;
        data[i] = Math.max(0, Math.min(255, Math.round((0.5 + dx) * 255)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round((0.5 + dy) * 255)));
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  /* ---- svg filter helpers ---- */
  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  const CH_R = '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0';
  const CH_G = '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0';
  const CH_B = '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0';

  function makeFilter(id, uri, scale, chroma) {
    const f = el('filter', {
      id, x: '-16%', y: '-16%', width: '132%', height: '132%',
      'color-interpolation-filters': 'sRGB',
    });
    f.appendChild(el('feImage', {
      href: uri, x: '0', y: '0', width: '100%', height: '100%',
      preserveAspectRatio: 'none', result: 'MAP',
    }));
    if (!chroma) {
      f.appendChild(el('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'MAP', scale, xChannelSelector: 'R', yChannelSelector: 'G',
      }));
      return f;
    }
    const spread = 0.05;
    const scales = [scale * (1 + spread), scale, scale * (1 - spread)];
    const chans = [CH_R, CH_G, CH_B];
    const outs = ['CR', 'CG', 'CB'];
    for (let i = 0; i < 3; i++) {
      f.appendChild(el('feDisplacementMap', {
        in: 'SourceGraphic', in2: 'MAP', scale: scales[i].toFixed(2),
        xChannelSelector: 'R', yChannelSelector: 'G', result: 'D' + i,
      }));
      f.appendChild(el('feColorMatrix', { in: 'D' + i, type: 'matrix', values: chans[i], result: outs[i] }));
    }
    f.appendChild(el('feBlend', { in: 'CR', in2: 'CG', mode: 'screen', result: 'RG' }));
    f.appendChild(el('feBlend', { in: 'RG', in2: 'CB', mode: 'screen' }));
    return f;
  }

  /* ---- aspect buckets: the same lens map serves every element whose
     width/height ratio is closest to the bucket ---- */
  const RATIOS = [0.95, 1.3, 1.65, 2.05, 2.6, 3.6];
  const MAP_H = 176;
  const PANEL_SCALE = [104, 78, 126];
  const LEVEL_SUFFIX = ['', '-c', '-r'];

  let ready = false;
  let observer = null;
  const tracked = new Set();

  function bucketFor(w, h) {
    const ratio = w / Math.max(1, h);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < RATIOS.length; i++) {
      const dd = Math.abs(Math.log(ratio / RATIOS[i]));
      if (dd < bestD) { bestD = dd; best = i; }
    }
    return best;
  }

  function decorate(node, kind) {
    if (!(node instanceof HTMLElement)) return;
    if (kind === 'quick') {
      node.style.setProperty('--f-s', 'url(#lg-lens-s)');
      node.style.setProperty('--f-c', 'url(#lg-lens-sc)');
      node.style.setProperty('--f-r', 'url(#lg-lens-sr)');
      return;
    }
    const r = node.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    const b = bucketFor(r.width, r.height);
    if (node.__lensBucket === b) return;
    node.__lensBucket = b;
    node.style.setProperty('--f-s', 'url(#lg-lens-' + b + ')');
    node.style.setProperty('--f-c', 'url(#lg-lens-c' + b + ')');
    node.style.setProperty('--f-r', 'url(#lg-lens-r' + b + ')');
  }

  function track() {
    document.querySelectorAll('.glass').forEach((n) => { if (!tracked.has(n)) { tracked.add(n); observer && observer.observe(n); } decorate(n, 'panel'); });
    document.querySelectorAll('.quick').forEach((n) => { if (!tracked.has(n)) { tracked.add(n); observer && observer.observe(n); } decorate(n, 'quick'); });
  }

  function mount() {
    if (ready || !document.body) return;
    ready = true;
    try {
      const svg = el('svg', { class: 'lg-defs', 'aria-hidden': 'true', width: '0', height: '0' });
      const defs = el('defs', {});
      for (let i = 0; i < RATIOS.length; i++) {
        const W = Math.max(72, Math.round(MAP_H * RATIOS[i]));
        const uri = buildLensMap(W, MAP_H);
        for (let l = 0; l < 3; l++) {
          defs.appendChild(makeFilter('lg-lens' + LEVEL_SUFFIX[l] + i, uri, PANEL_SCALE[l], true));
        }
      }
      const widgetUri = buildLensMap(Math.round(MAP_H * 1.3), MAP_H);
      defs.appendChild(makeFilter('lg-lens-w', widgetUri, 22, true));
      defs.appendChild(makeFilter('lg-lens-wc', widgetUri, 16, true));
      defs.appendChild(makeFilter('lg-lens-wr', widgetUri, 30, true));
      const tileUri = buildLensMap(Math.round(MAP_H * 1.65), MAP_H);
      defs.appendChild(makeFilter('lg-lens-s', tileUri, 12, false));
      defs.appendChild(makeFilter('lg-lens-sc', tileUri, 9, false));
      defs.appendChild(makeFilter('lg-lens-sr', tileUri, 17, false));
      svg.appendChild(defs);
      document.body.appendChild(svg);
      document.documentElement.setAttribute('data-lg', '1');

      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver((entries) => {
          for (const e of entries) {
            const t = e.target;
            decorate(t, t.classList.contains('quick') ? 'quick' : 'panel');
          }
        });
      }
      track();
      new MutationObserver(track).observe(document.body, { childList: true, subtree: true });
      window.addEventListener('resize', () => { tracked.forEach((n) => decorate(n, n.classList.contains('quick') ? 'quick' : 'panel')); });
    } catch (e) {
      console.error('liquid glass init failed', e);
      document.documentElement.removeAttribute('data-lg');
    }
  }

  /* 只为「玻璃玻玻璃」主题生成滤镜：像素主题不加载这套 SDF 位移贴图，省掉启动开销。
     主题切到 glass 时由 app.js 调用 window.LiquidGlass.mount() 懒加载。 */
  function autoMount() {
    if (document.documentElement.getAttribute('data-theme') === 'glass') mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount);
  else autoMount();

  window.LiquidGlass = { mount, buildLensMap };
})();
