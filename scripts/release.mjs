#!/usr/bin/env node
/**
 * 一条命令发版：打包 -> 压缩 -> 提交 -> 打 tag -> 推送 -> 创建 GitHub Release 并上传资产。
 *
 * 用法：
 *   node scripts/release.mjs                 完整发版（需要网络；推送走 git，上传资产需要 GITHUB_TOKEN）
 *   node scripts/release.mjs --dry-run       只打印将要做什么，不动任何东西
 *   node scripts/release.mjs --skip-pack     复用已有 dist/（已经打包过时）
 *   node scripts/release.mjs --skip-push     本地提交 + 打 tag，不推远端、不建 Release
 *
 * 上传资产需要环境变量 GITHUB_TOKEN（细粒度 PAT，仓库 Contents: Read and write）。
 * 没有 token 时会先把能做的都做完，再打印浏览器上传的手动步骤。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const skipPack = argv.includes('--skip-pack');
const skipPush = argv.includes('--skip-push');

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
const tag = 'v' + version;
const zipName = `star-sentinel-${tag}-win32-x64.zip`;
const zipPath = path.join(root, zipName);
const notesPath = path.join(root, 'docs', `release-notes-${tag}.md`);
const distDir = path.join(root, 'dist', 'StarSentinel-win32-x64');

const log = (...a) => console.log('[release]', ...a);
const die = (msg) => { console.error('[release] 失败：' + msg); process.exit(1); };
const run = (cmd, args, opts = {}) => {
  if (dryRun) { log('(dry-run) ' + [cmd, ...args].join(' ')); return ''; }
  return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
};
const tryRun = (cmd, args) => {
  try { return run(cmd, args); } catch { return null; }
};
// 只读查询（远端地址、tag、工作区状态）即使在 --dry-run 下也真的要跑
const readCmd = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
};

if (!fs.existsSync(notesPath)) die(`缺少发布说明 ${path.relative(root, notesPath)}，先写好再发版`);
const notes = fs.readFileSync(notesPath, 'utf8').trim();
log(`版本 ${version} -> tag ${tag}`);

if (!dryRun) {
  if (readCmd('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`])) die(`tag ${tag} 已存在，先把 package.json 版本号往上加`);
}

// 1. 打包 + 压缩
if (skipPack) {
  log('跳过打包，复用 dist/');
  if (!fs.existsSync(distDir) && !dryRun) die('dist/StarSentinel-win32-x64 不存在，去掉 --skip-pack');
} else {
  log('打包（scripts/pack.mjs）…');
  run(process.execPath, ['scripts/pack.mjs']);
}
log('压缩（scripts/make-release-zip.ps1）…');
run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/make-release-zip.ps1', '-Out', zipName]);
if (!dryRun) {
  if (!fs.existsSync(zipPath)) die('压缩产物不存在：' + zipName);
  log(`资产 ${zipName} ${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB`);
}

// 2. 提交 + tag
const dirty = readCmd('git', ['status', '--porcelain']) || '';
if (dirty) {
  log('工作区有改动，发版前会先提交：');
  for (const line of dirty.split('\n').slice(0, 20)) log('  ' + line);
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', `chore(release): ${tag}`]);
} else {
  log('工作区干净，跳过提交');
}
log(`打 tag ${tag}`);
run('git', ['tag', '-a', tag, '-m', `星语哨兵 ${tag}`]);

if (skipPush) { log('--skip-push：不推送'); process.exit(0); }

// 3. 推送
run('git', ['push', 'origin', 'HEAD']);
run('git', ['push', 'origin', tag]);

// 4. GitHub Release
const remote = readCmd('git', ['remote', 'get-url', 'origin']) || '';
const m = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
if (!m) die('无法从 origin 解析 owner/repo：' + remote);
const [, owner, repo] = m;
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const api = 'https://api.github.com';

async function gh(pathname, init = {}) {
  const res = await fetch(api + pathname, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'star-sentinel-release',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}

if (!token) {
  log('没有 GITHUB_TOKEN，没建 Release。手动步骤：');
  log(`  1) 打开 https://github.com/${owner}/${repo}/releases/new?tag=${tag}`);
  log(`  2) 标题填「星语哨兵 ${tag}」，说明粘贴 docs/release-notes-${tag}.md`);
  log(`  3) 上传 ${zipName}`);
  log('想以后自动上传，配一个细粒度 PAT 并 export GITHUB_TOKEN，详见 docs/release-process.md');
  process.exit(0);
}

if (dryRun) { log(`(dry-run) 会用 API 建 Release ${tag} 并上传 ${zipName}`); process.exit(0); }

log('创建 GitHub Release…');
let rel = await gh(`/repos/${owner}/${repo}/releases`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag_name: tag, name: `星语哨兵 ${tag}`, body: notes, draft: false, prerelease: false, make_latest: 'true' })
});
if (rel.status === 422) {
  log('Release 已存在，复用现有的');
  rel = await gh(`/repos/${owner}/${repo}/releases/tags/${tag}`);
}
if (rel.status >= 300 || !rel.json) die(`创建 Release 失败 (${rel.status})：${rel.text.slice(0, 300)}`);
const uploadUrl = String(rel.json.upload_url || '').replace(/\{\?name,label\}$/, '');
const releaseUrl = rel.json.html_url;

log('上传资产（' + zipName + '）…');
const body = fs.readFileSync(zipPath);
const up = await fetch(`${uploadUrl}?name=${encodeURIComponent(zipName)}`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/zip',
    'Content-Length': String(body.length),
    'User-Agent': 'star-sentinel-release'
  },
  body
});
if (up.status >= 300) {
  const t = await up.text();
  die(`上传失败 (${up.status})：${t.slice(0, 300)}`);
}
const asset = await up.json();
log(`完成：${releaseUrl}`);
log(`资产 ${asset.name} ${(asset.size / 1048576).toFixed(1)} MB`);
