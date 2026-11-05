'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { app, nativeImage } = require('electron');

function runPowerShell(script, env = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      timeout: 15000, windowsHide: true, env: { ...process.env, ...env }
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').trim() || '设置壁纸失败'));
      resolve((stdout || '').trim());
    });
  });
}

function expandEnv(p) {
  return String(p || '').replace(/%([^%]+)%/g, (_, k) => process.env[k] || '');
}

async function getCurrentWallpaper() {
  try {
    const out = await runPowerShell('(Get-ItemProperty "HKCU:\\Control Panel\\Desktop" -Name WallPaper -ErrorAction SilentlyContinue).WallPaper');
    const p = expandEnv(out.replace(/^"|"$/g, ''));
    if (p && fs.existsSync(p)) return p;
  } catch {}
  const fallback = 'C:\\Windows\\web\\wallpaper\\Windows\\img19.jpg';
  return fs.existsSync(fallback) ? fallback : '';
}

const STYLE = { fill: 10, fit: 6, stretch: 2, tile: 1, center: 0 };

async function setWallpaper(filePath, style = 10) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('壁纸文件不存在');
  const styleVal = typeof style === 'string' ? (STYLE[style] ?? 10) : style;
  const tile = styleVal === 1 ? 1 : 0;
  const script = [
    '$ErrorActionPreference="Stop"',
    '$p=$env:STAR_WALLPAPER',
    'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public class StarWall { [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int SystemParametersInfo(int a,int b,string c,int d); }\'',
    'Set-ItemProperty -Path "HKCU:\\Control Panel\\Desktop" -Name WallpaperStyle -Value $env:STAR_STYLE',
    'Set-ItemProperty -Path "HKCU:\\Control Panel\\Desktop" -Name TileWallpaper -Value $env:STAR_TILE',
    '[StarWall]::SystemParametersInfo(20,0,$p,3) | Out-Null',
    'Write-Output "OK"'
  ].join('; ');
  const out = await runPowerShell(script, { STAR_WALLPAPER: filePath, STAR_STYLE: String(styleVal), STAR_TILE: String(tile) });
  if (!out.includes('OK')) throw new Error('系统未确认壁纸设置');
  return true;
}

function wallpaperDir() {
  const dir = path.join(app.getPath('pictures'), 'StarSentinel');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function saveDataUrl(dataUrl, name = 'generated') {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('无效的图片数据');
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const safe = String(name).replace(/[^\w\-]+/g, '_').slice(0, 40) || 'generated';
  const file = path.join(wallpaperDir(), safe + '-' + Date.now() + '.' + ext);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

function thumbDataUrl(filePath, width = 640) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    let img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return '';
    const size = img.getSize();
    if (size.width > width) img = img.resize({ width, quality: 'good' });
    return img.toDataURL();
  } catch { return ''; }
}

function listWallpapers() {
  const roots = [
    'C:\\Windows\\web\\wallpaper',
    path.join(app.getPath('pictures'), 'StarSentinel'),
    app.getPath('pictures')
  ];
  const out = [];
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth > 2) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(jpe?g|png|webp|bmp)$/i.test(e.name)) {
        const key = full.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const st = fs.statSync(full);
          if (st.size < 30 * 1024) continue;
          out.push({ path: full, name: path.basename(full, path.extname(full)), dir: path.basename(path.dirname(full)), size: st.size, mtime: st.mtimeMs });
        } catch {}
      }
    }
  };
  for (const r of roots) walk(r, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, 60);
}

module.exports = { getCurrentWallpaper, setWallpaper, saveDataUrl, thumbDataUrl, listWallpapers, wallpaperDir, STYLE };
