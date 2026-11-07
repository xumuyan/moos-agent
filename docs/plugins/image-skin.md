# 图片皮肤插件

「设置 → 插件」可安装本地 ZIP 或文件夹。Moos 皮肤使用 `plugin.json`，DSH 皮肤中心发行的 v2 皮肤使用 `skin.json`。通过校验后，皮肤会自动启用并应用到当前窗口。重启会恢复正在使用的皮肤。在同一页点击「使用」可切换已启用的皮肤，点击「恢复默认外观」或停用正在使用的皮肤可移除它的背景。

`apps/desktop/examples/dusk-image-skin` 是可直接安装的「薄暮」示例。制作自己的皮肤时复制该文件夹，为插件填写新的 `id` 和 `name`，替换 `assets/dusk.png`，并在 `backgroundMedia.src` 填写图片相对于包根目录的路径。使用 ZIP 时将 `plugin.json` 和 `assets/` 放在压缩包根目录。

| `backgroundMedia` 字段 | 支持的值 |
| --- | --- |
| `type` | `image` |
| `src` | 包内的 PNG、JPEG 或 WebP。单文件最多 1 MiB，解码尺寸最多 2000 万像素。 |
| `maskOpacity` | 遮罩 0–0.75，默认 0.22 |
| `surfaceOpacity` | 面板不透明度 0.35–1，默认 0.82。正文和输入区有可读性下限。 |
| `blur` | 面板模糊 0–24 像素，默认 8 |

主题使用 `type: "theme"` 和空 `slots`、`permissions`，沿用 Moos 白名单色彩与区域样式。`backgroundMedia` 借鉴 [菲比皮肤的资源声明与安装流程](https://github.com/Theater-ahyeon/phoebe-atelier)，采用 Moos 的 `plugin.json` 格式。DSH 的 CSS、角色分层和 hooks 需要各自的运行时，本格式只读取声明的静态图片与效果参数。示例使用 Moos 自有渐变素材。

升级前已保存的背景可在插件页的「旧版背景图片」继续管理。图片插件应用期间优先显示插件的图片。切回默认时，已保存的旧背景仍可显示，用户可在旧版入口中移除它。

## 直接安装 DSH 皮肤

在「设置 → 插件」选择含 `skin.json` 的 DSH v2 皮肤目录或 ZIP。ZIP 可以在根目录直接放资源，也可以有一层皮肤目录。可使用 [深海女仆工坊 v2 原包](https://github.com/yudukongchen/dsh-client-ui-skin-center/tree/85047d9cacb375f20bc8fabee4b3829fdfe47128/skins/maid-atelier) 验证。完整包仍受 5 MiB 总量和 1 MiB 单文件限制。

Moos 读取 `backgroundMedia.light` 的静态图，缺少浅色图时选深色图，并从 `skin.css` 的简单 `:root` 声明提取白名单十六进制色值。显示采用 Moos 的面板和遮罩。插件页会标记「DSH 静态皮肤」。DSH 的角色挂件、动画脚本、自由样式补丁和视频属于其运行时能力。旧版带 Cordis 客户端入口的皮肤和必须加载扩展的包需要对应的 DSH 环境。
