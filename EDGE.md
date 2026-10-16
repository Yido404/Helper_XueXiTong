# Microsoft Edge 安装说明

课序助手 v1.0.3 使用 Manifest V3，保留播放、章节切换、测验跳过、未完成任务弹窗处理和手动标记，并增加“暂无内容”章节自动跳过。

## 安装

1. 下载本仓库 ZIP 或 Edge 安装包，解压到一个准备长期保留的文件夹。
2. 打开 Microsoft Edge，在地址栏输入 `edge://extensions`。
3. 打开“开发人员模式／开发者模式”。不同 Edge 版本的文字或位置可能略有区别。
4. 点击“加载解压缩的扩展／加载已解压的扩展程序”，选择直接包含 `manifest.json` 的文件夹。
5. 在 Edge 扩展菜单中将“课序助手”显示在工具栏。
6. 在 Edge 中登录课程网站，打开章节学习页面，刷新一次，再点击插件的“开始当前课程”。

GitHub 下载的文件夹通常为 `browser-extension-main`；单独的 Edge ZIP 内为 `browser-extension-edge`。选择时以文件夹内能看到 `manifest.json` 为准。

请使用较新的 Microsoft Edge。本插件使用的 Chromium 扩展接口按 120 及以上版本配置。

## 使用和更新

- 默认静音自动播放；自动播放被阻止时，先手动播放一次视频，再启动插件。
- 需要手动标记时，在插件面板选择标记类型，然后点击网页上的对应控件。
- 遇到测试只跳过，不答题、不提交；跳过不会使任务点变为已完成。
- 当前章节明确显示“暂无内容”且约 8 秒未检测到视频、播放器或加载状态时，会自动点击下一节。单纯白屏仍等待识别，避免误跳正在加载的内容。
- 安装后保留源文件夹。更新时停止插件，覆盖原文件夹，在 `edge://extensions` 点击“重新加载”，然后刷新课程页。
- Chrome 与 Edge 的运行状态、手动标记和网站授权保存在各自浏览器中，不会自动同步。首次在 Edge 使用时可能需要重新标记。

## 验证范围

已通过 31 项本地回归检查，并在 Chromium 测试浏览器中验证延迟加载的视频、跨来源 iframe、测验跳过、二次确认、空章节跳过和末节停止。暂无内容界面依据截图复现，尚未用本次修复在真实课程账号或 Edge 实机上验证。

参考：[微软扩展迁移说明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)、[Edge 本地加载步骤](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)。
