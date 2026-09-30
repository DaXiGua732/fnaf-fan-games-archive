# FNAF FAN GAMES ARCHIVE

# 后台管理系统开发计划

> 本文档用于指导 AI Agent 分阶段开发网站后台管理系统。
>
> 开发原则：**先搭建可验证的管理 UI，再抽象数据层，最后接入真正的持久化、认证和图片存储。**
>
> Agent 必须严格按照阶段执行。除非用户明确要求，不得跨阶段一次性实现整个后台。

---

# 1. 项目现状

当前项目技术栈：

* Vue 3
* TypeScript
* Vite
* Vue Router
* Tailwind CSS
* GitHub Pages
* GitHub Repository 作为源码仓库
* `db.json` 作为游戏目录当前唯一数据源

当前数据链路：

```text
src/data/db.json
        ↓
useGameLibrary.ts
        ↓
Home.vue
GameDetail.vue
```

当前游戏领域模型：

```ts
Game {
  id
  title
  author
  releaseYear
  ipSeries
  engine
  coverImage
  bannerImage
  gallery
  videoUrl
  description
  downloads[]
  metrics
}
```

当前前台架构是**只读静态网站**。

因此：

```text
浏览器
  ↓
读取 db.json
```

可以实现。

但是：

```text
浏览器
  ↓
修改游戏
  ↓
永久保存 db.json
```

当前做不到。

同理，当前图片系统主要依赖：

```text
/public/images
```

以及外部图片 URL，并没有真正的后台上传系统。

---

# 2. 后台系统最终目标

后台最终应该成为类似：

* YouTube Studio
* Bilibili 创作中心
* WordPress 后台

这种类型的资源管理中心。

重点不是“能编辑几个 Input”。

而是：

```text
批量管理
+
内容编辑
+
资源管理
+
发布状态管理
+
标签管理
+
图片管理
+
预览
+
数据持久化
+
权限控制
```

---

# 3. 最终后台结构

建议最终路由：

```text
/admin
/admin/games
/admin/games/new
/admin/games/:id/edit

/admin/tags
/admin/authors

/admin/settings
```

第一阶段只实现：

```text
/admin/games
```

随后：

```text
/admin/games/new
/admin/games/:id/edit
```

最后再根据实际需求扩展：

```text
/admin/tags
/admin/authors
/admin/settings
```

---

# 4. 核心架构目标

后台不得直接依赖 `db.json` 进行业务操作。

最终应建立：

```text
                    ┌─────────────────────┐
                    │    Admin UI         │
                    │                     │
                    │ Games / Edit / Tags │
                    └──────────┬──────────┘
                               │
                               ↓
                    ┌─────────────────────┐
                    │   Admin Composables │
                    └──────────┬──────────┘
                               │
                               ↓
                    ┌─────────────────────┐
                    │   Repository Layer  │
                    └──────────┬──────────┘
                               │
               ┌───────────────┴───────────────┐
               ↓                               ↓
      Local Repository                 Remote Repository
               │                               │
               ↓                               ↓
          db.json / Mock                    Database
                                               │
                                        ┌──────┴──────┐
                                        ↓             ↓
                                      DB            Storage
```

前期可以使用：

```text
LocalGameRepository
```

后期替换成：

```text
RemoteGameRepository
```

后台 UI 不应该因为更换数据库而重写。

---

# 5. 数据模型调整目标

现有 `Game` 数据模型需要逐渐扩展。

建议最终模型：

```ts
interface Game {
  id: string

  // 基本信息
  title: string
  shortDescription?: string
  description: string
  author: string

  // 分类
  releaseYear: number
  ipSeries: string
  tags: string[]

  // 技术信息
  engine: string
  platforms: string[]

  // 图片
  coverImage: string
  bannerImage: string
  gallery: string[]

  // 视频
  videoUrl?: string

  // 下载
  downloads: DownloadLink[]

  // 发布状态
  status: 'draft' | 'published' | 'offline'

  // 内容控制
  featured: boolean
  sortOrder: number

  // 时间
  createdAt: string
  updatedAt: string
  publishedAt?: string

  // 统计
  metrics: {
    fakeViews: number
    score: number
  }
}
```

