# FNAF Fan Games Archive

一个 FNAF 同人游戏目录：公开站只读、后台通过数据仓写入。公开站首屏读构建期快照，
随后非阻塞地把内存目录换成数据仓最新内容。

## Catalog

**作品 (Game)**：
目录中的一条同人游戏记录，包含资料、图片、下载渠道与关联。
_Avoid_: 游戏条目、item、entry

**目录 (Catalog)**：
全部作品及其词表的集合，是公开站与后台共同操作的对象。
_Avoid_: 数据集、dataset、数据库

**数据仓 (Data repository)**：
独立于代码仓的 Git 仓库，保存唯一事实来源 `db.json` 与图片。
_Avoid_: 后端、服务器、backend

**构建期快照 (Build-time snapshot)**：
构建时从数据仓拉取的副本，用于首屏与断网兜底。
_Avoid_: 缓存、cache、副本

**归一化条目 (AdminGame)**：
所有可选字段都已落地的作品形态；前台可见性判据只接受这个形态。
_Avoid_: 原始作品、model

**快照同步 (Hydrate)**：
用数据仓最新内容整表替换内存目录，不写本机存档。
_Avoid_: 刷新、refresh（刷新是 UI 动作）

## Editing

**草稿 (Draft)**：
一次编辑会话独有的作品副本与未保存改动；不是全后台共享的单例。
_Avoid_: 表单、form、编辑状态

**基线 (Baseline)**：
最近一次加载或保存成功时的草稿快照，用于判断未保存改动。
_Avoid_: 原始值、initial

**写入片段 (GamePatch)**：
调用方声明要改的字段；`id` 与时间戳由仓储管理，不属于片段。
_Avoid_: 更新载荷、payload、diff

**发布缺口 (Publish issue)**：
阻止“上线”但不阻止“保存草稿”的缺失项（封面、Banner、下载渠道）。
_Avoid_: 校验错误（校验错误阻止保存，发布缺口只阻止上线）

**归档 (Archived)**：
与发布状态正交的隐藏标记；归档不改变作品是草稿、已上线还是已下线。
_Avoid_: 删除、下线、offline

**写入落地位置 (StorageKind)**：
一次写入实际落在哪里：`memory` / `local` / `remote`。
_Avoid_: 后端、目标、target

## Taxonomy and relations

**词表 (Taxonomy)**：
玩法类型、机制、平台三套受控词汇的集合。
_Avoid_: 分类表、categories

**词条 (Vocabulary entry)**：
词表中的一个条目，拥有稳定 id 与展示名称。
_Avoid_: 标签（标签是作品上的自由字符串）

**分类引用 (Vocabulary reference)**：
作品上指向词条的 id；历史数据也可能直接写名称。
_Avoid_: 分类值、category

**关系 (Relation)**：
一条有类型的、从作品指向作品的有向边；反向展示是派生的，不要求两端各存一条。
_Avoid_: 链接、关联（“关联作品”是展示分区，不是数据）

**相关作品 (Related works)**：
详情页的三个分区：显式关系、同作者、同系列。
_Avoid_: 推荐、recommendations

## Public surface

**前台可见 (Publicly visible)**：
`status === 'published'` 且未归档；列表、搜索、筛选、详情页与计数都由此派生。
_Avoid_: 已发布（已发布不含归档判断）

**索引条件 (Index filter)**：
在详情页点击某个属性后，带着该条件打开首页目录。
_Avoid_: 筛选链接、filter link

**浏览量基数 (Static view base)**：
没有实时浏览量 provider 时，来自作品 `metrics.fakeViews` 的计数。
_Avoid_: 假浏览量、fake views（“基数”说明它是兜底值）

## Resource requests

**催资源请求 (Resource request)**：
访客公开提交的、希望站内收录某个资源的请求。
_Avoid_: 工单、ticket

**已收录 (Fulfilled)**：
请求标题归一化后与某个前台可见作品标题完全相等。
_Avoid_: 匹配、matched、found

## Admin access

**管理员 (Admin)**：
拥有后台写权限的人；具体能做什么由角色决定。
_Avoid_: 用户、user（访客不是 Admin）

**所有者 (Owner)**：
可以邀请 / 移除管理员、改角色、永久删除或恢复作品、删除标签或作者、合并 / 删除词条、查看审计的管理员；破坏性操作需要 MFA。
_Avoid_: 超级管理员、superuser

**编辑者 (Editor)**：
可以创建、编辑、发布、归档作品，上传图片，改名 / 合并标签与作者，新建或改名词条；不能删除标签 / 作者、合并 / 删除词条、管理管理员或永久删除。
_Avoid_: 普通管理员、writer

**邀请 (Invite)**：
由所有者发出、绑定到某个邮箱的一次性开户链接；只有被邀请的邮箱能登录。
_Avoid_: 注册、sign up（本项目不开放自助注册）

**会话 (Session)**：
管理员登录后由身份服务签发的一组访问 / 刷新令牌；撤销会话即让该设备下线。
_Avoid_: token、登录态

**账号 (Account)**：
身份服务中的一条用户记录；移除管理员角色后仍保留，用于审计历史操作。
_Avoid_: 用户、profile

**软删除 (Soft delete)**：
作品带上 `deleted_at` / `deleted_by` 后从后台默认列表与公开站隐藏，Owner 可恢复或永久清除。
_Avoid_: 删除（未限定「永久」时指软删除）

## Quality

**资料质量检查 (Data quality check)**：
对原始目录的只读诊断，报告 error / warning / info，不修改任何数据。
_Avoid_: 校验、validation（校验是写入前的拒绝，质量检查是事后报告）
