# M01 Apple Development 身份无效排查

- 症状：匹配身份 1，有效身份 0；手机开发者模式及 USB 连接正常。
- 原因：开发证书由 WWDR G3 签发，已有旧 WWDR 中间证书于 2023 年到期；本机缺少匹配的 G3 公共中间证书。
- 验证：叶证书验证虽返回 0，但身份有效性检查仍为 0；导入已通过系统链验证的官方 G3 证书后，原开发身份立即成为有效身份，有效计数为 1。
- 处理：只导入 Apple 官方公开中间证书至登录钥匙串，保留默认信任策略；未导出私钥、修改信任策略或重建用户开发证书。
- 证据：probes/m01/evidence/ios-signing-ready.json；不保存用户证书主体、指纹、Team ID 或设备唯一标识。
- 回归：有效身份检测与文档契约测试；实际 app 签名、profile 与安装仍未验收。
- 状态：DONE_WITH_CONCERNS，身份可识别已验证，不代表应用可安装。
- 官方来源：https://developer.apple.com/help/account/certificates/wwdr-intermediate-certificates
