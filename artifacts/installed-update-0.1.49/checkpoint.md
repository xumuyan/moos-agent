# 0.1.49 安装交接检查点（2026-11-13 12:05 +08:00）

- 用户已明确授权安装（三步方案 C）。候选：.generated/moos-electron/build-3v6RdT（0.1.49，includesPiFixture=false，签名 strict 通过）。
- staged：/Applications/.moos-update-0.1.49/沐码.app（ditto 后再次签名校验通过）。
- `node update.mjs --preflight` = PREFLIGHT_OK（全树 diff 门禁 + bundle diff + 6 exit 门 + 本轮/历史标记 + 数据可读性）。
- 交接：update.command 由 Terminal 执行（nohup 后台，祖先链脱离沐码）；结果文件 /Applications/.moos-update-0.1.49/result.json，日志 update.log。
- 恢复约定：result.json state=success 且数据核对通过才可宣称完成；任何 stopped-for-review 保留备份与旧包，不删除数据重试。