注意：

不要一次性强制所有旧数据拥有新字段。

应提供：

```text
旧数据兼容
+
默认值
+
数据迁移
```

避免现有网站因为新增字段直接崩溃。

---

# 6. 标签模型

当前：

```text
ipSeries
```

承担了部分分类功能。

未来需要明确区分：

```text
ipSeries
```

和：

```text
tags[]
```

例如：

```text
系列：
FNAF 主线同人

标签：
3D
恐怖
剧情
生存
高难度
```

标签应该支持：

```text
创建
修改
删除
搜索
批量添加
批量移除
```

---

# 7. 后台 UI 视觉规范

后台必须继续遵守当前项目的 Swiss International Style。

绝对禁止：

```text
圆角
阴影
渐变
衬线字体
等宽字体
大幅缩放动画
大幅位移动画
无意义装饰
```

继续使用：

```text
背景：#ffffff
文字：#000000
强调：#ff0000
辅助边框：#cccccc
悬停背景：#f9f9f9
```

继续：

```text
border
grid
大留白
严格网格
左对齐
短促 150ms 交互
```

后台不应该因为“Admin Panel”而突然变成普通 SaaS 模板。

必须看起来仍然属于 FNAF FAN GAMES ARCHIVE。

---

# 8. Layout 架构

当前：

```text
Layout.vue
```

主要服务公开网站。

后台应该新增：

```text
layouts/AdminLayout.vue
```

公开站：

```text
Layout.vue
```

后台：

```text
AdminLayout.vue
```

两者不要混合。

后台推荐结构：

```text
┌──────────────────────────────────────────────────────────┐
│ FNAF / ADMIN                              管理员 / 返回站点 │
├────────────────┬─────────────────────────────────────────┤
│                │                                         │
│ 游戏管理       │                                         │
│ 标签管理       │             Admin Content               │
│ 作者管理       │                                         │
│ 系统设置       │                                         │
│                │                                         │
└────────────────┴─────────────────────────────────────────┘
```

桌面端：

```text
左侧固定导航
右侧内容区
```

移动端：

```text
顶部导航
折叠菜单
内容全宽
```

---

# 9. 阶段开发路线

---

# Phase 0 — 项目审计与设计冻结

## 目标

在写后台代码前，确认：

```text
当前数据结构
当前路由
当前 Layout
当前视觉系统
当前测试机制
当前图片资源机制
```

## Agent 工作

检查：

```text
src/types/game.ts
src/data/db.json
src/composables/useGameLibrary.ts
src/router/routes.ts
src/layouts/Layout.vue
src/styles/index.css
package.json
```

确认：

```text
哪些东西可以复用
哪些东西必须抽象
哪些地方不能直接改
```

## 输出

Agent 必须先提交：

```text
后台架构说明
+
数据模型变更说明
+
路由规划
+
文件结构规划
```

## 验收

用户检查：

```text
是否理解现有项目
是否破坏前台
是否明确后台和前台 Layout 分离
是否明确 Repository Layer
```

## 停止点

**完成后必须暂停，不得直接进入 Phase 1。**

用户确认后：

```text
继续
```

---

# Phase 1 — Admin Layout

## 目标

建立后台页面框架。

新增：

```text
src/layouts/AdminLayout.vue
```

必要时新增：

```text
src/components/admin/
```

## 页面

创建：

```text
/admin/games
```

但此时只显示静态占位内容。

例如：

```text
FNAF / ADMIN

游戏管理

管理本站收录的所有游戏资源。

[游戏列表区域]
```

## 要求

必须做到：

```text
与前台 Layout 完全分离
```

不得修改前台导航和 Footer 的行为。

## 验收

测试：

```text
/
```

必须正常。

