# E132：点击后有界只读稳定观察（候选，未安装）

2026-11-12 macOS 27.0.1 arm64；两项系统权限已授予、2显示器。MuSu045保持原源码/安装/任务不变。
候选沐码0.1.47 build-NtlJnq 的**包内 desktop-tools、settle 模块及 helper**直接执行，未启动候选 GUI、未替换/重启正式沐码。
透明临时 wrapper 仅转发到包内 helper 并记录 mode/exit/预期焦点/实际焦点，不修改原生行为、不采集文本值/窗口标题。

## 观察/动作/结果
- runner24（179–181）截图前台窗口不符拒绝；runner25（182–185）显式激活因焦点变化停止。均dispose，不自动抢回/重放。
- runner26（186–193）浏览器侧栏点击后截图确认离线浏览器；单次点任务侧栏posted，但截图仍为浏览器：语义失败，未自动重试，end核对后dispose。
- 独立runner27（194–201）新事务2ab8fc04-ca65-4c21-897a-23fd531a68f3，新截图确认离线浏览器；一次任务侧栏点击并新截图确认任务页/AXWindow未聚焦。
- command198仅一次点击(1690,594)。随后只读focus依次内层218×18、外层240×42、外层、外层；连续3次完整一致后，capture前读取仍外层；截图及capture后焦点严格相同。
- command199新截图手工读到空搜索框已聚焦（有光标），取得新的observation；command200最终截图手工核实空/聚焦，end.resultObservationConfirmed=true，businessGoalVerified=false；201 dispose。未输入文字。

before/focused/final为搜索区域局部裁剪，不含任务卡；原图已人工回读。哈希及原始文件名见JSON。focus-sequence只含最后一次点击后的元数据，1次click、4次稳定观察、capture前focus/screenshot/后focus；它不是AX对象身份或事件送达ACK。

## 边界
三次完整快照一致只用于结果观察，不以AX path相同证明同一对象或授权输入；新的输入仍须新截图/一次性observation和原生严格焦点、遮挡检查。
最多6读/2000ms（另有helper有界退出），100ms间隔，候选role/path及app/window/bounds变化、取消、超时即停；截图中漂移继续拒绝、不发布被拒图片、不重放事件。
未修复“posted但未切页”及前置Tab拒绝原因；多窗口/真实遮挡/副屏/并发、正式聊天截图桥仍未实机验收。合成helper回归不是上述实机验收。P06.3a/P06.6未勾选。
