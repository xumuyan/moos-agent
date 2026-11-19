# N01-D3｜同款箭头与悬停反馈

接续 `c531c2e`。模型菜单关闭时向下、展开时向上；两项子菜单入口用同套右箭头。轮廓来自本机已安装 DSH 0.2.2-rc.1 `dsh-web-frontend/dist/assets/index-BgUyXZcc.js` 内 `chevron-{down,up,right}-outline` 的 16 单位视口／regular 描边／14pt 图标；使用现有 Canvas 图标组件及 [MIT 许可](DSH-ICONS-LICENSE.txt)，不依赖文本字符或字体回退。

模型按钮、顶部侧栏开关、左下角设置共用深蓝半透明圆角底，指针移入加强底色、移开复原，不改变布局。可用按钮保留按压和键盘可见焦点反馈；设置仍是禁用按钮，只有外层绘制悬停底色，不提供假点击、设置面板或权限变更。模型选择、共享发送／停止、事件排空、人物、背景和边饰不改。

## 本机独立验收

```sh
node probes/nsh-validation/verify-desktop-theme.mjs --control-hover
node probes/nsh-validation/verify-desktop-theme.mjs --control-hover --art-root "$AUTHORIZED_ART_ROOT"
python3 probes/nsh-validation/check-control-hover-pixels.py <run-directory>
```

- NSH 0.5.0 AppKit 开发宿主，macOS 27.0.1 arm64，1×；带艺术 `run-1MFUzI`、无艺术 `run-DA9lI4`，各 2/2、24 帧，明暗分别宽 1240×820、窄 680×720。证据绑定提交前的混合工作区（非干净检出）。
- 原生驱动检查向上／向下互换、根层右箭头、Esc 合上、悬停不打开菜单且三处布局不变、设置始终禁用。像素校验用实测布局换算裁域：每次只在目标区域中出现大面积变化，另外两个控制区域不变，移开后三区恢复原像素。两套矩阵共 24 个目标区域通过，不等于真人鼠标或 Retina 验收。
- 带艺术示例只存本机 `artifacts/nsh-validation/desktop-theme/run-1MFUzI/`：`controls-dark-680-picker.png`、`controls-dark-680-navigation.png`、`controls-dark-680-settings.png`、`controls-dark-680-open.png`。本地 Pillow 12.2.0 用于截图比对；不将艺术或截图写入 Git。未新增正式窗口截图。
- 首轮 `run-2T7w1Q` 0/2，驱动等待空态并未登记的几何；改等确实登记的输入操作区，再用可见空态作移开目标。原始失败保留。后续完整输入区回归在带艺术 `run-3GHJhb`、无艺术 `run-3ibA2Z` 均 2/2，含模型搜索、等级切换、停止及排空。

完整回执：[desktop-control-hover-verification.json](desktop-control-hover-verification.json)，原始日志在 `artifacts/nsh-validation/control-hover/`。真实 PI＋本地回环的 Host 回归独立于上述合成截图。用户视觉确认、真人 GUI、2×、IME、真实 PI 与 GUI 整合、干净签名包、同负载资源测量及全量门禁未完成。E124 仍缺原始证据，Rust 缺离线 `defmt`，Electron 的隔离 DSH 前置仍缺。仅本地检查点，不推送、不部署，不动正式应用或其数据，手机暂停。
