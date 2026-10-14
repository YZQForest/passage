# 第三方依赖与许可证

检查日期：2026-10-04。版本由 package-lock.json 锁定。npm audit 当前为零已报告漏洞；这不替代持续安全维护。

| 运行时依赖         | 版本    | 许可证     |
| ------------------ | ------- | ---------- |
| @capacitor/android | 8.5.2   | MIT        |
| @capacitor/core    | 8.5.2   | MIT        |
| lucide-react       | 0.577.0 | ISC        |
| pdfjs-dist         | 6.4.299 | Apache-2.0 |
| react              | 19.3.0  | MIT        |
| react-dom          | 19.3.0  | MIT        |
| sql.js             | 1.14.2  | MIT        |

Electron 44.5.1 使用 MIT；其 Chromium/Node 组件的第三方声明随 Electron 分发。PDF.js TextLayer 样式保留 Apache-2.0 来源声明。发布时保留原第三方许可证与版权信息。React/Vite/Vitest/TypeScript/Capacitor/PDF.js/sql.js 均从其 npm 发布包安装并锁定，CI 使用 npm ci。

维护策略：每月评估 Chromium/Electron 与 PDF.js 安全更新；重大版本先跑真实 PDF 和生命周期测试，不自动替换。生产 runtime 不依赖原生 Node SQLite ABI，使用 sql.js wasm worker；Android SQLite 是系统原生数据库。

开发依赖中部分上游工具包含已弃用的间接包，目前审计无报告漏洞；继续追踪 electron-builder/CLI 上游升级。仅以零漏洞不能认定供应链永久安全。
