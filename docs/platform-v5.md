# V5 平台版：自托管、逐条存储、定时复查

本文说明「灵感一现」从 Sites 演示站升级为可长期运行的中台（Cloudflare Workers + D1 + R2）后，能力边界、部署方式与运维要点。

## 1. 线上为什么会出现红字「其他页面已更新这份资料」

旧版写入是**整份文档覆盖 + 单版本号比对**：客户端把整个工作台 JSON 连同一个版本凭证一起 `PUT` 上去，服务端只要发现版本落后一次，就整次拒绝（HTTP 409）。

三个问题叠加，导致它几乎必然卡住：

| 问题 | 后果 |
|---|---|
| 整份覆盖 | 另一个页面刚存过，本页所有修改全部作废 |
| 版本凭证来自响应头 | 托管边缘会把 `ETag` 改写成弱校验值（`W/"..."`），客户端拿到的字符串与后端记录的不是同一个，比对必然失败 |
| 「重试」用同一份旧凭证再发 | 永远 409，形成死循环；页面上只剩一条红条和「重试保存」 |

V5 的修复分两层：

- **写入改为差分**：客户端只提交新增/修改的条目（`POST /api/workspace/apply`），服务端读到最新状态、合并、版本 +1、写入；并发冲突自动重试 5 次，不再整份作废。
- **存储改为逐条**：D1 里一行一条（`ds_entity` 主键 `collection + id`），每次写入同批写一条历史（`ds_history`）。任何一条写入都不会覆盖别的条目。

客户端在写入失败时把待同步条目暂存本地（`localStorage['inspiration-pending-v1']`），页面刷新后自动补交；横幅按钮变成「重试同步」/「下载本页记录」，不再是死循环。

## 2. 为什么 GitHub 语言统计里 HTML 占比很高

仓库里 HTML 体积大，是因为 `knowledge/index.html` 是一个 247 KB 的**离线阅读快照**（62 篇知识内联在里面），不是应用页面。GitHub 的语言统计按字节算：

| 语言 | 体积 | 主要来源 |
|---|---|---|
| HTML | 258 KB | `knowledge/index.html`（247 KB 离线快照） |
| JavaScript | 98 KB | `app/public/*.js`、worker |
| Python | 39 KB | `knowledge/` 导入与校验脚本 |

真正的服务端 `app/dist/server/index.js`（约 620 KB）被 GitHub 当作**构建产物**排除，所以完全不计入统计。仓库里一共只有 5 个 HTML 文件，其中 4 个是页面壳，没有业务逻辑。

`.gitattributes` 已把 `knowledge/**`、`docs/**`、`legacy-vault/**`、`original-vault/**` 标为文档、`app/dist/**` 标为生成物，统计会逐步回落到以 JavaScript 为主。

## 3. 后端到底是不是真的

是。仓库里两套后端代码都在，且都在跑：

| 组件 | 位置 | 职责 |
|---|---|---|
| 工作台 API | `app/worker/index.js` | 身份、工作台读写、备份恢复、提醒、健康检查 |
| 平台层 | `app/worker/platform.js` | D1 逐条存储、版本流水、会话、快照、定时任务 |
| 随手记 API | `app/worker/capture.js` | 收件箱、附件、学习分支、复用与沉淀 |
| 表结构 | `app/migrations/0001_platform.sql`、`app/db/schema.ts` | D1 表与索引 |

区别只在于：旧站点的数据落在 R2 的单个 JSON（`owner/digital-self-v2/workspace.json`，上限 2 MB），D1 只服务随手记子系统；V5 把工作台本体也搬进 D1，R2 继续存附件与快照。未绑定 D1 的环境仍可回退到 JSON 文档模式。

## 4. V5 新增的能力

