# M01 iPhone 原生运行及局域网探针

此目录只有独立测试页，不是正式手机客户端。已在 iPhone14,2 / iOS 27.0.1、HBuilderX 5.34.2026102909（uni-app x 编译器 5.34、VDOM）完成真机安装启动及 Wi-Fi HTTP 健康检查。

## 复现前置条件

- HBuilderX 已登录，并安装官方 uni-app x 编译器/真机运行组件。
- Xcode 登录用户自己的 Apple 账号，本机已有有效 Apple Development 身份。
- iPhone 已开启开发者模式并信任电脑，初次启动开发 App 时由用户完成开发者信任。
- 本机已有 xcodegen；签名时若系统询问私钥访问，由用户在钥匙串窗口授权。

## 本机操作

从仓库根目录将工程导入 HBuilderX：

```sh
/Applications/HBuilderX.app/Contents/MacOS/cli project open --path "$PWD/probes/m01/mobile/moos-m01-mobile"
npm run probe:ios:profile
npm run probe:ios:sign
```

profile 脚本从唯一已配对 iPhone 读取最新连接状态，用现有本机签名团队调用 Xcode 自动签名和设备注册；多设备时直接执行 `python3 scripts/prepare-ios-profile.py --device '<本机设备名称或标识>'`。生成的原生空工程仅用于 profile，不替代 uni-app x 页面，也不作为手机客户端交付。

签名脚本读取官方基座及匹配的开发 profile，验证有效期、bundle ID、开发用途和已注册设备，复用本机私钥对嵌套组件/基座签名，再严格验证。只给 M01 测试包签名，不请求 Apple 登录或推送能力。生成的 profile、IPA、团队/设备信息留在忽略目录，不能提交仓库或发到聊天。

安装并运行：

```sh
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-ios --project "$PWD/probes/m01/mobile/moos-m01-mobile" --playground custom --customType local
```

Mac 上另开终端执行 `npm run probe:health`，保持 iPhone 与 Mac 同 Wi-Fi。在手机页面输入 `http://<Mac局域网IP>:43101` 或可解析的 `.local` 主机地址，点击“检查连接”。本地网络权限请求由用户允许。测试结束在服务终端按 Ctrl+C 停止。

本次 HBuilderX CLI 的 pageQuery 没有传到页面，页面日志 originProvided=false，所以验收时实际手动输入地址，不能声称自动发现/自动配对已完成。

## 验收与限制

验收依据：页面校验服务名称、协议版本和本次 probeId；手机输出 `M01_HTTP_HEALTH_PASSED network=wifi challenge=matched`；Mac 输出 `health-response fromLoopback=false`；用户确认页面成功。脱敏记录见 `../evidence/ios-mobile-runtime.json`，不保存手机唯一标识、证书主体或原始网络载荷。

健康服务只返回非敏感的挑战响应，不提供任务/文件/模型接口。HTTP 在本阶段仅作本地连通性探针，未关闭 TLS 校验；生产手机连接仍须采用认证、加密和服务器身份验证。TLS、扫码、事件通道和远程任务全部未验收。

检查命令：`npm test` 覆盖地址/响应策略、健康接口和页面脚本语法；`npm run test:docs` 覆盖 profile 策略和证据一致性。真实 iOS 编译、安装、启动和权限结果另按实际日志记录，不能仅看 CLI 退出码。
