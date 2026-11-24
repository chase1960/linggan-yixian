# 灵感一现 · Personal LAB

平台无关的个人认知知识库与数字分身工作台：记录灵感、梳理知识关联、复盘行动，保留观点演变与原始证据。

本仓库按所有者明确要求作为公开备份，包含个人知识资料。站点代码中的私有接口仍保留身份校验；仓库中的 knowledge/ 是单独导出的可阅读快照。

## 在线入口（随时访问）

线上站点：<https://self-knowledge-hub-91da9b.fan200428.chatgpt.site/>

- [主工作台](https://self-knowledge-hub-91da9b.fan200428.chatgpt.site/)：随手记、收件箱整理、第一性原理分析、知识关联与行动结果。
- [经验学习和沉淀](https://self-knowledge-hub-91da9b.fan200428.chatgpt.site/learning/)：文章精读、方法候选、复查周期与个人能力证据。
- [导航与飞书文档入口](https://self-knowledge-hub-91da9b.fan200428.chatgpt.site/guide/)：七类认知说明、记录规则、四大领域文档入口。

访问说明：以上为 Sites 上的固定公开入口，2026-11-25 实测三个页面均正常返回。未登录只能看到公开演示内容（示例数据为虚构）；个人空间需登录后才可见。

> **红字「其他页面已更新这份资料」的原因**：旧版是整份文档覆盖 + 单版本比对，且边缘会改写版本凭证，导致比对永远失败、重试也失败。V5 已改为**差分合并写入 + D1 逐条存储**，并在本地补交未同步条目，详见[平台版说明](docs/platform-v5.md#1-线上为什么会出现红字其他页面已更新这份资料)。

> **HTML 占比高的原因**：`knowledge/index.html` 是 247 KB 的离线知识快照，不是应用页面；真正的服务端代码被 GitHub 当作构建产物排除在统计之外。后端是真实存在的（`app/worker/`），详见[平台版说明](docs/platform-v5.md#2-为什么-github-语言统计里-html-占比很高)。

## 直接阅读

- [当前知识正文](knowledge/wiki/)：62 篇 Markdown。
- [知识库离线页面](knowledge/index.html)：下载仓库后用浏览器打开，无需登录。
- [早期知识库导航](legacy-vault/index.md)、[成长时间线](legacy-vault/timeline.md)。
- [随手记与 WorkBuddy 模块规划](docs/inspiration-v4-plan.md)。
- [V4.1 十项优化说明](docs/optimization-v4.1.md)：检索、沉淀闭环、复盘包、分域导出与构建隐私。
- [增量写入与冲突恢复](docs/write-protocol.md)：线上复盘为何会卡在红底提示，以及现在的合并写入协议。
- [V5 平台版](docs/platform-v5.md)：D1 逐条存储、独立登录、每日快照、定时复查提醒，以及部署到自有 Cloudflare 的步骤。
- [WorkBuddy 文件协议](app/public/downloads/workbuddy-contract.md)与[上传脚本](app/public/downloads/workbuddy_upload.py)。

## 目录

| 路径 | 内容 |
|---|---|
| app/ | 当前 V4 工作台全部源码、测试、数据库迁移、构建产物和说明 |
| knowledge/ | 2026-11-18 18:24（北京时间）云端数据快照、Markdown、离线 HTML、原始批次及截图 |
| knowledge/data/ | 53 条历史知识、15 个来源、4 个文档引用、4 项技能；9 条随手记及5条原始消息；5篇学习文章和5项方法 |
| knowledge/raw/ | 已成功上传的原始批次与附件，清单保留来源校验 |
| legacy-vault/ | 早期 Markdown 整理版本、四段情感讨论复盘、分类索引及在线文档导出 |
| original-vault/ | 原上传的豆包知识库骨架、交接规则和解析工具 |
| docs/ | 导入范围、版本来源与设计规划 |
| CHECKSUMS.json | 除自身外所有文件的 SHA-256 与字节数 |

## 运行代码

使用 Node.js 22.13+（需 node:sqlite）或更新版本：

```sh
cd app
npm run build
npm test
npm run dev
```

打开 http://localhost:3000。默认是可交互示例；导出的个人资料保存在 knowledge/，不会自动注入公开网页。开发适配器使用本地数据目录；生产 R2、D1 与运行时配置见 [app/README.md](app/README.md)。此备份不含运行时密钥。

## 读取与恢复资料

```sh
python knowledge/restore_sqlite.py
```

在 knowledge/ 生成 knowledge.sqlite；archive 表按 collection、id 保存 JSON。它是便于查询的通用归档库，并非生产 D1 原表的直接镜像。JSON、Markdown 和原始附件保留可供再次迁移。

本次归档不等于已抓取全部聊天历史；已整理摘要和原始全文有明确区别。未上传的电脑资料、未连接的微信和飞书全文不在此次导出中。详细范围见 [来源说明](docs/import-provenance.md)。后续云端变化尚不会自动同步到 GitHub。


## 方法自进化

见 [闭环审查与操作说明](docs/evolution-loop.md)。CHECKSUMS.json 是 2026-11-18 原始备份快照的校验清单，请以 Git 提交树验证之后的代码修订。