- **逐条存储与历史**：`ds_entity` 存当前值，`ds_history` 存每次变更快照，可按条目回溯。
- **独立登录**：`SITE_ACCESS_CODE` 口令登录，会话 30 天，Cookie `HttpOnly` + `SameSite=Lax` + HMAC 签名；同 IP 每小时最多 8 次失败尝试。
- **每日快照**：Cron `0 1 * * *`（北京时间 09:00）自动写 R2 `backups/state-<时间>.json`，保留最近 30 份，索引写入 `backups/index.json`，`/api/health` 暴露 `lastSnapshot`。
- **复查提醒**：定时任务扫描 `review: pending` 且有 `reviewAt` 的记录，写站内提醒（`ds_notice`），前端横幅展示并可「知道了」。
- **备份/恢复 API**：`POST /api/workspace/backup`、`GET /api/workspace/backups`、`POST /api/workspace/restore`（需 `confirm:true`，恢复前自动再打一份 `before-restore` 快照）。
- **监控**：`GET /api/health` 返回版本、存储引擎、鉴权模式、`dbReady`、`revision`、`lastCron`、未读提醒数，可直接做外部拨测。

## 5. 部署到自己的 Cloudflare（一次约 15 分钟）

前提：一个 Cloudflare 账号、一个自有域名（可选，先用 `*.workers.dev` 也能跑）。

```sh
cd app
npm install
npx wrangler login

# 1) 建库与桶（记下 D1 的 database_id，填回 wrangler.toml）
npx wrangler d1 create linggan-state
npx wrangler r2 bucket create linggan-assets

# 2) 写入表结构（也可跳过，Worker 首次启动会自动建表）
npx wrangler d1 execute linggan-state --remote --file migrations/0001_platform.sql

# 3) 配置密钥
npx wrangler secret put SITE_ACCESS_CODE      # 登录口令，自己设
npx wrangler secret put SESSION_SECRET        # 随便一长串随机字符
npx wrangler secret put WORKSPACE_SERVICE_TOKEN  # 备份/迁移脚本用的服务令牌
# 可选：FEISHU_WEBHOOK_URL（提醒推到飞书群）、SITE_URL（对外地址，用于同源校验）

# 4) 部署与自检
npm run build
npx wrangler deploy
npm run check
```

首次打开 `https://<你的域名>/` → 自动跳到 `/login` → 输入口令 → 进入工作台。数据为空时页面会提示「尚未初始化」，用 `POST /api/bootstrap`（带服务令牌）导入 `knowledge/` 快照即可。

### 迁移旧数据

旧站点数据在 R2 的 `owner/digital-self-v2/workspace.json`。首次启动时平台层会自动把它导入 D1 并写一条「数据已迁入逐条存储」提醒；导入只在 `ds_meta.schemaVersion` 缺失时发生一次，不会覆盖后续修改。

### 绑定自有域名

```toml
# wrangler.toml
routes = [{ pattern = "lab.example.com", custom_domain = true }]
```

在 Cloudflare 面板把该子域指向 Worker，DNS 由 Cloudflare 托管即可。

## 6. 运维与回滚

- **健康检查**：`curl https://<域名>/api/health`，关注 `dbReady`、`revision` 是否推进、`lastCron` 是否在 24 小时内。
- **每日快照**：`GET /api/workspace/backups` 列出 R2 里的快照；恢复走 `POST /api/workspace/restore`。
- **回滚到旧站点**：Sites 旧站保持不动，可直接切回；V5 不回写旧 JSON，避免两边互相覆盖。
- **限额**：单次差分最多 300 条；单次请求体 2 MB；`records` 等集合按白名单校验。

## 7. 已验证

`npm test` 覆盖 65 项，其中平台层 6 项：D1 逐条存储与历史、并发提交互不覆盖、备份/恢复、口令登录（错/对/匿名/会话/登出）、定时任务（快照 + 提醒 + 健康）。本地 `npm run dev` 全链路冒烟：健康检查 → 登录 → 差分写入 → 备份 → 回读，均通过。
