# pi-claude-style

可插拔的 Pi CLI 显示包：Claude Code 风格的紧凑工具输出 + 明暗主题。

**已在 Pi 1.0.4 验证。** 依赖 `registerToolRenderer`、`renderShell: "self"` 和主题对象 API；不承诺兼容未测试的旧版本。这是 Pi 包，不是 PI-Desktop 插件，也不是 Claude Code 的官方产品。

## 一次安装

推荐从 GitHub 安装固定版本：

```bash
pi install git:github.com/sephiroth233/pi-claude-style@v0.1.1
```

也可以安装 `main` 分支：

```bash
pi install git:github.com/sephiroth233/pi-claude-style@main
```

本地开发或离线分发时，把完整目录放在长期保留的位置，然后运行：

```bash
pi install /完整路径/pi-claude-style
```

重启 Pi，或在现有会话执行 `/reload`。默认开启，首次加载不会写入全局主题设置，也不会创建偏好文件。

本地安装直接引用该目录，不会复制源码。因此不要安装后删除或移动目录。不需要执行 `npm install`：运行时仅依赖 Pi 提供的模块和 Node 内置模块。

仅对当前项目安装：

```bash
pi install -l /完整路径/pi-claude-style
```

项目资源需要 Pi 的项目信任许可。

## 开关与主题

在 Pi 输入框输入：

```text
/claude-style status
/claude-style off
/claude-style on
/claude-style theme none
/claude-style theme auto
/claude-style theme light
/claude-style theme dark
```

- `off`：不注册工具渲染器，恢复原生/其他扩展渲染与原配色。
- `on`：启用紧凑输出。状态跨重启保留。
- `theme none`：只精简工具显示，保留自己的主题。
- `theme auto`（默认）：按加载时当前主题的明暗选择对应主题；不是运行期间监听系统外观变化。
- `theme light/dark`：强制使用对应配色。
- 更改后会自动重新加载资源，因此历史工具块也会重建。
- Ctrl+O 或点击工具内容可展开原始参数和完整工具返回文本。

开关保存于 `<Pi agent dir>/claude-style.json`，通常是 `~/.pi/agent/claude-style.json`：

```json
{
  "enabled": true,
  "theme": "auto"
}
```

可以手动编辑，然后 `/reload`。支持 Pi 的自定义 agent 目录；偏好按用户配置目录共享，不是按项目隔离。

## 包级禁用和卸载

运行 `pi config` 可以禁用本包的扩展或主题，再 `/reload`。不加载扩展时，`/claude-style` 命令也不可用。

卸载时，使用安装时的来源。固定版本的 GitHub 安装：

```bash
pi remove git:github.com/sephiroth233/pi-claude-style@v0.1.1
```

本地安装：

```bash
pi remove /完整路径/pi-claude-style
```

再 `/reload` 或重启。该包仅会话级应用主题，不改 `settings.json` 的主题字段，所以卸载后自然回到自己的主题。偏好文件可以保留供重装使用；想清除偏好时手动删除 `claude-style.json`。

本地包源码仍留在原目录。运行中的进程要重新加载或重启才能停止使用已加载资源。

## 显示范围

- 工具标题单行显示，路径优先相对化；长命令不再铺满屏幕。
- 成功结果一行摘要；失败最多三行预览；Edit 最多六行 diff。
- 去掉工具背景块、内边距和重复耗时。
- 多文本块、图片宿主显示、截断警告和完整输出文件路径仍保留。
- 不替换执行工具，不改模型上下文、保存的工具结果、模型配置或提供商。
- 不修改输入编辑器、快捷键和补全。
- 启用时接管工具显示，因此不建议与其他接管同一工具显示的扩展同时启用；`off` 时不干预解析链。

没有自动隐藏启动提示或思考内容。如果需要，可以自行在 Pi `/settings` 配置，避免本包修改你的全局偏好。

## 检查与分享

```bash
cd /完整路径/pi-claude-style
npm test
```

测试默认寻找 Pi 管理的本机安装。使用其他安装布局时指定：

```bash
PI_TEST_HOST_DIR=/路径/node_modules/@earendil-works/pi-coding-agent npm test
```

测试在临时 agent 目录执行，不修改真实偏好或调用模型。主题配色基于 Pi 内置主题。

源码通过本 GitHub 仓库分发，尚未发布到 npm。也可以复制整个目录或自行打包分发；解压后执行 `pi install /解压路径/pi-claude-style`。`package.json` 保留 `private: true`，避免意外发布到 npm；它不影响通过 Git 或本地目录安装。