```text
/game/xxx
```

必须正常。

```text
/admin/games
```

必须正常。

## 停止点

Agent 必须暂停，让用户检查：

```text
后台整体结构
导航
响应式
字体
颜色
边框
是否出现圆角 / 阴影 / 渐变
```

---

# Phase 2 — 游戏管理列表

## 目标

制作真正的游戏管理首页：

```text
/admin/games
```

这是整个后台最核心的页面。

## 页面结构

顶部：

```text
游戏管理

收录作品
```

操作区：

```text
搜索
状态筛选
作者筛选
标签筛选
排序
```

状态：

```text
全部
已上线
草稿
已下线
```

主列表：

```text
□
封面
游戏名称
作者
系列
标签
状态
更新时间
操作
```

## 行操作

第一版：

```text
编辑
预览
```

以后增加：

```text
复制
上线
下线
归档
删除
```

## 多选

列表必须支持：

```text
全选
单选
取消选择
```

选中后显示：

```text
已选择 X 项
```

---

# Phase 3 — 批量操作

## 目标

实现类似 YouTube / Bilibili 的批量管理体验。

批量操作：

```text
批量上线
批量下线
批量添加标签
批量移除标签
批量修改作者
归档
```

## 状态栏

未选择：

```text
普通列表工具栏
```

选择后：

```text
已选择 4 项

[上线]
[下线]
[添加标签]
[移除标签]
[归档]
```

## 危险操作

例如：

```text
删除
```

必须二次确认。

禁止：

```text
点击一次直接永久删除
```

---

# Phase 4 — Game 编辑页面

## 路由

```text
/admin/games/new
/admin/games/:id/edit
```

## 页面布局

推荐：

```text
┌─────────────────────────────────────────────┐
│ 编辑游戏                         保存 / 发布 │
├──────────────────────────┬──────────────────┤
│ 基本信息                  │ 发布设置         │
│                          │                  │
│ 游戏名称                  │ 状态             │
│ 作者                     │ 标签             │
│ 简介                     │ 推荐             │
│                         │ 排序权重         │
│ 封面                     │                  │
│ Banner                   │                  │
│ 图库                     │                  │
│                          │                  │
│ 下载资源                 │                  │
└──────────────────────────┴──────────────────┘
```

---

# Phase 5 — 基础字段编辑

## 必须支持

```text
游戏名称
作者
发行年份
IP 系列
引擎
简介
视频 URL
```

## 保存行为

第一版可以：

```text
保存草稿
```

不要一开始就实现真正数据库写入。

先建立统一接口：

```ts
saveGame(game)
```

实际可以暂时：

```text
Mock Repository
```

---

# Phase 6 — 标签管理

## 编辑游戏时

支持：

```text
添加标签
删除标签
搜索已有标签
创建新标签
```

示例：

```text
标签

[恐怖 ×]
[3D ×]
[剧情 ×]

[ + 添加标签 ]
```

## 全局标签页面

路由：

```text
/admin/tags
```

支持：

```text
标签名称
使用数量
创建时间
编辑
删除
```

---

# Phase 7 — 图片管理 UI

## 目标

先完成 UI，再接 Storage。

支持：

```text
封面
Banner
Gallery
```

## 封面

```text
当前图片

[图片预览]

[更换图片]
```

## 上传

支持：

```text
点击上传
拖拽上传
```

## 图库

```text
[图片]
[图片]
[图片]

[+ 添加图片]
```

支持：

```text
删除
排序
预览
```

---

# Phase 8 — 下载资源管理

编辑页面支持：

```text
下载渠道
```

每一行：

```text
服务商
URL
提取码
```

例如：

```text
123云盘
[URL.........................]
[提取码]
[删除]
```

支持：

```text
增加
删除
排序
修改
```

注意：

URL 必须经过基本格式验证。

---

# Phase 9 — 发布状态系统

建立：

```ts
status:
  draft
  published
  offline
```

含义：

### draft

