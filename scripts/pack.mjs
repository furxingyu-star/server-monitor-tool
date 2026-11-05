import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'build', 'app');
const pnpm = path.join(root, 'node_modules', '.pnpm');

// pnpm 的符号链接会让 @electron/packager 的依赖遍历失败，这里手工摊平运行时依赖
const copy = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: true });
const pkgDir = (pattern) => {
  const name = fs.readdirSync(pnpm).find((d) => d.startsWith(pattern));
  if (!name) throw new Error('package not found: ' + pattern);
  return path.join(pnpm, name, 'node_modules');
};

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const item of ['package.json', 'electron', 'renderer', 'assets', 'README.md']) {
  copy(path.join(root, item), path.join(stage, item));
}
const nm = path.join(stage, 'node_modules');
fs.mkdirSync(path.join(nm, '@xterm'), { recursive: true });
copy(path.join(pkgDir('@xterm+xterm@'), '@xterm', 'xterm'), path.join(nm, '@xterm', 'xterm'));
copy(path.join(pkgDir('@xterm+addon-fit@'), '@xterm', 'addon-fit'), path.join(nm, '@xterm', 'addon-fit'));
for (const dep of ['ssh2', 'asn1', 'bcrypt-pbkdf', 'safer-buffer', 'tweetnacl']) {
  copy(path.join(pkgDir(dep + '@'), dep), path.join(nm, dep));
}
console.log('staged ->', stage);

const outDir = process.env.SENTINEL_OUT_DIR || 'dist';
const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const out = await packager({
  dir: stage,
  out: path.join(root, outDir),
  name: 'StarSentinel',
  executableName: 'StarSentinel',
  platform: 'win32',
  arch: 'x64',
  icon: path.join(root, 'assets', 'icon.ico'),
  electronZipDir: process.env.ELECTRON_ZIP_DIR || undefined,
  asar: true,
  overwrite: true,
  prune: false,
  appVersion,
  win32metadata: {
    CompanyName: 'StarWhisper',
    FileDescription: '星语哨兵 · StarWhisper Sentinel',
    ProductName: '星语哨兵',
    InternalName: 'StarSentinel',
    OriginalFilename: 'StarSentinel.exe'
  },
  ignore: [/^\/shots(\/|$)/, /^\/build(\/|$)/, /^\/dist(\/|$)/, /^\/release(\/|$)/]
});

console.log('打包完成：');
for (const p of out) console.log('  ' + p);
