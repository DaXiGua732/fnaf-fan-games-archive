# FNAF FAN GAME 资源共享站 - 前端开发需求与技术规范详细文档

## 1. 项目概述 (Project Overview)
本项目旨在建立一个极简、高效、纯前端的 Five Nights at Freddy's (FNAF) 粉丝游戏资源导航与分享网站。考虑到国内网络环境及低成本运维需求，项目采用**静态化+无服务化 (Serverless)** 架构进行设计。

*   **部署目标**: GitHub Pages (零成本托管)。
*   **资源存储**: 123云盘、百度云盘、阿里云盘等第三方网盘 (规避大文件服务器带宽限制)。
*   **图片/媒体**: 本地静态资源目录 (`/public`) 或外部稳定图床 URL。
*   **核心技术栈**: Vue 3 (Composition API) + Vite + Tailwind CSS + Vue Router (Hash 模式)。
*   **动态数据 (评论/热度)**: Giscus (基于 GitHub Discussions 的免费评论) + 极简 Serverless API (如 LeanCloud 或免费的浏览量统计 API)。

---

## 2. 视觉规范：严格的 Swiss International Style
> 本项目视视觉规范的一致性高于一切创意延展。所有 UI 组件必须绝对遵守以下“瑞士国际风格”规则，一旦偏离即视为严重 Bug。

### 2.1 绝对禁忌 (Forbidden Tokens)
系统内**严禁出现**以下 CSS 类或样式概念：
*   **任何圆角**: 严禁 `rounded-md`, `rounded-lg`, `rounded-full` 等，必须且仅能使用 `rounded-none`（直角）。
*   **任何阴影**: 严禁 `shadow-sm`, `shadow-md` 等，严禁 `box-shadow`。
*   **任何渐变色**: 严禁 `bg-gradient-to-*`。
*   **非无衬线字体**: 严禁 `font-serif`, `font-mono`。仅使用 Helvetica 及其平替（Arial, sans-serif）。
*   **居中对齐文本**: 严禁 `text-center`（除非用于特定图标对齐），文本必须左对齐 `text-left`。
*   **剧烈的交互动效**: 严禁 `hover:translate-y-*`, `hover:scale-*`。

