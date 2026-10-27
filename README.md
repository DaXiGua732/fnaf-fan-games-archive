# FNAF Fan Games Archive

Five Nights at Freddy's **同人游戏资源导航站**。纯前端静态站，零成本托管于 GitHub Pages，
资源统一跳转第三方网盘，视觉严格遵循 **Swiss International Style**（瑞士国际风格）。

| 项目信息 | |
| --- | --- |
| 线上地址 | https://daxigua732.github.io/fnaf-fan-games-archive/ |
| 代码仓库 | https://github.com/DaXiGua732/fnaf-fan-games-archive |
| 数据仓库 | https://github.com/DaXiGua732/fnaf-fan-games-data（`db.json` + `images/`） |
| 技术栈 | Vue 3 · Vite 6 · Tailwind CSS 3 · TypeScript · Playwright |
| 原始需求 | [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)（历史文档，评论区等已移除） |

> 新接手的人或 AI 上下文请先读 [`docs/HANDOVER.md`](docs/HANDOVER.md)：一页式交接地图
> （当前状态、数据流、运维命令、铁律、踩坑、缺口）。

## 能做什么

**公开站**：游戏库搜索、八维组合筛选、排序与分页；详情页（简介、截图灯箱、下载渠道与提取码复制）；
浅色 / 深色 + 5 种强调色主题；首页公开「催资源」榜单。

**后台**（`/#/admin`，GitHub 令牌登录）：作品增删改查与批量操作、标签与作者合并管理、
玩法 / 机制 / 平台词表、作品关系、图片上传（自动缩放 + WebP）、未保存草稿预览、
行内上下线与永久删除、GameJolt 半自动导入、只读资料质量检查。
数据写进**数据仓** `db.json`，保存一次即一次提交，git 历史就是审计与回滚手段。

## 快速开始

```bash
# --ignore-scripts 是必须的（原因见 docs/PITFALLS.md 第 1 条）
npm install --ignore-scripts

npm run dev      # → http://localhost:5173/
npm run verify   # 全部门禁，改完必须全绿
```

Node 22+。首次跑浏览器测试前执行一次 `npx playwright install chromium`。
本地首屏读的是 `src/data/db.json` 快照，要与线上对齐先跑 `npm run data:pull`。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（base = `/`） |
| `npm run build` / `preview` | 生产构建（base = `/fnaf-fan-games-archive/`）/ 预览产物 |
| `npm run typecheck` | `vue-tsc --noEmit` |
| `npm run selftest` | 深模块行为断言 + 源码静态守卫（不出网） |
| `npm run smoke` | SSR 逐路由渲染冒烟（防白屏） |
| `npm run test:ui` | Playwright 浏览器点击测试（需另开 dev server） |
| `npm run test:ui:ci` | 自动启动 / 清理 Vite 后跑同一套 UI 测试（verify / CI 使用） |
| `npm run test:ui:ci-launcher` | UI 启动器端口竞争回归 |
| `npm run test:gamejolt` | GameJolt 解析 / 网络层 / 扩展 ZIP 打包测试 |
| `npm run test:catalog` | 数据仓文档解析 / 序列化测试 |
| `npm run test:data-quality` | `check:data` 退出码契约 |
| `npm run check:data` | **只读**资料质量检查（`--file=` / `--json` / `--strict`） |
| `npm run data:pull` | 从数据仓拉取 `db.json` 快照 |
| `npm run build:extension` / `test:extension` | 构建浏览器扩展 / 扩展端到端测试（需系统 Chrome） |
| `npm run gamejolt:helper` | 本机 GameJolt 助手（`127.0.0.1:4317`，开发备用） |
| `npm run assets` | 按 `db.json` 重新生成占位图 |
| `npm run verify` | 以上门禁的完整串联，提交前必须全绿 |

## 目录结构

