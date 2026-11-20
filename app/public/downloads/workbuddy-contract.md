# WorkBuddy → 灵感一现 V4

知识库入口：进入个人空间 → 随手记 → 同步设置。

1. 下载 workbuddy_upload.py 和私有 workbuddy-upload-config.json；配置含专用上传凭证，不要粘贴进对话、消息或公开仓库。原文与任务不包含该配置。
2. 在你的固定目录保存 batches/批次编号/messages.jsonl、analysis.jsonl、manifest.json、attachments/。
3. 生成完整批次后运行 `python workbuddy_upload.py --root "固定目录" --config "配置文件路径"`。
4. 上传程序负责生成校验清单、固定上传包、重试与读取回执。成功后记录 sync-state.json 和批次 receipt.json。已发送批次不可修改；内容变化生成新批次/新版本编号。
5. 原消息 id 必须稳定；格式限定英文字母、数字、点、下划线、冒号、短横线，最长128字符。附件放 attachments/ 下，文件名使用英文、数字、点、下划线、短横线，不能包含子目录。
6. 上传权限只能新增批次和查询本连接批次回执，不可读取私人知识库、覆盖任务状态或代为执行外部行为。

## 文件格式

manifest.json 最少包含：
```json
{"schema_version":1,"batch_id":"wb-20261114-001","producer":"workbuddy","captured_at":"2026-11-14T18:00:00+08:00","status":"success","source_scope":"我明确授权的随手记对话"}
```
上传程序生成正式 files 校验清单。未取得消息时只能在实际采集成功且确无新增时用 status=no_change，两份JSONL为空。读取失败应由本地任务报告失败，不上传成功心跳。

messages.jsonl 每行格式（示例为虚构内容）：
```json
{"id":"wb-msg-example-01","text":"待办：修改演示项目简介","source_timestamp":null,"authorship":"user_original","attachments":[]}
```
authorship 可选 user_original / ai_quote / other_quote / unknown。发送者是本人不等于本人原创。原始时间不明必须为 null，禁止用采集时间替代。

analysis.jsonl 每行格式：
```json
{"id":"wb-item-example-01","source_ids":["wb-msg-example-01"],"kind":"task","domain":"build","title":"修改演示项目简介","next_action":"明确介绍中的问题与验证方式","acceptance_criteria":"形成一份可审阅草稿","due_at":null,"summary":"虚构格式样例","principles_draft":{"phenomenon":"记录中提到需要修改简介","assumptions":"修改范围尚不明确","next_test":"先明确这次修改的目标"}}
```
kind 可选 task / idea / question / project / learning；domain 可选 personal / business / knowledge / build。source_ids 必须全部来自同一批 messages.jsonl。

截止时间 due_at 若提供，必须是包含时区的ISO日期时间，同时提供 deadline_quote，内容必须能在原消息中逐字找到。没有依据就留 null。新项始终 inbox、待本人判断，不可提交 done/doing 或认同状态。分析草稿保存在原始分析区；本人整理的分析另存，不覆盖采集端原分析。

## 可直接交给 WorkBuddy 的任务说明

只处理我明确授权的对话范围。先用少量消息验证读取能力，不能假设已获得全部历史。保留每条原消息与附件，按上述协议生成批次。拆出待办、观念、问题、目标/项目和学习线索，所有分析引用原消息。原文、推断、建议分开；AI转贴不当作本人已认同观念；原始日期不明写null，不擅自安排截止时间。

对复杂观念按现象、目标、事实与约束、假设、候选机制、替代解释/反例和最小验证行动整理为 principles_draft。原文中的对象不清楚就标为未知，不擅自改成另一作者或项目。

先试运行一个批次，确认来源、固定目录和输出正确，再按我确认的频率建立定时任务。每次批次完成后调用固定上传程序，收到成功回执才标为同步成功。网络失败保留批次等待重试；采集失败不能当作无新增。不代为报名、投递、发消息或删除聊天记录。

定时频率与时段由我明确提供。本地微信读取依赖相应设备、客户端及授权可用；云端任务不能自动读取本地微信。

## 当前能力边界

程序上传后网站会显示最新数据，无需每次重新发布。新记录在收件箱中可整理为任务或观念，日期和认同由本人确认。日历导出可用于外部提醒，但不自动回传完成状态，也不保证通知权限已启用。实时LLM分析、独立账号迁移与微信自动采集本身不由此上传程序实现。