### 2.2 核心设计系统 (Design System)
*   **网格系统 (Grid)**: 页面必须基于严谨的数学网格。卡片列表使用 12 列衍生网格 (如 `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:gap-8`)。
*   **色彩空间 (Color Palette)**:
    *   主背景: `bg-white` (#ffffff)
    *   主文本: `text-black` (#000000)
    *   强调色 (激活、悬停): `text-[#ff0000]`, `bg-[#ff0000]`, `border-[#ff0000]`
    *   辅助边框: `border-[#cccccc]` 或 `border-black`
*   **交互原则 (Rational Restraint)**:
    *   所有交互动效被限制为最高 `duration-150 ease-out`。
    *   悬停 (Hover) 状态只能改变颜色（文字色、背景色或边框色）。
    *   唯一允许的位移是按钮内部的箭头排版元素：`group-hover:translate-x-2`。
*   **留白 (Negative Space)**: 强制使用大间距隔离信息层级 (如 `py-24`, `mb-12`)，而非使用分隔线。

---

## 3. 架构设计：深模块 (Deep Modules) 模式
> “深模块”原则：向视图层隐藏数据的复杂性，提供极简的 API 接口。

### 3.1 静态数据结构 (`src/data/db.json`)
作为无后端方案，游戏数据通过本地 JSON 维护，作为系统的单一事实来源 (Single Source of Truth)。

```json
{
  "games": [
    {
      "id": "tjoc-r",
      "title": "The Joy of Creation: Reborn",
      "author": "Nikson",
      "releaseYear": 2017,
      "ipSeries": "FNAF",
      "coverImage": "https://example.com/tjoc-cover.jpg",
      "bannerImage": "https://example.com/tjoc-banner.jpg",
      "gallery": ["url1", "url2"],
      "videoUrl": "https://bilibili.com/video/...",
      "description": "游戏详细介绍文本...",
      "downloads": [
        { "provider": "123云盘", "url": "https://...", "password": "abcd" },
        { "provider": "百度网盘", "url": "https://...", "password": "1234" }
      ],
      "metrics": {
        "fakeViews": 12540,
        "score": 4.8
      }
    }
  ]
}
```

### 3.2 核心逻辑 Hook (`src/composables/useGameLibrary.ts`)
这是一个深模块。内部处理所有复杂的查询、交叉过滤（按年份+按作者+搜索词）、排序（按热度或首字母）以及分页。

**对外暴露的极简接口 (API):**
```typescript
interface GameLibraryAPI {
  // 状态
  games: Ref<Game[]>;            // 过滤和搜索后的最终展示数据
  isLoading: Ref<boolean>;       // 模拟加载状态
  
  // 元数据 (供UI渲染过滤面板)
  availableAuthors: Ref<string[]>;
  availableYears: Ref<number[]>;
  availableSeries: Ref<string[]>;
  
  // 操作方法
  setSearchQuery: (query: string) => void;
  setFilter: (category: 'author' | 'year' | 'series', value: string) => void;
  clearFilters: () => void;
  getGameById: (id: string) => Game | undefined;
}
```
**规范**: 视图组件 (`Home.vue`) 只允许调用 `setFilter` 和遍历 `games`，绝对禁止在 `.vue` 文件中手写 `.filter().sort()` 逻辑。

---

## 4. 阶段开发执行步骤 (Step-by-Step Execution Plan)

### 阶段一：工程初始化与样式基建
1.  初始化 Vite + Vue 3 (TS) 工程。
2.  配置 Tailwind CSS，锁定色彩方案。在 `index.css` 中注入 CSS 变量或重置样式，强制全局字体为 `Helvetica, Arial, sans-serif`。
3.  创建一个全局的 `Button.vue` 和 `Card.vue` 基础组件，**完全符合** Swiss Style（无圆角，黑边框，带右向箭头的按钮悬停效果）。
4.  **要求**: 输出结果后暂停，在浏览器审查元素，确保没有任何 `border-radius` 生效。

### 阶段二：深模块数据中心实现
1.  在 `src/data` 创建 `db.json`，手写 3-5 个测试用 FNAF Fan Game 数据（包含不同作者、年份）。
2.  实现 `useGameLibrary.ts`，内部导入 `db.json`。
3.  编写数据提取逻辑，实现搜索和基于作者/年份/系列的交叉筛选。
4.  创建一个临时调试视图，验证接口是否能准确筛选出目标游戏。
5.  **要求**: 暂停，测试逻辑，确保接口极简，逻辑全隐藏在 hook 中。

### 阶段三：骨架与路由导航
1.  安装并配置 `vue-router`，使用 `createWebHashHistory()` (确保 GitHub Pages 刷新不 404)。
2.  开发全局框架 `App.vue` 和 `Layout.vue`。
3.  **导航栏 (Header)**: 极简的顶部白底黑字黑边框区域，左侧 Logo，右侧菜单。悬停时文字变为 `#ff0000`。
4.  **页脚 (Footer)**: 黑底白字，声明免责条款和版权信息。

### 阶段四：首页 (探索与筛选)
1.  **Hero 区域**: 纯红底色 `bg-[#ff0000]` 或纯白底色配合超大号无衬线粗体字，如 "FNAF FAN GAMES ARCHIVE"。
2.  **筛选面板 (Sidebar/Top Bar)**: 渲染年份、作者、IP 系列的分类标签。选中状态使用深色背景或红色边框。
3.  **游戏网格 (Game Grid)**: 使用 12 列网格渲染游戏卡片。
    *   卡片默认状态：白底，黑边框 `border border-black`。
    *   卡片悬停状态：左边框变为红色 `hover:border-l-[4px] hover:border-l-[#ff0000] bg-[#f9f9f9]`。
    *   卡片内部信息排版：顶部图片，下方大字标题，小字年份/作者（全大写字母）。

### 阶段五：游戏详情与资源下载页
1.  配置动态路由 `/game/:id`。
2.  页面布局：
    *   **大字标题区**: 超大排版呈现游戏名字。
    *   **Banner/多媒体区**: 占满内容宽度的宣传图。
    *   **详情侧边栏**: 数据表格样式（作者: xxx, 年份: xxx, 引擎: xxx），网格线分割。
    *   **下载核心区**: 黑色直角按钮，如 "123云盘下载 →" `bg-black text-white rounded-none hover:bg-[#ff0000]`。需标注提取码。

### 阶段六：第三方动态系统注入 (热度与评论)
1.  **浏览量系统**: 使用免费服务 (如 Firebase, Supabase, 或 LeanCloud) 创建一个极简的表 `views: { game_id, count }`。在详情页 `onMounted` 时调用接口自增并读取。
2.  **评论系统**: 注册 GitHub App，启用 Discussions，获取 Giscus 配置参数。
3.  在详情页底部注入 Giscus Script。
4.  **样式覆盖**: 编写全局 CSS 以覆写 Giscus iframe 的默认变量（去除阴影，改变按钮圆角为 0，改变主题色为红黑白），使其融入主站风格。

### 阶段七：打包与 CI/CD 部署
1.  配置 `vite.config.ts` 中的 `base` 路径（如果你部署在 `username.github.io/fnaf-games`，则 `base: '/fnaf-games/'`）。
2.  在 `.github/workflows/deploy.yml` 编写 Actions 脚本，实现推送到 `main` 分支自动构建并部署到 `gh-pages` 分支。

---

## 5. AI Agent 协作协议 (必读)
当你（AI 开发助手）阅读到这份文档并开始执行时，必须遵守以下沟通协议：
1.  **单步执行**: 严禁一口气输出三个以上组件的代码。你必须按上面“阶段X”的步骤，一步步提交代码。
2.  **强制测试**: 在每一小步给出代码后，必须用明确的语言提示：“我已经完成了 [某某模块]，请您在浏览器中刷新测试。如果没有问题，请回复‘继续’。”
3.  **拒绝妥协**: 如果人类用户（我）在后续交互中要求你加一个“好看的圆角”或“酷炫的卡片阴影”，你必须**拒绝**，并提醒我这违反了 Swiss International Style 视觉规范的绝对红线。