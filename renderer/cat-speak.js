/* 中文猫猫语（Cat speak）——把界面文案换成铲屎官的猫猫语。
   只在 html[data-lang="cat"] 时生效；静态文案与运行时更新的文案都处理（MutationObserver）。
   终端、代码、输入框、画布以及标了 data-cat-skip 的区域一律跳过。 */
(function () {
  'use strict';

  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

  // 专有名词不喵化（否则读不懂 / 撑破布局）
  const KEEP = new Set([
    '星语哨兵', '像素', '玻璃玻玻璃', '像素 · Material You', 'Liquid Glass · Backdrop',
    'Pixel · Material You', 'StarWhisper Sentinel', 'STARWHISPER SENTINEL',
    '简体中文', '中文猫猫语', '宝塔 API', 'SSH', 'CPU', 'xterm',
    // 分段控件里的短选项：加「喵~」会把 86px 的按钮挤成两行
    '跟随系统', '浅色', '深色'
  ]);

  // 猫猫词典（长词在前，按顺序替换）
  const DICT = [
    ['服务器终端', '猫舍爪爪终端'],
    ['服务器', '猫舍'],
    ['用户名', '铲屎官名'],
    ['用户', '铲屎官'],
    ['终端', '爪爪终端'],
    ['容器', '小窝'],
    ['网站', '领地'],
    ['性能', '体力'],
    ['数据源', '猫粮来源'],
    ['演示模式', '假猫粮模式'],
    ['立即刷新', '立刻巡逻'],
    ['刷新', '巡逻'],
    ['运行中', '跑得欢'],
    ['已停止', '睡着了'],
    ['监控', '盯梢'],
    ['工作', '抓老鼠'],
    ['学习', '抓老鼠'],
    ['睡觉', '摊猫饼'],
    ['吃饭', '恰饭饭'],
    ['喝水', '喝水水'],
    ['出门', '巡视江山'],
    ['朋友', '其他喵喵'],
    ['手机', '发光小方块'],
    ['电脑', '大板子'],
    ['密码', '爪印密码'],
    ['密钥', '小鱼干钥匙']
  ];

  // 只有页面大标题才配 emoji，避免侧栏 / 按钮被撑开
  const EMOJI = {
    '服务器概览': '🐾', '概览': '🐾', '性能': '⚡', '容器': '📦',
    '网站': '🌐', '终端': '🐾', '设置': '⚙️'
  };

  // 一次扫描完成替换：先匹配长词，避免「服务器终端→猫舍爪爪终端」再被「终端→爪爪终端」二次替换
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  const DICT_MAP = new Map(DICT);
  const DICT_RE = new RegExp(
    DICT.map(function (d) { return d[0]; }).sort(function (a, b) { return b.length - a.length; }).map(escapeRe).join('|'),
    'g'
  );

  function catify(text, withEmoji) {
    const raw = String(text == null ? '' : text);
    if (!CJK.test(raw)) return raw;
    const lead = raw.match(/^\s*/)[0];
    const tail = raw.match(/\s*$/)[0];
    const core = raw.trim();
    if (!core || KEEP.has(core) || core.indexOf('喵') >= 0) return raw;
    let out = core.replace(DICT_RE, function (m) { return DICT_MAP.get(m); });
    out = out.replace(/。/g, '喵~ ').replace(/！/g, '喵！').replace(/？/g, '喵？');
    out = out.replace(/\s+/g, ' ').trim();
    // 只在「以汉字收尾」的句子上补「喵~」：数字、英文、括号、冒号之类收尾的不硬塞，
    // 免得出现「2 核 · 0.00喵~」「已保存（留空保持不变）喵~」「关闭主界面时：喵~」。
    if (!/喵[~！？]?$/.test(out) && /[\u4e00-\u9fff]$/.test(out)) out += '喵~';
    if (withEmoji && EMOJI[core]) out += ' ' + EMOJI[core];
    return lead + out + tail;
  }

  const SKIP_SEL = 'script,style,pre,code,textarea,canvas,[data-cat-skip],#termBody,.xterm';
  const ATTRS = ['placeholder', 'title', 'aria-label'];

  let enabled = false;
  let observer = null;
  const textRec = new Map(); // Text -> { src, out }
  const attrRec = new Map(); // Element -> { attr: { src, out } }

  function skipped(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && el.closest && el.closest(SKIP_SEL));
  }

  function inHeading(node) {
    const el = node && node.parentElement;
    return !!(el && el.closest && el.closest('h1,h2'));
  }

  function applyText(node) {
    const cur = node.nodeValue;
    if (!cur) return;
    const rec = textRec.get(node);
    if (rec && cur === rec.out) return;
    const out = catify(cur, inHeading(node));
    if (!out || out === cur) return;
    textRec.set(node, { src: cur, out: out });
    node.nodeValue = out;
  }

  function applyAttrs(el) {
    if (!el || el.nodeType !== 1) return;
    let bag = attrRec.get(el);
    for (let i = 0; i < ATTRS.length; i++) {
      const name = ATTRS[i];
      if (!el.hasAttribute(name)) continue;
      const cur = el.getAttribute(name);
      const out = catify(cur, false);
      if (!out || out === cur) continue;
      if (!bag) { bag = {}; attrRec.set(el, bag); }
      bag[name] = { src: cur, out: out };
      el.setAttribute(name, out);
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!skipped(root)) applyText(root); return; }
    if (root.nodeType !== 1 || skipped(root)) return;
    applyAttrs(root);
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) applyAttrs(all[i]);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = tw.nextNode())) if (!skipped(n)) applyText(n);
  }

  function restore() {
    textRec.forEach(function (rec, node) {
      if (node.isConnected && node.nodeValue === rec.out) node.nodeValue = rec.src;
    });
    attrRec.forEach(function (bag, el) {
      if (!el.isConnected) return;
      Object.keys(bag).forEach(function (name) { el.setAttribute(name, bag[name].src); });
    });
    textRec.clear();
    attrRec.clear();
  }

  function setEnabled(on) {
    const next = !!on;
    if (next === enabled) return;
    enabled = next;
    document.documentElement.setAttribute('data-lang', enabled ? 'cat' : 'zh');
    if (enabled) {
      walk(document.body);
      observer = new MutationObserver(function (muts) {
        for (let i = 0; i < muts.length; i++) {
          const m = muts[i];
          if (m.type === 'characterData') { if (!skipped(m.target)) applyText(m.target); }
          else if (m.type === 'childList') {
            for (let j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
          } else if (m.type === 'attributes') { applyAttrs(m.target); }
        }
      });
      observer.observe(document.documentElement, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ATTRS
      });
    } else {
      if (observer) { observer.disconnect(); observer = null; }
      restore();
    }
  }

  window.CatSpeak = { catify: catify, setEnabled: setEnabled, isEnabled: function () { return enabled; } };
})();
