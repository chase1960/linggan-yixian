# 个人认知知识库 · 使用说明

这是一个**平台无关、本地优先、可复利积累**的自我认知沉淀系统。
整个库就是一个普通文件夹，用 Obsidian 打开体验最佳，用任何文本编辑器也能读写。

## 它解决什么问题

- AI 对话散落在 ChatGPT / 豆包 / Claude，换平台、遇风控就"失忆"。
- 原始对话又长又杂，真正的自我洞察淹没在里面。
- 想看到自己的认知是如何一步步变化的，而不是凭感觉。

## 三层结构（一句话版）

- `raw/`：原始对话，只读存档（证据）。
- `wiki/`：AI 蒸馏出的结构化认知（核心资产）。
- `AGENTS.md`：告诉 AI 如何维护这个库的规则。

## 最小实验流程（第一次使用）

### 1. 导出 ChatGPT 对话
1. 登录 ChatGPT 网页版 → 右上角头像 → **Settings → Data controls → Export data**。
2. 确认导出，去注册邮箱收邮件，下载 zip 并解压，得到 `conversations.json`。

### 2. 解析成可读 Markdown
把 `conversations.json` 放到任意位置，在本库 `scripts/` 目录下运行（需要 Python 3）：

```powershell
python scripts/parse_chatgpt_export.py --input "你的路径/conversations.json" --output raw/chatgpt --list
```

- `--list`：先列出所有对话标题和时间，不生成文件，方便你挑选。
- 选定 3-5 段最有价值的对话后，用 `--pick "标题关键词1,标题关键词2"` 只导出这几段：

```powershell
python scripts/parse_chatgpt_export.py --input "你的路径/conversations.json" --output raw/chatgpt --pick "关键词1,关键词2"
```

- 也可以用 `--limit 5` 取最近 5 段；什么都不加则全量导出。

### 3. 让 AI 蒸馏
把 `scripts/distill_prompt.md` 的内容 + 某段导出的对话 Markdown 一起发给 AI（或让能访问本地文件的 AI Agent 直接读取），它会按 `AGENTS.md` 的规则在 `wiki/` 下生成洞察页。

### 4. 用 Obsidian 查看
1. 下载 Obsidian：https://obsidian.md（免费）。
2. **Open folder as vault** → 选择本 `self-knowledge-vault` 文件夹。
3. 左侧看文件结构，按 `Ctrl+G` 打开图谱视图看认知网络，安装 Timeline / Dataview 插件可看时间线和统计（示例查询在 `queries/`）。

## 日常使用（跑通之后）

- 任何平台有了新的有价值对话 → 导出/复制到对应 `raw/` 子目录 → 让 AI 执行一次 ingest。
- 每月花 15 分钟：看 `log.md` 里"待确认"项、审阅新页面、更新 `index.md` 和 `timeline.md`。
- 想换 AI 工具？库不用动——新工具只要能读本地 Markdown，先读 `index.md` 就能快速"认识"你。

## 备份与版本管理（推荐）

- 最简单：定期把整个文件夹复制到 U 盘 / 私有网盘。
- 更强大：在本目录 `git init`，每次处理后 commit，这样连"知识库自身的演变历史"都可追溯、可对比、可回滚。

## 目录速查

| 路径 | 作用 |
|---|---|
| `AGENTS.md` | AI 维护规则（最重要） |
| `index.md` | "当前版本的我" + 全局导航 |
| `timeline.md` | 认知转变编年史 |
| `log.md` | 每次处理的操作流水 |
| `raw/` | 各平台原始对话（只读） |
| `wiki/insights` | 具体洞察 |
| `wiki/patterns` | 反复出现的模式 |
| `wiki/values` | 价值观与动机 |
| `wiki/questions` | 持续追问的问题 |
| `wiki/transitions` | 认知转折点 |
| `wiki/experiments` | 行动实验与结果 |
| `wiki/entities` | 重要的人/书/概念 |
| `scripts/` | 解析脚本与蒸馏提示词 |
| `queries/` | Obsidian 可视化查询示例 |
