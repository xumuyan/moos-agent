# 图片皮肤插件

「设置 → 插件」可安装本地 ZIP 或文件夹。插件包根目录包含 `plugin.json`，图片是包内的普通文件。安装后先启用，回到「设置 → 主题」选中皮肤，检查预览后点击「应用此皮肤」。应用后重启会恢复已启用的皮肤。切回默认、停用或卸载会移除插件背景。

`apps/desktop/examples/dusk-image-skin` 是可直接安装的「薄暮」示例。制作自己的皮肤时复制该文件夹，为插件填写新的 `id` 和 `name`，替换 `assets/dusk.png`，并在 `backgroundMedia.src` 填写图片相对于包根目录的路径。使用 ZIP 时将 `plugin.json` 和 `assets/` 放在压缩包根目录。

| `backgroundMedia` 字段 | 支持的值 |
| --- | --- |
| `type` | `image` |
| `src` | 包内的 PNG、JPEG 或 WebP。单文件最多 1 MiB，解码尺寸最多 2000 万像素。 |
| `maskOpacity` | 遮罩 0–0.75，默认 0.22 |
| `surfaceOpacity` | 面板不透明度 0.35–1，默认 0.82。正文和输入区有可读性下限。 |
| `blur` | 面板模糊 0–24 像素，默认 8 |

主题使用 `type: "theme"` 和空 `slots`、`permissions`，沿用 Moos 白名单色彩与区域样式。`backgroundMedia` 借鉴 [菲比皮肤的资源声明与安装流程](https://github.com/Theater-ahyeon/phoebe-atelier)，采用 Moos 的 `plugin.json` 格式。DSH 的 CSS、角色分层和 hooks 需要各自的运行时，本格式只读取声明的静态图片与效果参数。示例使用 Moos 自有渐变素材。

升级前已保存的背景可在主题页的「旧版背景图片」继续管理。图片插件应用期间优先显示插件的图片。切回默认时，已保存的旧背景仍可显示，用户可在旧版入口中移除它。
