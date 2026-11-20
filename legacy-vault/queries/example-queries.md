# Obsidian 可视化查询示例（Dataview 插件）

> 用法：Obsidian 设置 → 第三方插件 → 关闭安全模式 → 浏览社区插件 → 安装 **Dataview**（推荐再装 **Timeline** 和 **Templater**）。
> 新建一个笔记，把下面任意代码块粘进去（代码块语言选 `dataview` 或 `dataviewjs`），即可自动生成动态视图。
> 随着 wiki/ 页面增多，这些视图会自动更新，这就是"看得见的成长"。

## 1. 最近新增/更新的认知（最近活跃）

```dataview
TABLE updated AS "更新时间", type AS "类型", confidence AS "置信度", status AS "状态"
FROM "wiki"
WHERE updated != null
SORT updated DESC
LIMIT 20
```

## 2. 成长时间线（所有认知转变，按转变日期排序）

```dataview
TABLE transition_date AS "转变日期", significance AS "重大程度", confidence AS "置信度"
FROM "wiki/transitions"
WHERE type = "transition"
SORT transition_date ASC
```

## 3. 仍在活跃的行为/思维模式（看到自己的"惯性"）

```dataview
TABLE subtype AS "类别", occurrences AS "出现次数", status AS "状态"
FROM "wiki/patterns"
WHERE type = "pattern"
SORT occurrences DESC
```

## 4. 我还在追问的开放问题（未解决清单）

```dataview
TABLE ask_count AS "提起次数", status AS "状态", updated AS "最近触及"
FROM "wiki/questions"
WHERE status != "answered"
SORT ask_count DESC
```

## 5. 价值观权重总览（当前优先级排序）

```dataview
TABLE priority AS "当前权重", status AS "状态"
FROM "wiki/values"
SORT priority DESC
```

## 6. 需要我确认的低置信度内容（AI 推断、待我拍板）

```dataview
LIST
FROM "wiki"
WHERE confidence = "low" OR provenance = "ambiguous" OR contains(tags, "#待确认")
```

## 7. 待归类的临时洞察（定期整理）

```dataview
LIST
FROM "wiki/insights"
WHERE contains(tags, "#待归类")
```

## 8. 行动实验看板（计划中/进行中/已完成）

```dataview
TABLE status AS "状态", outcome AS "结果", date_start AS "开始"
FROM "wiki/experiments"
SORT date_start DESC
```

## 9. 每个分类各有多少页（知识库体量增长）

```dataview
TABLE length(rows) AS "页面数量"
FROM "wiki"
WHERE type != null
GROUP BY type AS "认知类型"
```

## 10. 按月统计新增页面（成长节奏曲线的基础数据）

```dataviewjs
const pages = dv.pages('"wiki"').where(p => p.created);
const byMonth = {};
for (const p of pages) {
  const m = String(p.created).slice(0, 7);
  byMonth[m] = (byMonth[m] || 0) + 1;
}
const rows = Object.entries(byMonth).sort();
dv.table(["月份", "新增页面数"], rows);
```

---

## 图谱视图建议（Graph View）

- `Ctrl+G` 打开全局图谱，能看到所有 `[[]]` 双链形成的认知网络。
- 设置 → 图谱 → 颜色组，按 `type` 字段或路径上色：
  - patterns 一种颜色、transitions 一种颜色、values 一种颜色……
- 节点越大代表连接越多——那些最大的节点，往往就是你内心世界的"核心母题"。
- 孤立节点（没有连线）是孤儿页，提示你去补关联或合并。
