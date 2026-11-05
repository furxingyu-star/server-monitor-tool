'use strict';
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { nativeImage } = require('electron');

// 只读取当前桌面壁纸：用作界面背景与像素主题的取色来源，不再提供更换壁纸的能力。

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      timeout: 15000, windowsHide: true
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').trim() || '读取壁纸失败'));
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

module.exports = { getCurrentWallpaper, thumbDataUrl };
