# 灵感一现可迁移阅读包

双击 index.html 离线阅读；wiki/ 是可用文本编辑器打开的 Markdown。data/ 保留个人空间、经验学习和随手记关系/版本；raw/ 保留已导入批次和全部已上传附件。

运行 python restore_sqlite.py 可在本地生成 knowledge.sqlite；archive 表按 collection、id 保存完整 JSON，可进一步转换关系表。此包不含访问凭证，不能替代网站登录。文件副本编辑不自动回写线上。

导出包含已成功上传的数据，不含仍在电脑等待上传的批次，或只存在于未连接微信/飞书的文件。各独立分支为导出时读取快照。
