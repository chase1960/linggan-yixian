# 交接文档（HANDOFF）：个人认知知识库

> 本文件用于让另一个 AI（GPT/Codex/Claude 等）无缝接手本项目。
> 接手 AI 的第一件事：完整阅读本文件 + 同目录的 `AGENTS.md`（维护规则总纲）。

## 1. 这个项目是什么（背景与目标）

用户长期在 ChatGPT 等多个 AI 平台做"向内探索/自我对话"，沉淀了大量聊天记录。痛点：
- 平台有账号风控、付费迁移风险，频繁换工具导致"记忆清零"；
- 原始对话又长又杂，真正的自我洞察被淹没；
- 想要一个**平台无关、本地存储、可复利积累、能看见成长转变路径**的个人认知知识库。

用第一性原理推导出的定位：这不是"对话存档库"，而是一个**自我认知的编译系统**——
原始对话是原料，AI 负责把其中关于"我是谁、我的模式/动机/价值观/转变"蒸馏成结构化、可追溯、会增值的认知页面。

核心设计要求：
1. 整个库就是一个本地普通文件夹 + 纯文本 Markdown，不依赖任何平台/数据库/专有格式，复制到任何电脑、用任何编辑器都能打开（这就是"无法被迁移走"的关键——工具可换，库不动）。
2. 每条认知都能回溯到原始对话，区分"用户明说(extracted)/AI推断(inferred)/有歧义(ambiguous)"并标置信度。
3. 认知发生变化时保留 Before→After 演变，绝不覆盖旧结论——成长路径由此可见。
4. 前端可视化用 Obsidian（本地 Markdown 查看器，双链图谱 + Dataview 时间线/统计）。

## 2. 已确定的方案：三层架构 + 七个认知分类

- **Raw 层 `raw/`**：各平台原始对话，只读，AI 永不修改。子目录：chatgpt / doubao / claude / journal / notes。
- **Wiki 层 `wiki/`**：AI 蒸馏出的结构化认知，七个分类：
  - `insights/` 具体洞察（颗粒度最小的"啊哈"）
  - `patterns/` 反复出现的思维/情绪/行为/关系模式（需≥2证据）
  - `values/` 价值观与核心动机、权重演变
  - `questions/` 持续追问的开放问题
  - `transitions/` 认知转折点（Before→After）
  - `experiments/` 为改变做的行动尝试与结果
  - `entities/` 有重要影响的人/书/概念/工具
- **Schema 层**：`AGENTS.md` 定义全部归档/更新/冲突/溯源/隐私规则；各分类有 `_template.md` 标准页面结构。
- 辅助文件：`index.md`（"当前版本的我"+导航）、`timeline.md`（转变编年史）、`log.md`（只追加操作流水）。

## 3. 当前已经做完了什么

知识库骨架已在本地完整搭建，共 15 个文件，全部就位：

```
self-knowledge-vault/
├── AGENTS.md                 # AI 维护规则（最重要，接手必读）
├── index.md / timeline.md / log.md / README.md / HANDOFF.md(本文件)
├── raw/{chatgpt,doubao,claude,journal,notes}/   # 目前为空，等真实对话
├── wiki/
│   ├── insights|patterns|values|questions|transitions|experiments|entities/
│   └── 每个目录下都有 _template.md
├── scripts/
│   ├── parse_chatgpt_export.py   # ChatGPT 导出 JSON → Markdown 解析脚本（已实测通过）
│   └── distill_prompt.md         # "对话→洞察"蒸馏提示词（可直接复用）
└── queries/example-queries.md    # 10 个 Obsidian Dataview 可视化查询 + 图谱建议
```

已验证：Python 3.13 环境下脚本语法和端到端流程均测试通过（时间戳转北京时间、工具/多模态消息过滤、--list/--pick/--limit 筛选、文件名清洗都正常；测试假数据已清空，`raw/` 现为空）。

## 4. 当前卡点 / 还没做的事

- 还没有任何真实对话入库（`raw/` 全空）。
- 卡点：用户使用的是一个第三方/编程类桌面客户端（设置里有 Git、Worktrees、钩子、环境等，不是 ChatGPT 官方网页版），里面没有 Data controls 入口。
- 解决办法：导出跟账号绑定、与客户端无关。用浏览器打开 **chatgpt.com** 登录同一账号 → 左下角头像 → 设置(Settings) → 「数据控制 / Data controls」（也可能译"个人数据"）→「导出数据 / Export data」→ 邮箱收 zip → 解压得到 `conversations.json`。或在客户端点左侧「账户」(带↗)跳网页再找导出。

## 5. 接手后要执行的具体步骤

环境：Windows 11、PowerShell 7.6、Python 3.13.13。
库根目录（绝对路径，以下命令都在此目录执行）：
`C:\Users\樊嵘\.doubao\lark-chats\2026-09-01\new-chat-1\self-knowledge-vault`

1. 等用户提供 `conversations.json` 后，先列出全部对话清单（不写文件）：
   ```powershell
   python scripts/parse_chatgpt_export.py -i "conversations.json的完整路径" -o raw/chatgpt --list
   ```
2. 先只挑 3-5 段最有价值的自我探索对话导出（关键词匹配标题，逗号分隔；也可用 --limit N）：
   ```powershell
   python scripts/parse_chatgpt_export.py -i "..." -o raw/chatgpt --pick "关键词1,关键词2"
   ```
3. 第一段先单独蒸馏做样板：按 `scripts/distill_prompt.md` 的流程和 `AGENTS.md` 的规则，
   从该对话提取七分类认知，产出"审阅清单 + 可落盘的 wiki 页面 + timeline 建议 + log 条目 + 待用户确认问题"。
   严格套用对应 `wiki/*/_template.md`，标好 provenance 与 confidence，宁标 low/inferred 也不把推测当事实。
4. 用户确认样板质量后再批量处理；每处理 5-10 段做一次 lint（找重复页/孤儿页/待确认项，规则见 AGENTS.md 第 11 节）。
5. 引导用户用 Obsidian 打开本文件夹为 Vault，参考 `queries/example-queries.md` 装 Dataview/Timeline 插件看图谱与成长时间线。
6. 建议后续 `git init` 做版本管理，让知识库自身演变也可追溯（尚未执行，需用户同意）。

## 6. 接手 AI 必须遵守的红线（摘自 AGENTS.md）

- 永不修改/删除 `raw/` 原始文件；不编造用户没说过的经历或结论。
- 新结论与旧结论冲突时保留演变、不覆盖；没有真实关联不硬造双链。
- 拿不准归类先放 insights 并标 #待归类；信息不足或影响整体结构时暂停提问，不擅自决定。
- 内容高度隐私，默认只在本地处理，不主动上传公开云；不写入任何密钥密码。
- 每次处理后只追加更新 `log.md`，转变节点同步 `timeline.md`，并刷新 `index.md`。
