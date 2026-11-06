# 发版流程（v1.7.3 起）

一条命令搞定打包、压缩、提交、打 tag、推送、建 Release、传资产：

```powershell
cd C:\Users\Administrator\Documents\deepseek-harness\default-workspace\star-sentinel
$env:GITHUB_TOKEN = "github_pat_xxx"   # 可选，见下文「上传资产」
node scripts/release.mjs
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--dry-run` | 只打印将要执行的步骤，不打包、不提交、不打 tag、不推送 |
| `--skip-pack` | 复用已有的 `dist\StarSentinel-win32-x64`（刚打过包时省 1–2 分钟） |
| `--skip-push` | 只在本地提交 + 打 tag，不推远端也不建 Release |

发版前必须准备好 `docs/release-notes-v<版本>.md`（脚本会把它作为 Release 说明），并把 `package.json` 的 `version` 改成新版本 —— 脚本从版本号推导 tag、zip 文件名和 Release 标题。

## 上传资产：为什么需要 GITHUB_TOKEN

- `git push` 走 SSH 密钥（本机 `~/.ssh/star_sentinel2` 对应的 GitHub SSH key），这条通道只能推代码和 tag。
- **Release 资产上传走 HTTPS API，SSH key 不适用**，必须用 Personal Access Token 或 `gh auth login` 的登录态。

配一个细粒度 PAT（一次性，约 1 分钟）：

1. GitHub → 右上头像 → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token。
2. Repository access：Only select repositories → `server-monitor-tool`。
3. Permissions → Repository permissions → **Contents: Read and write**（其余可全设 No access）。
4. 生成后复制 `github_pat_...`，在 PowerShell 里 `$env:GITHUB_TOKEN = "..."` 再跑 `node scripts/release.mjs`。

没有 token 时脚本会照常打包/提交/打 tag/推送，最后打印浏览器上传的手动步骤（152 MB 的包在本机 ~2 Mbps 上行时约 20 分钟）。

## 本机打包的两个环境坑

1. `ELECTRON_RUN_AS_NODE`：DSH 会话里这个变量是 1，直接启动 electron 会以纯 Node 模式跑并报 `main.js:40 TypeError`。PowerShell 里先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。
2. `@electron/get` 默认去 github.com 下载 electron 二进制，家里会超时。设本地缓存目录跳过下载：
   ```powershell
   $env:ELECTRON_ZIP_DIR = "C:\Users\Administrator\AppData\Local\electron\Cache\1ab0cf2cf1468b148f12015f260a50382295af0f5c29efd300dd4c4938b51db7"
   ```
3. 打包前先退出正在运行的 StarSentinel，否则 `dist\StarSentinel-win32-x64` 被占用：
   ```powershell
   Get-Process StarSentinel -ErrorAction SilentlyContinue | Stop-Process -Force
   ```

## 发版后自检

1. 侧栏页脚 / 设置页「关于」里的版本号是否为新版本。
2. `https://github.com/furxingyu-star/server-monitor-tool/releases/tag/v<版本>` 是否是 Latest，资产大小是否约 152 MB。
3. 桌面快捷方式指向 `dist\StarSentinel-win32-x64\StarSentinel.exe`，双击启动后确认只有**一个**主面板（跨副本单实例保护会在第二个副本启动时聚焦已有窗口并退出）。
