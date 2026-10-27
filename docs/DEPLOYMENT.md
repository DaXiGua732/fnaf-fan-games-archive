# 部署与发布

## 1. 两个仓库

| 仓库 | 内容 | 写权限 |
| --- | --- | --- |
| `DaXiGua732/fnaf-fan-games-archive` | 代码（本仓） | 只有站长 |
| `DaXiGua732/fnaf-fan-games-data` | `db.json` + `images/` | 站长 + 后台管理员（细粒度令牌） |

「管理员能改数据、碰不到代码」由**仓库权限与令牌权限**保证，不靠应用层判断。

## 2. GitHub Actions

`.github/workflows/deploy.yml`：push 到 `main`、手动触发、每小时定时（`17 * * * *`）、
或 `repository_dispatch`（`data-updated`）→

```
npm ci --ignore-scripts
→ data:pull（失败不阻断，保留仓库快照）
→ typecheck
→ check:data --strict
→ test:gamejolt / test:catalog / test:data-quality
→ build:extension
→ selftest
→ test:ui:ci-launcher
→ test:ui:ci（真实 Chromium）
→ smoke
→ build（注入 VITE_SUPABASE_*）
→ configure-pages → upload-pages-artifact → deploy-pages
```

部署前跑全部门禁是刻意的：保证线上永远不会出现「编译通过但页面白屏」的版本。
UI 测试失败会阻断部署，并上传 `.tmp/ui-shots/` 与 `.tmp/ui-ci-vite.log`。

Pages 配置：`build_type = workflow`（仓库未开启时 `configure-pages` 会自动开启）。

### 数据更新后的上线时机

数据仓的提交**不会**触发代码仓 workflow。公开页在挂载 / 切回 / 标签页重新可见时
同步最新 `db.json`，所以后台改完通常不需要等构建；每小时定时构建只负责刷新首屏 / 离线快照。
要立刻重建：Actions → Deploy to GitHub Pages → Run workflow，或发 `repository_dispatch`。

### 环境变量

| 名称 | 位置 | 说明 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Actions **Variables** | 催资源全站共享；缺省 = 本机模式 |
| `VITE_SUPABASE_ANON_KEY` | Actions **Variables** | anon public key 本来公开；**绝不要 `service_role`** |

本地覆盖用 `.env.local`（不提交）。`VITE_*` 是构建期变量，改完必须重启 dev / 重新 build。

## 3. `base` 路径

`vite.config.ts` 按 command 区分：

```ts
base: command === 'build' ? '/fnaf-fan-games-archive/' : '/'
```

生产产物带正确子路径前缀，本地开发仍是 `http://localhost:5173/`。
**仓库改名必须同步修改这里的字符串**，否则资源全 404。

## 4. 发布代码

常规路径：在自己的终端 `git push origin main`。

### 沙箱网络受限时的兜底（GitHub API）

默认沙箱代理只放行 `api.github.com`，`github.com:443` 连不上，`git push` / `git fetch`
会超时。在允许网络的环境（用户自己的终端，或让代理以**免沙箱**方式执行）可以直接推送；
仍不行时用 API 推送：

```bash
# 1. 暂存并生成 tree 对象（不需要先建本地提交）
git add -A
T=$(git write-tree)

# 2. 导出提交内容 —— 用 git archive 取精确内容，不要读磁盘（行尾差异会导致 blob 不一致）
mkdir -p .tmp/new && git archive "$T" | tar -x -C .tmp/new
git ls-tree -r "$T" > .tmp/ls-tree-new.txt

# 3. 用 Node 脚本拼 JSON（Node 只拼 JSON，绝不 spawn 进程 —— 本环境 spawnSync 会 EBUSY）
#    payload: { "tree": [{ path, mode:"100644", type:"blob", content }] }

# 4. 落库
gh api -X POST repos/DaXiGua732/fnaf-fan-games-archive/git/trees --input .tmp/tree-payload-new.json
gh api -X POST repos/DaXiGua732/fnaf-fan-games-archive/git/commits \
  -f "message=..." -f "tree=$TREE_SHA" -F "parents[]=$PARENT_SHA" \
  -f "author[name]=DaXiGua732" -f "author[email]=91938727+DaXiGua732@users.noreply.github.com"
gh api -X PATCH repos/DaXiGua732/fnaf-fan-games-archive/git/refs/heads/main \
  -f "sha=$COMMIT_SHA" -F force=true
```

**校验点**：API 返回的 tree SHA 必须等于 `git write-tree` 的结果。不等就说明内容有偏差，别往下走。

首次提交（仓库为空）：`git/commits` **不带 `parents`**；`refs` 用 `POST` 创建。

### 让本地与远程 SHA 一致

API 创建的提交在本地没有对象，`git update-ref` 会报
`trying to write ref ... with nonexistent object`，而 `git fetch` 又不可用。
解法：在本地重建字节级相同的提交对象。

```bash
TS=$(date -u -d "<远程 author.date>" +%s)
{ printf 'tree %s\n' "$TREE"
  printf 'parent %s\n' "$PARENT"          # 根提交时省略这一行
  printf 'author %s <%s> %s +0800\n' "$NAME" "$MAIL" "$TS"
  printf 'committer %s <%s> %s +0800\n' "$NAME" "$MAIL" "$TS"
  printf '\n'
  printf '%s' "$MSG"; } > obj.txt          # ← 消息结尾【不带】换行
git hash-object -t commit -w --stdin < obj.txt
git update-ref refs/heads/main <得到的 SHA>
git reset --mixed
```

两条决定 SHA 能否命中的隐藏规则：

- GitHub 存储的时区偏移是 **`+0800`**
- 提交消息**结尾没有换行符**（`git commit-tree -m` 会自动加，所以不能用它）

## 5. 回滚

- **数据**：对数据仓做 `git revert`（数据仓历史就是完整审计日志）。
  远程模式后台没有「恢复出厂数据」。
- **代码**：`git revert` 后重新推送，Actions 会重新验证并部署。
- **本机存档**：数据异常时用后台「数据现状」区的「恢复出厂数据」（仅本地模式）。
