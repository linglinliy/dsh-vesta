# 发布到 GitHub（含"让我自己推"的条件）

本仓库当前**没有**纳入 git，也没有任何 GitHub 凭据。要让我（agent）完成推送，需要满足两个外部条件：

## 你需要做的最小准备

### 1) 安装 git（Windows）

```powershell
winget install --id Git.Git -e --source winget
```

装完后新开一个终端，`git --version` 应能输出版本号。

### 2) 提供一个只在本次会话生效的令牌

**不要**把 token 贴进聊天窗口（会进入对话记录）。推荐做法——在同一终端里设置环境变量再启动/重启 DSH：

```powershell
# 细粒度 PAT，只需 "Contents: Read and write" + "Administration: Read and write"（建仓库用）
$env:GH_TOKEN = 'github_pat_xxx'
```

或者在装了 GitHub CLI 的情况下用交互登录（凭据由 gh 自己保管，不需要把 token 给我）：

```powershell
winget install --id GitHub.cli -e --source winget
gh auth login          # 选 GitHub.com → HTTPS → 浏览器登录
gh auth setup-git      # 让 git push 用 gh 的凭据
```

### 3) 告诉我仓库归属

例如 `owner/repo`（可以是已存在的空仓库，也可以让我用 `gh repo create` 新建）。**私有仓库也可以**，我不需要读取权限以外的任何东西。

> 这三步做完后，我就能在本会话里执行 `git init / commit / remote add / push`，并把结果（commit hash、远端地址）回报给你。

## 我已经做完的发布前准备

| 项 | 状态 |
|---|---|
| 版本号 | 已改为 **0.0.1**（`package.json`） |
| 许可证 | 新增 `LICENSE`（MIT + 第三方组件说明） |
| 免责声明 | 新增 `DISCLAIMER.md`（7 节，含 VESTA/VASP 许可证、结果正确性、Windows 限定、隐私） |
| 更新记录 | 新增 `CHANGELOG.md`（0.0.1 首个公开版本） |
| 忽略规则 | 新增 `.gitignore`（运行产物、表格、本地 HTML 等） |
| 敏感信息 | 已脱敏：本机用户名/中文目录/数据集名/临时目录 → 占位符；测试改为从文件位置推导路径；示例配置与 `cordis.patch.yml` 不再带本机安装路径 |
| 测试 | `node scripts/selfcheck.mjs` **58/58**（生成器部分需 `VASP_FIXTURE_ROOT`，未设时明确跳过） |

## 发布前你最好再看一眼

```powershell
# 1) 敏感信息复查（会列出用户名、盘符路径、项目名、token/邮箱）
node -e "…"   # 见仓库 docs/PUBLISHING.md 中的扫描脚本，或直接肉眼查 README/docs 里的 <占位符>

# 2) 体积确认（vendor/ 里 three.js 约 1.2 MB；不应出现 node_modules）
git status --short

# 3) 自检
node scripts/selfcheck.mjs
```

## 手动推送（如果你不想把 token 交给我）

```bash
cd <插件目录>
git init -b main
git add -A
git commit -m "feat: dsh-vesta 0.0.1 — drive local VESTA + VASP post-processing"
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

## 已知的发布取舍（提前说明）

1. `package.json` 的 `name` 仍是 `@local/dsh-vesta`：DSH 的 `cordis.patch.yml` 按这个名字挂载，改名会让本地安装失效；如果你要在 npm 发布，需要同步改 patch 与安装方式。
2. `core.js` 的可执行文件候选列表里保留了一个常见安装路径示例（`D:\VESTA-win64\VESTA.exe`）。它不是敏感信息，但如果你介意，可以把这一项删掉——本机会因此回退到 `VESTA_EXE` 环境变量。
3. `win/vesta-ui.ps1` 里含 Win32 调用；某些杀毒软件可能会对"向其他进程窗口发消息"报警，属预期行为。
4. 仓库不含任何真实计算输出；测试里需要真实数据的用例在缺少环境变量时会**跳过**（不是失败）。
