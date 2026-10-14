# Passage

本地优先的 AI 外文科研论文阅读应用。原始 PDF 是唯一事实来源；译文、解释、笔记与来源预览属于辅助层。

## 使用开发版

macOS Apple Silicon：打开 `release/Passage-0.1.0-arm64.dmg`，将 Passage 拖入 Applications 后启动。此版本未经 Apple 公证；若系统阻止，使用系统设置的「隐私与安全性」检查开发版来源后打开。不要全局关闭系统安全保护。

1. 导入本地 PDF。原文件不会被修改，文献库保存受管副本。
2. 打开偏好设置，选择服务商，填写 API 地址、模型 ID 与自己的 API Key，保存后测试连接。
3. 选中文字，点击翻译或解释；也可以点击段落后使用阅读助手。
4. 问答来源先预览，点击「前往原文」才跳转；Alt+左右方向键返回/前进。
5. 按住 Alt 临时查看译文；开启双语栏后，停留在段落时按需翻译。双语模式会调用你选择的模型，后台预取目前关闭。
6. 笔记、高亮、书签、阅读位置与缓存自动保存。用量与费用在独立窗口查看。

所有外部 AI 请求从客户端直达用户选择的服务商。Passage 不提供中转服务器。密钥在宿主内使用系统加密；原文与笔记保存在本地 SQLite 和 PDF 目录。完整备份不包含密钥。

## 开发与验证

开发者需要 Node 24+（普通使用者不需要）。

```
npm ci
npm run test
npm run lint
npm run build
npm run desktop
npm run test:desktop
node scripts/ai-smoke.mjs
npm run package:mac
```

其他目标：`npm run package:win`、`npm run package:linux`；Android 使用 Java 21、Android SDK 36，运行 `npm run package:android`。生成 debug APK 与正式商店签名发布是不同阶段。

AI 集成测试使用明确标记的本地协议 fixture；不会把 fixture 当成真实模型或产品演示数据。真实厂商 Key 验收需要用户自己配置。

## 文档

- [架构与产品设计评审](docs/ARCHITECTURE.md)
- [验收与未完成项](docs/DELIVERY.md)
- [第三方许可证](docs/DEPENDENCIES.md)

跨平台构建由 `.github/workflows/build.yml` 定义。仓库未连接 GitHub 时，工作流仅是可运行配置，不能声称云端构建已经成功。正式签名、公证、Windows签名和商店发布需要相应账号及凭据。
