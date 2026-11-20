# 归档核验

- 2026-11-18 执行应用 43 项测试：全部通过。
- npm run build 成功；21 个静态资源，Worker 552001 字节。
- app/ 与源版本 11 的已跟踪文件逐字节一致。
- 本次云端导出 ZIP 可完整解压，73 个文件；manifest 每一项的字节数和 SHA-256 均通过。
- restore_sqlite.py 实际运行成功，SQLite integrity_check 为 ok；SQLite 可随时从原始 JSON 再生成。
- 226 个待归档文件经过常见令牌与私钥格式扫描，未发现匹配；扫描涵盖 DOCX 内部 XML。
- GitHub 写入尝试被提供方以 403 Resource not accessible by integration 拒绝，未产生提交。此文件不表示 GitHub 推送已成功。