后台可见。

前台不可见。

### published

后台可见。

前台正常展示。

### offline

后台保留。

前台不展示。

不要通过删除数据实现下线。

---

# Phase 10 — 前台与后台状态联动

这一步开始：

```text
后台修改 status
```

应该真正影响：

```text
首页
搜索
筛选
详情页
```

例如：

```text
offline
```

的游戏：

```text
首页不可见
搜索不可见
详情页正常 ID 访问策略由产品决定
```

推荐初版：

```text
前台完全隐藏
后台继续保留
```

---

# Phase 11 — Repository Layer

创建类似：

```text
src/repositories/
├── gameRepository.ts
├── localGameRepository.ts
└── remoteGameRepository.ts
```

或者：

```text
src/services/repositories/
```

统一接口：

```ts
interface GameRepository {
  listGames()
  getGame(id)
  createGame(game)
  updateGame(id, data)
  deleteGame(id)
  publishGame(id)
  unpublishGame(id)
}
```

后台只允许通过 Repository 操作数据。

禁止：

```ts
import db from '../data/db.json'
```

直接出现在后台 Vue 页面。

---

# Phase 12 — Local Repository

先实现：

```text
LocalGameRepository
```

读取：

```text
db.json
```

目的：

```text
验证整个后台 UI + 业务流程
```

而不是永久方案。

此阶段允许：

```text
Mock save
Local state
```

但必须明确：

```text
当前不能永久写回生产数据
```

---

# Phase 13 — 数据持久化方案确定

在真正接入之前，对以下方案进行最终选择：

### 方案 A

```text
GitHub API
+
GitHub Repository
+
GitHub Actions
```

### 方案 B

```text
Supabase
├── Database
├── Auth
└── Storage
```

优先评估：

```text
维护成本
权限安全
图片上传
实时性
回滚
费用
部署方式
```

对于一个未来会持续增长的游戏资源库，推荐优先验证：

```text
Supabase Database
+
Supabase Storage
+
Supabase Auth
```

但 Agent 不得在用户尚未确定方案前擅自把整个项目绑定到 Supabase。

---

# Phase 14 — 数据库设计

如果选择远程数据库，建立至少：

```text
games
authors
tags
game_tags
downloads
```

可进一步拆：

```text
game_gallery
```

推荐关系：

```text
games
  │
  ├── author
  │
  ├── downloads
  │
  └── game_tags
            │
            └── tags
```

---

# Phase 15 — Authentication

后台必须存在认证机制。

禁止：

```text
/admin
```

完全公开。

最终：

```text
/admin
   ↓
Auth
   ↓
管理员验证
   ↓
Admin Dashboard
```

第一版可以仅允许：

```text
管理员账号
```

不需要一开始实现：

```text
复杂角色系统
```

但 Repository / API 层必须为后续 RBAC 留出空间。

---

# Phase 16 — 图片 Storage

建立：

```text
Storage
```

建议目录：

```text
games/
  <game-id>/
    cover.webp
    banner.webp
    gallery/
      01.webp
      02.webp
      03.webp
```

后台：

```text
上传
→ Storage
→ 返回 URL
→ 保存 Game
```

不要把二进制图片直接存进数据库。

---

# Phase 17 — 图片处理

后台上传组件最终建议支持：

```text
文件类型验证
文件大小验证
尺寸检查
预览
上传进度
失败重试
删除旧图片
```

建议优先支持：

```text
WebP
JPEG
PNG
```

但不要在没有实际需求时过早引入复杂图片处理服务。

---

# Phase 18 — 预览功能

编辑游戏时增加：

```text
保存
预览
发布
```

预览应该能看到：

```text
真实前台 GameDetail 页面
```

最好做到：

```text
后台编辑
      ↓
生成 Preview State
      ↓
前台详情页预览
```

而不是另外写一套“后台详情页面”。

---

# Phase 19 — 操作历史

后期增加：

```text
updatedAt
updatedBy
```