```
├── .github/workflows/deploy.yml   # Pages 部署：构建前跑完整质量门禁
├── docs/                          # 全部文档（架构 / 后台 / 数据 / 设计 / 测试 / 部署 …）
├── extension/                     # MV3 浏览器扩展：GameJolt 页面导出 ZIP
├── public/images/                 # 占位图（npm run assets 生成）
├── scripts/                       # 数据同步、selftest / smoke / UI 测试、扩展构建、质量检查
├── supabase/resource_requests.sql # 催资源：表 / RLS / 公开视图 / RPC
├── src/
│   ├── components/                # 公开站组件；admin/ 下为后台专用
│   ├── composables/               # 深模块（useGameLibrary / useAdminGames / useTheme …）
│   ├── config/                    # 催资源配置、初始词表
│   ├── data/db.json               # 构建期快照（唯一读入口是 localGameRepository）
│   ├── dev/                       # selftest 断言集
│   ├── layouts/                   # Layout（公开站）/ AdminLayout（后台），完全分离
│   ├── repositories/              # 数据访问层：index.ts 是唯一切换点
│   ├── router/ · services/ · styles/ · types/ · utils/ · views/
│   └── main.ts
├── tailwind.config.js             # 覆盖式配置：违规工具类不生成
└── vite.config.ts · vite.smoke.config.ts
```

## 改代码前必须知道的约束

1. **视觉红线**：零圆角、零阴影、零渐变、纯无衬线、文本左对齐、悬停只改颜色。
   已被三层机制从编译层禁掉，不要试图绕过（见 [`docs/DESIGN.md`](docs/DESIGN.md)）。
2. **`.vue` 里禁止手写 `.filter()` / `.sort()`**，数据加工一律在深模块内
   （`useGameLibrary` 前台 / `useAdminGames` 后台）。
3. **后台只通过 `GameRepository` 读写数据**；只有 `repositories/index.ts` 实例化仓储，
   只有 `localGameRepository.ts` 读 `db.json`（有静态守卫扫描）。
4. **前台可见性判据唯一**：`status === 'published' && !archived`，收敛在 `isPubliclyVisible()`。
5. **断言不得编码数据内容** —— 管理员随时会改数据，写死标题 / 数量 = 假失败。
6. **新增数据字段一律 optional**，`status` 缺省 `published`。
7. **搜索输入框走 `useSearchField`**，不要用 `:value` + `@input`（会重置光标）。

完整论证与边界见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 与 [`docs/TESTING.md`](docs/TESTING.md)。

## 部署

推送到 `main` 会触发 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)：
`data:pull` → 全部门禁 → `build` → GitHub Pages。数据仓的提交不触发本仓 workflow，
但公开页挂载 / 切回时会自动同步最新 `db.json`；每小时一次的定时构建只负责刷新快照。

细节（base 路径、Actions Variables、网络受限时的 API 发布方式）见
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | 交接地图：状态、数据流、命令、决策索引、铁律、缺口 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 数据流、仓储层、深模块、路由、资源路径 |
| [`docs/ADMIN.md`](docs/ADMIN.md) | 后台：路由、认证、写入语义、编辑草稿、图片、发布、预览 |
| [`docs/DATA.md`](docs/DATA.md) | `db.json` 字段契约、词表、关系、数据质量检查、快照同步 |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Swiss 视觉规范、语义 token 主题系统、三层强制机制 |
| [`docs/TESTING.md`](docs/TESTING.md) | 质量门禁、selftest / smoke / UI 测试、断言规则 |
| [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) | Abacus 浏览量、GameJolt 导入、催资源（Supabase） |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Pages workflow、base、环境变量、发布与回滚 |
| [`docs/PITFALLS.md`](docs/PITFALLS.md) | 环境 / 构建 / 运行时踩坑清单 |
| [`docs/HISTORY.md`](docs/HISTORY.md) | 里程碑与各阶段摘要（详细报告见 git 历史） |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | 原始需求与技术规范（历史文档） |

## 待办

- [ ] 升级 Actions 版本（`checkout@v4` 等仍指向 Node 20，有 deprecation annotation，非致命）
- [ ] 催资源 SQL 在真实 Supabase 项目执行并按 [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) 实测
- [ ] 按需补 `LICENSE` 与贡献说明
