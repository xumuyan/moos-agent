# N01｜可信本机项目选择入口候选

N01保持未完成。独立Mac回环开发检查点，不是正式桌面集成、手机配对或长期身份。

## 接口与顺序

`createLocalPairingEntry({projects,pick,tls,present})`只构造控制器，不监听、不创建邀请。
`projects`必须由可信本机注册表提供1–8个规范项目ID；本候选不读取真实项目目录，不把网络提供的名称/路径变成授权项目。只有显式本机`entry.begin()`才打开选择器；`pick(snapshot,signal)`返回请求绑定的精确reply。

- 默认未选，至少选一个才可创建；Return/关窗/取消/最多60s超时均拒绝。
- 请求包含`version,requestId,projects,validForMs`，没有端点/邀请secret/receipt/token；项目数组与快照冻结。
- 回复仅`version,requestId,decision,projects`；拒绝必须空数组，选择必须为非空唯一子集。校验请求绑定、大小、范围和单调期限，拒绝尾换行/重复/额外字段。选中集合按可信注册表顺序复制，不能后续扩权。
- 通过后才`startLocalPairingFlow()`并`flow.begin()`，返回私密`material`给可信调用者；不打印、不自动剪贴板/保存/二维码/HTTP返回。已返回材料不能靠清字符串物理擦除。
- 单次入口；关闭/超时后的迟到选择不能起监听。关闭发生在异步flow创建期间时，`begin()`等待该创建返回并立即关闭，不生成材料；`close()`本身不声称已终止尚未返回的创建器。
- `reviewPending()`仍需显式本机动作，远端claim不自动确认。120s整轮截止由底层flow/authority限制，选择窗口不扩大配对或设备授权。

```js
// 所有回调、TLS、可执行路径、项目注册表来自可信本机代码，不能来自扫码/网页/对端。
import { createLocalPairingEntry } from './pairing-entry.mjs';
import { nativePairingPresenter } from './pairing-review-native.mjs';
const entry = createLocalPairingEntry({
  projects: ['project-a', 'project-b'], tls,
  pick: nativePairingPresenter(trustedPickerExecutable),
  present: nativePairingPresenter(trustedReviewExecutable)
});
const result = await entry.begin(); // 正常picker会前台激活；本机显式发起
// result.material只留在可信调用者；材料分发UI尚未实现。
// 单独本机动作：await entry.reviewPending();
await entry.close();
```

`startFlow`是可信本机依赖注入/测试接口，不是安全沙箱；同进程恶意代码可伪造选择或批准。原生外观、checkbox、摘要一致都不能替代首次身份引导/人工双端比较。

## 自动化与实际验收

```bash
node --test probes/nsh-validation/pairing-entry.test.mjs
node probes/nsh-validation/verify-pairing-entry.mjs
```

`PairingEntry.swift/Main`是AppKit原生项目选择面板，独立Swift6构建。隐藏控件测试检查默认未选、禁用创建、Return取消、选中/取消选中、空选择无效、过期/关窗拒绝、回复一次、非法schema；`--automation-deny`只拒绝，无自动原生创建命令。子进程拒绝经控制器核验后`startFlow`调用0次。
真实HTTPS测试中的选择和批准均为程序化回调，验证只为选中项目签发，未选项目404、close后连接不可用，不代表人工身份确认。自动化报告`humanSelectionVerified:false,humanConfirmationVerified:false,phoneVerified:false,windowShown:false`；正常前台GUI另记操作日志/证据，不用隐藏测试替代。

首轮4/5：临时证书operation2超时；显式复核5/5通过。追加失败清理及abort回调重入关闭防线后，最终6/6通过（entry-precommit.log）。正常前台候选窗口实际显示并截屏核对：默认两项目未选、创建禁用、取消为默认按钮；但事务截图因focus-unavailable停止，未派发点击/键盘，不把窗口观察算交互或人工双端确认。随后超时返回deny/空项目。截图在忽略目录artifacts/nsh-validation/pairing-entry-gui/initial-window.png。全仓结果见operatelog，不宣称全仓全绿。

## 未交付

没有生产项目注册表/目录绑定、可发布启动入口、可信邀请分发/手机对应显示、NSH handler、PI授权、持久化/崩溃恢复或LAN；已装手机仍是旧模拟包，未更新或安装。正常面板显示不证明人工双端核对，未修改系统CA/正式应用或用户数据。后续需独立评审转发、社会工程、UI仿冒、DoS和长期身份/恢复再推进手机。