必要时：

```text
audit_logs
```

例如：

```text
2026-09-29 00:34
Admin
修改了游戏信息

2026-09-29 00:40
Admin
上线了游戏

2026-09-29 00:45
Admin
添加标签「3D」
```

这一步不是第一阶段必需功能。

---

# Phase 20 — 测试

每一个阶段都必须测试。

至少：

```bash
npm run typecheck
npm run selftest
npm run smoke
npm run build
```

最终：

```bash
npm run verify
```

---

# 21. 后台专项测试

至少覆盖：

## 游戏列表

```text
搜索
筛选
排序
分页
全选
取消全选
```

## 批量

```text
批量上线
批量下线
批量添加标签
批量删除标签
```

## 编辑

```text
新建
修改
取消
保存
预览
发布
```

## 状态

```text
draft
published
offline
```

## 图片

```text
上传
删除
排序
替换
上传失败
```

## 下载链接

```text
新增
删除
修改
错误 URL
空 URL
提取码为空
```

---

# 22. 前台回归测试

每次后台功能开发之后必须测试：

```text
/
```

```text
/game/:id
```

以及：

```text
搜索
筛选
分页
游戏详情
下载
评论区域
浏览量
图片
```

后台开发不得破坏现有前台。

---

# 23. Git 提交策略

Agent 不应该把整个后台一次提交。

建议：

```text
feat(admin): add admin layout
feat(admin): add game management list
feat(admin): add batch actions
feat(admin): add game editor
feat(admin): add tag manager
feat(admin): add image manager
refactor(data): add game repository abstraction
feat(data): add remote repository
feat(auth): add admin authentication
feat(storage): add image storage
```

每一个阶段都可以独立回滚。

---

# 24. AI Agent 执行协议

这是本项目后台开发的强制规则。

## 规则 1：不得跨阶段开发

例如当前处于：

```text
Phase 2
```

Agent 不得顺便实现：

```text
Supabase
Authentication
图片 Storage
数据库
```

除非用户明确要求。

---

## 规则 2：每个阶段先说明修改范围

开始阶段前必须告诉用户：

```text
本阶段目标：
修改哪些文件：
新增哪些文件：
不会修改哪些内容：
完成后如何测试：
```

---

## 规则 3：一次不要修改过多核心模块

一次尽量控制在：

```text
1～3 个核心组件 / 模块
```

避免：

```text
十几个文件同时修改
```

导致用户无法定位问题。

---

## 规则 4：每阶段必须有停止点

阶段完成后必须停止。

不得自动进入下一阶段。

必须明确：

```text
Phase X 已完成。

请检查：

1. xxx
2. xxx
3. xxx

测试命令：

npm run verify

确认无误后，请回复：

继续
```

---

## 规则 5：出现测试失败时不要绕过去

如果：

```text
typecheck
selftest
smoke
build
```

任意一个失败：

必须先修复。

不能：

```text
跳过
关闭测试
修改测试让它通过
```

除非明确说明测试本身已经失效并得到用户许可修改。

---

## 规则 6：不得擅自修改现有前台行为

除非当前阶段确实需要。

尤其保护：

```text
首页
游戏详情页
游戏搜索
游戏筛选
评论
浏览量
下载
```

---

# 25. Agent 回复格式

每一个阶段建议统一输出：

```text
## 本阶段

目标：
...

修改：
- ...
- ...

新增：
- ...

未修改：
- ...

测试：
- npm run typecheck
- npm run selftest

结果：
PASS / FAIL

请检查：
- ...
- ...
- ...

确认无误后回复：

继续
```

---

# 26. 后台第一版功能范围

第一版完成后，后台至少应该能够：

```text
查看所有游戏
搜索游戏
筛选游戏
查看游戏状态
选择多个游戏
批量上线
批量下线
批量添加标签
编辑游戏
新增游戏
修改游戏基本信息
修改简介
修改作者
修改分类
修改下载链接
管理图片
预览游戏
```

