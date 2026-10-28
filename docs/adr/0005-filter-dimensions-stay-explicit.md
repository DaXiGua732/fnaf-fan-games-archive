# Filter dimensions stay explicit until a second consumer forces a registry

新增一个前台筛选维度目前要同时改：`FilterCategory`、`FILTER_DIMENSIONS`、标签表、`QueryState` /
`emptyFilterQuery`、`useGameLibrary.filtered`、`FilterPanel` 的 `GROUPS`、`GameDetail` 的属性表。
架构评审提出用一张 descriptor 表（key / label / 匹配规则 / 选项来源）收敛这些位置。

暂时不采用：各维度的匹配规则并不同构 —— 文本维度是字符串相等，词表维度要先把 id / 名称都解析成
词条 id，平台 / 机制是数组包含；选项来源也分别是目录派生与 taxonomy。用一张泛型表要么擦掉字段类型，
要么需要四五个策略回调，读起来比现在的显式代码更长。**没有已排期的第二个消费者**迫使这次抽象，
现在做属于为不存在的需求付复杂度。

## Consequences

- 新增维度时继续按现有清单逐处修改；`selftest` 的筛选 URL / 库断言会在漏改时变红。
- 当出现第二个消费方（例如后台也要同一套维度过滤，或新增维度成为排期任务）时，重新评估 registry，
  并优先保留 `FilterCategory` 的类型收窄。
