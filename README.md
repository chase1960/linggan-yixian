# 灵感一现 · Personal LAB

平台无关的个人认知知识库与数字分身工作台：记录灵感、梳理知识关联、复盘行动，保留观点演变与原始证据。

本仓库按所有者明确要求作为公开备份，包含个人知识资料。站点代码中的私有接口仍保留身份校验；仓库中的 knowledge/ 是单独导出的可阅读快照。

## 直接阅读

- [当前知识正文](knowledge/wiki/)：62 篇 Markdown。
- [知识库离线页面](knowledge/index.html)：下载仓库后用浏览器打开，无需登录。
- [早期知识库导航](legacy-vault/index.md)、[成长时间线](legacy-vault/timeline.md)。
- [随手记与 WorkBuddy 模块规划](docs/inspiration-v4-plan.md)。
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