但第一版允许：

```text
数据仍然来自 Local / Mock Repository
图片仍然使用本地或假上传
```

真正的数据库和 Storage 放到后续阶段。

---

# 27. 第一版明确不做

为了避免 Agent 失控，第一版暂时不要做：

```text
复杂权限系统
多管理员
用户系统
评论后台
浏览量分析 Dashboard
复杂日志系统
全文搜索引擎
推荐算法
复杂图片 CDN
复杂审核流
邮件系统
```

除非用户主动增加需求。

---

# 28. 最终目标架构

完成全部阶段以后，目标结构大致：

```text
src/
├── components/
│   ├── public/
│   └── admin/
│
├── composables/
│   ├── useGameLibrary.ts
│   ├── useAdminGames.ts
│   ├── useAdminTags.ts
│   └── useAuth.ts
│
├── layouts/
│   ├── Layout.vue
│   └── AdminLayout.vue
│
├── repositories/
│   ├── gameRepository.ts
│   ├── localGameRepository.ts
│   └── remoteGameRepository.ts
│
├── services/
│   ├── storage.ts
│   ├── auth.ts
│   └── ...
│
├── types/
│   ├── game.ts
│   ├── tag.ts
│   └── admin.ts
│
├── views/
│   ├── public/
│   └── admin/
│       ├── AdminGames.vue
│       ├── AdminGameEditor.vue
│       ├── AdminTags.vue
│       └── AdminSettings.vue
│
├── router/
│
└── data/
    └── db.json
```

最终数据流：

```text
                 PUBLIC
                    │
                    ↓
            useGameLibrary
                    │
                    ↓
              GameRepository
                    │
                    ↓
                Database


                 ADMIN
                    │
                    ↓
             useAdminGames
                    │
                    ↓
              GameRepository
                    │
                    ↓
                Database
                    │
                    ├──────────────→ Storage
                    │
                    └──────────────→ Auth
```

---

# 29. 当前实际开工顺序

Agent 第一次开工只允许执行：

```text
Phase 0
```

然后：

```text
Phase 1
```

然后：

```text
Phase 2
```

然后：

```text
Phase 3
```

之后：

```text
Phase 4
Phase 5
Phase 6
Phase 7
Phase 8
Phase 9
```

再进行：

```text
Repository
→ Remote Database
→ Auth
→ Storage
```

不要反过来。

特别是：

> **不要为了做后台 UI，先重构整个数据库。**

先把管理体验做出来，再确定真正的数据后端。

---

# 30. 第一阶段的成功标准

后台第一版不是：

> “页面能打开”。

而应该达到：

```text
/admin/games
```

已经具有完整的后台管理中心视觉和交互骨架：

```text
游戏管理
├── 搜索
├── 筛选
├── 状态统计
├── 游戏列表
├── 勾选
├── 批量工具栏
├── 添加游戏
└── 编辑入口
```

用户可以在这个界面上直观看到：

```text
以后这个网站的游戏目录就是从这里维护的。
```

而不是一个临时 Debug 页面。

---

# 31. 最终原则

整个后台开发过程中始终遵守：

```text
先 UI
↓
再业务逻辑
↓
再数据抽象
↓
再持久化
↓
再认证
↓
再 Storage
```

而不是：

```text
先数据库
↓
先认证
↓
先 Storage
↓
最后才发现 UI 不好用
```

后台的核心不是数据库。

后台的核心是：

```text
高效地管理游戏目录。
```

数据库、认证、Storage 都应该服务于这个目标。

---

# Agent 开工指令

现在开始 **Phase 0 — 项目审计与设计冻结**。

本次只允许：

1. 阅读现有项目。
2. 分析当前架构。
3. 提出后台文件结构。
4. 提出数据模型增量修改方案。
5. 提出 Admin Layout 方案。
6. 提出 `/admin/games` 页面信息架构。

**暂时不要写任何后台业务代码。**

完成后停止，等待用户审查。
