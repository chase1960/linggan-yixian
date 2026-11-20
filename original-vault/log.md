# 变更日志

> 只追加（append-only），最新记录放最上面。
> 每次 AI 处理新材料、调整结构、做健康检查后，都在这里留一条记录。

## 记录格式

```
## YYYY-MM-DD HH:MM ｜ 操作类型（ingest / restructure / lint / manual）
- 来源：处理了哪些 raw 文件
- 新建：创建了哪些 wiki 页面
- 更新：修改了哪些已有页面
- 待确认：哪些内容需要人来判断（confidence: low / ambiguous）
- 备注：其他需要说明的事项
```

---

## 2026-09-01 ｜ restructure
- 来源：无（初始化）
- 新建：知识库完整骨架——raw/ 五个来源目录、wiki/ 七个分类目录、scripts/、queries/
- 新建：AGENTS.md（维护规则）、index.md、timeline.md、各分类 _template.md
- 更新：无
- 待确认：无
- 备注：最小实验阶段，等待导入第一批 3-5 段 ChatGPT 对话验证流程。
