# Passage — Architecture & Product Design Review

评审日期：2026-10-04。产品阶段：0.1 开发版本。本文是实施决策，不代表功能已通过验收；真实完成状态以 DELIVERY.md 为准。

## 1. Product Scope / 2. Core User Journey / 3. Reading Flow

产品服务科研人员长时间阅读原始外文 PDF。论文始终占据主要区域；AI 仅在用户要求时工作。核心旅程是安装 → 配置自己的 Provider → 导入本地 PDF → 阅读/选文 → 翻译或解释 → 查看原文证据 → 继续阅读 → 关闭后恢复。第一阶段实现可靠阅读与单篇证据问答，不依赖账户、不建立中转服务器。OCR、跨设备同步、多论文向量检索和视觉分析属于后续明确阶段。

## 4–8. 平台、框架比较与最终路线

选择 **TypeScript + React + PDF.js，共享业务核心；Electron 桌面宿主 + Capacitor Android 宿主**。Electron 自身不支持 Android，因此移动端明确使用独立原生桥接，不宣称 Electron 可直接部署手机。共享 Domain、Parser、Prompt、Retrieval、Cache Key、Usage、UI；PDF 文件、SQLite、凭据、网络、生命周期、安装和更新由 PlatformAdapter 隔离。

以下为工程评估，分数是本项目判断而非第三方性能基准。

| 维度                         | Flutter               | Tauri 2                   | Electron + Capacitor            | Qt                      | Kotlin Multiplatform + Compose |
| ---------------------------- | --------------------- | ------------------------- | ------------------------------- | ----------------------- | ------------------------------ |
| macOS / Windows / Linux      | 支持                  | 支持                      | Electron 支持                   | 支持                    | JVM 桌面支持                   |
| Android                      | 支持                  | 支持，需移动插件审计      | Capacitor，独立宿主             | 支持                    | 强项                           |
| 业务/UI 复用                 | 高                    | 高                        | 高，桥接不同                    | 中高                    | 高，PDF适配不同                |
| PDF 渲染/选择/注释           | 依赖插件，需许可审核  | PDF.js，系统 WebView 差异 | PDF.js，桌面 Chromium 一致      | Qt PDF，模块许可审核    | PDFium/PDFBox/Android PDF 组合 |
| bbox/阅读顺序                | 原生插件解析          | PDF.js                    | PDF.js                          | 原生解析                | 多引擎一致性成本               |
| 文件/SQLite/凭据             | 平台插件              | Rust 插件                 | 桌面 IPC + Android 插件         | 原生 C++                | 原生/Kotlin 插件               |
| 流式网络/多模态              | Dart HTTP             | Rust HTTP                 | JS协议适配，原生桥接            | C++ HTTP                | Ktor                           |
| Blur / Shader / Glass / 动画 | 强                    | CSS，WebView 差异         | CSS，低干扰优先                 | QML 强                  | Compose 强                     |
| GPU/电池                     | 可优化，需设备测量    | 系统 WebView，较小宿主    | Chromium 内存较高，限定渲染缓存 | 原生可控                | JVM内存与原生桥接成本          |
| 安装/更新/CI                 | 多平台工具链          | 官方打包/更新插件         | electron-builder + Gradle       | 部署工具与许可          | jpackage + Gradle              |
| 维护/生态                    | 成熟，PDF插件依赖     | 移动较年轻                | 桌面成熟，两个宿主维护          | 成熟但C++成本高         | 成熟Android，PDF跨端需要工作   |
| 许可证                       | BSD框架，插件逐项审计 | MIT/Apache                | MIT/Apache，依赖逐项清单        | LGPL/GPL/商业因模块不同 | Apache，依赖逐项审计           |

Flutter 是有力候选，但原格式PDF文本层、跨端选择、坐标映射和可核验批注需额外插件验证。Tauri 的体积优势明显，但多个系统 WebView 下 PDF 文本层差异与 Rust/移动插件维护增加初期闭环风险。Qt 不采用是因为模块许可证及 C++/Android 配套成本。KMP 不采用是因为本项目 PDF 核心跨端引擎需要更大适配工作。Electron 的代价是安装体积和内存；通过页面虚拟化、禁用常驻动态效果、限制并发控制。选型不是因本机只有 Node，而是以 PDF 阅读、可选择文本、统一 bbox 和生态为优先；本机工具链只是交付效率因素。

Android 手机以 Reader 为中心，辅助内容使用底部页签/面板；平板使用两栏。Android 的 KeyStore、文件导入、SQLite 和 HTTP 桥接必须实装后才标为可用。不能仅通过响应式网页宣称 APK 完成。

## 9–11. 系统、模块与目录

```
src/domain           模型、保护规则、检索、位置与使用量
src/application      上下文装配、AI任务、缓存与任务编排
src/infrastructure   PlatformAdapter、Provider调用边界
src/pdf              PDF.js渲染、TextLayer、解析与坐标
src/components       Reader、Library、Assistant、Settings
src/styles           设计变量、布局、辅助文本、移动适配
desktop              Electron宿主、窄IPC、SQLite worker、凭据
android              Capacitor/Gradle宿主与原生适配
scripts              打包、烟雾测试、依赖许可
 tests               领域、协议、存储、实际PDF/UI测试
```

PDF.js Worker执行PDF解析/字体处理，UI只管理视口。AI网络在宿主，不暴露密钥给Renderer。数据库Worker串行写入。业务不导入Electron。UI不直接拼接厂商协议。

## 12–17. PDF与结构保护

12. PDF Rendering：原始字节通过PDF.js绘制canvas，叠加官方TextLayer，实现选择/复制。只挂载可见页与邻页；完整页框占位确保连续滚动不跳动。单页模式与适宽/缩放独立。
13. Parsing：保存每个文字run的page、text、bbox、font信息，按行/段落聚合，保留原始runs；heading/equation/caption/reference使用启发式并保留confidence。禁止把启发式当确定语义。
14. Reading order：按行y和列x分组；检测中间gutter，跨栏标题独立排序，左栏后右栏。复杂版面给出低置信度，允许选择文本优先。
15. Bounding box：使用viewport.convertToViewportPoint与transform将PDF坐标映射为归一化页面坐标；缩放时只乘当前尺寸；旋转需要使用同一viewport。原文与辅助卡片共享block id。
16. Formula：公式/引用/专有名词先替换成不可译占位符，再校验返回占位符集合，再恢复。缺失、重复或模型改写保护符时拒绝缓存，提示重试。无法可靠还原公式时只展示原PDF视觉，不猜LaTeX。
17. Citation：识别[数字]、Fig.、Table、Eq.、Sec.及作者年引用。PDF内部link destination优先；启发式引用只在找到候选时预览，歧义不能自动跳转。

## 18–33. 翻译与阅读连续性

18. Translation：明确任务prompt，选择优先，当前block其次；附邻近小量上下文和术语字典，中文默认保留专有名词。
19. Immersive Bilingual：用户开启后，当前段落译文在辅助栏；原PDF不替换。译文点击定位原段落。
20. Active Paragraph：视口中心距离、覆盖率、滚动方向、选文/指针、停留时间综合；快速滚动期间暂停，稳定650ms后更新。
21. Prefetch：第一稳定版本默认Off；随后Balanced只预取下一段，最多一个后台请求；网络差、接近限额、低端设备自动降低。
22. Cancellation：AbortController贯穿IPC request id；新任务取消旧请求，晚到结果以generation id丢弃。取消不代表Provider保证零计费。
23. Cache：document hash + block id + source hash + language + provider + model + prompt version + terminology version，持久化SQLite；选文采用内容hash区分。
24. Peek：按住Alt（可设置）显示当前缓存译文；未缓存时只在用户主动按住触发请求，松开隐藏且不抢焦点。
25. Terminology：paper scoped original/preferred/abbreviation/explanation/first occurrence/user override，递增version使缓存失效；全局术语后续合并。
26. Formula Card：短解释→symbols→context，文本不可靠时使用原图与明确不确定性。
27. Figure：原PDF图区域高清裁剪 + caption +邻段；发送图像前由用户主动调用Vision任务。
28. Table：放大原表，分析metrics/baseline/delta，视觉标记单独overlay；禁止重写原表。
    29–30. Citation / Source Peek：先浮层显示页码、section、原文，用户点击“前往原文”才导航；模型引用只接受本次上下文白名单ID。
29. Navigation：back/forward stack存page、scroll、zoom、block；搜索/目录/来源跳转先push，浏览器式截断forward分支。
30. Resume：scroll offset、page、zoom、mode、active block、panel、focus自动去抖保存；恢复等待页框建立，按block优先、offset fallback。
31. Focus / Zen：Focus隐藏左栏，Zen同时隐藏辅助栏；退出恢复原布局，鼠标/触摸才显示轻量控制。

## 34–40. AI架构与证据

34. Provider：OpenAI-compatible（含DeepSeek/custom）、Anthropic Messages、Gemini generateContent独立adapter。配置base URL/model/timeouts/output limit，流式文本和Usage归一化。每个任务配置一个Provider+model。
35. Model Routing：translation/reasoning/vision/embedding独立任务配置；不写死自动最新模型名，模型可由用户编辑。
36. Credentials：桌面safeStorage包装OS加密，Linux检测basic_text并拒绝持久化；Android Keystore插件；密钥掩码、编辑/删除/连接测试，日志不得记录。开发版本签名变化可能触发Keychain重新授权。
37. Prompt：translate/explain/summary/method/formula/figure/table/experiment/paper_qa分别版本化。文献内容是数据，不能覆盖system规则。
38. Context：selection + nearby blocks 或最多top-k检索block，限制字符/token预算。请求预览显示将发送的文本与Provider，绝不默认整篇上传。
39. Retrieval：MVP本地词项检索（中英文分词/关键词），不是伪装成embedding；返回page/block/bbox证据。下一阶段加入SQLite向量或纯本地向量索引，按文档过滤，保留fallback。首版不引入服务器型向量库。
40. Hallucination：要求区分论文证据/推断/背景知识，不编造结果、数据集、公式；无证据明确回答。UI仅可点击当前证据ID；引用来源表明可核验性，不能保证模型结论一定正确。

## 41–47. Usage与费用

41. 每次调用记录request id/session/date/provider/model/task/document/input/output/cached/reasoning/duration/status/context block IDs，默认不记录完整prompt。
42. Usage Adapter分别处理prompt_tokens/completion_tokens、input_tokens/output_tokens、usageMetadata及stream尾部。没返回就是estimated，不能标actual。
43. Token Estimate：字符级启发式仅用于预警，注明estimated；真实Provider数据优先。
44. Cost Estimate：可编辑每百万input/output/cached价格、currency、effective date、version；无价格显示“未配置”，不显示$0；Provider真实账单才是actual cost。
45. Console放设置/独立弹层，session/today/7d/30d/all filters，按provider/model/task/paper汇总、请求详情。
46. Cost Limit：日token软/硬限制先于发送检查；并发预留预算；估算不足不能保证硬金额上限，严格模式按max output reserve。金额预算在价格缺失时必须拒绝或让用户显式解除，不假装零成本。
47. Prefetch最先让位于主动请求；达到预算预警禁止预取，无并发队列堆积，无联网后自动重放。

## 48–51. 存储、离线与隐私

48. SQLite schema version 1：documents(id,metadata,pdf managed file)、blocks(document,page,bbox,text,section)、reading_positions、notes、highlights、translation_cache、terminology、settings/providers/model_configs、usage_requests；后续sections/chunks/conversations/messages/pricing/navigation_sessions按migration新增。外键与document删除级联；原PDF独立受管目录，不修改用户原文件。
49. user_version迁移，事务中执行，升级前备份，失败回滚；原子落盘（tmp→rename）。自动保存错误必须在UI提示，不能默默吞掉。数据导出/备份保留schema版本。
50. 离线PDF/搜索/笔记/高亮/已缓存译文可用；新AI请求明确网络失败；恢复网络不自动重发。
51. 本地持久化、无遥测默认开关、无自建AI代理。请求详情展示必要上下文，只有主动翻译或用户开启沉浸翻译才外发。密钥仅宿主，错误详情去敏。

## 52–58. Design与性能

52. 暖灰应用背景、白纸原PDF、深绿强调、细边框，统一8px间距、12/16/24圆角、辅助字体15px/1.75。标题简洁，Library→Reader→Assistant视觉递减。Light/Dark/System独立语义变量，PDF不粗暴反色。
53. Motion：按钮120ms、面板220ms，reduce-motion关闭过渡；状态动画只说明真实处理阶段。
54. Glass仅Floating Toolbar/Peek/Command Palette；正文无玻璃、无持续粒子。Full/Balanced/Minimal可配置，低端默认Minimal。
55. 桌面：Cmd/Ctrl+O导入、F搜索、K命令、Alt+方向导航、Escape关闭浮层、Alt Peek；通过统一handler，输入框不拦截文字键。
56. Android：44px触控目标、长按选择、Reader/AI/Notes/Library底部导航、底部面板；软键盘不遮盖问答输入。
57. Accessibility：按钮标签、键盘焦点、对话框focus trap与return focus、ARIA状态、对比度、字体缩放、reduce motion。
58. 性能：PDF worker、数据库worker、异步网络、可见页懒渲染、清理canvas/page资源、单任务取消、限制top-k。20页连续阅读/100页快速滚动/内存曲线在真实设备测量，不能仅凭架构宣称性能合格。

## 59–63. 交付、测试与路线

59. macOS arm64 .app + .dmg Development Build先交付；x64由CI单独构建。未有Apple Developer证书的构建不宣称Signed/Notarized。Windows NSIS .exe、Linux AppImage、Android APK/AAB由各自runner工具链构建与验证。
60. CI：format/lint/typecheck/domain tests/provider fixtures/storage integration/UI smoke/build；平台矩阵打包，tag触发release artifacts，签名secret只在release runner。
61. 测试：双栏/旋转/公式/citation真实PDF，block bbox、保护符损坏、缓存版本失效、检索来源白名单、navigation、持久化、Provider stream拆包、取消与错误usage、价格缺失/预算；UI打开PDF/选择/恢复/搜索/来源返回。无Key时只标协议fixture通过，不能声称真实模型已验收。
62. MVP完成标准：可以安装运行，真实PDF可选文本/搜索/保存阅读位置，用户Key可配置，翻译保护、解释、单篇问答、来源预览/返回闭环；离线基础与usage早期采集。扫描PDF在OCR未实现时明确限制。
63. 路线：0.1核心阅读/AI/来源/本地/打包；0.2沉浸翻译/段落更准确/术语/预取/Android native adapters；0.3公式/图表Vision/semantic search/Usage完整预算；0.4视觉增强/同步/多论文。每阶段先修闭环缺陷再扩展。

## 64. 十个技术风险与解决方案

| 风险                       | 解决/验收                                                |
| -------------------------- | -------------------------------------------------------- |
| 双栏阅读顺序错乱           | 保存runs，gutter分列，人工PDF fixtures，低confidence提示 |
| bbox缩放旋转偏差           | 同viewport映射，旋转/缩放fixtures，原文预览核验          |
| 公式被改写                 | 占位符校验，失败不缓存，原PDF兜底                        |
| 长PDF内存泄漏              | 虚拟化邻页、render取消、canvas清理，100页内存测试        |
| 移动插件不兼容             | 原生适配器合同测试，APK实机验收才标完成                  |
| Provider流式拆包/usage差异 | 独立adapter，分包/终帧fixtures与真实Key验收              |
| 凭据后端无加密             | Linux basic_text拒绝，密钥永不落明文                     |
| DB升级损坏                 | user_version事务迁移、备份、原子落盘、失败恢复测试       |
| 恶意PDF/Prompt injection   | sandbox、窄IPC、CSP、上下文数据隔离、引用白名单          |
| 未签名分发/平台构建失败    | 开发/正式区分，本机arm64验证，其余CI实测                 |

## 65. 十个UX风险与解决方案

| 风险                 | 解决/验收                                    |
| -------------------- | -------------------------------------------- |
| AI抢走阅读空间       | 默认关闭，用户开启面板，Focus/Zen            |
| AI抢键盘焦点         | 输出不调用focus/scroll，选文后保留PDF位置    |
| 当前段落判断错误     | 选文优先、点击纠正、chip显示实际来源         |
| 翻译延迟导致布局跳动 | 固定面板、取消旧任务，不替换PDF              |
| 来源跳转后迷失       | Source Peek优先，完整Back/Forward状态        |
| 第二天无法准确恢复   | page+block+offset+zoom保存，重启实测         |
| 操作难发现           | 少量一级选文动作、快捷键提示、命令面板       |
| 手机照搬桌面         | 底部导航与sheet，手机/平板分别布局           |
| 深色伤害Figure       | UI暗色与PDF独立，图片不反色                  |
| 错误提示像控制台     | 中文原因/下一步、details可展开、保留阅读能力 |

## 66–67. 五个API成本风险与解决方案

| 风险                  | 方案                                                              |
| --------------------- | ----------------------------------------------------------------- |
| 快速滚动触发大量请求  | dwell debounce、abort、一个当前段任务                             |
| 全文重复发给模型      | 限制top-k与上下文预算、公开context preview                        |
| 缓存失效过宽/重复调用 | 严格内容+配置版本key，in-flight去重                               |
| 预取无人阅读的内容    | 默认Off，最多N+1，预算接近时停止                                  |
| Token/价格估算伪精确  | actual usage vs estimate标记、价格缺失不算0、Provider账单最终来源 |

## 官方核验来源

- Flutter平台：https://docs.flutter.dev/reference/supported-platforms
- Tauri工具链：https://tauri.app/start/prerequisites/
- Electron安全：https://www.electronjs.org/docs/latest/tutorial/security
- Electron凭据：https://www.electronjs.org/docs/latest/api/safe-storage
- Capacitor宿主：https://capacitorjs.com/docs
- Qt许可：https://doc.qt.io/qt-6/licensing.html
- Kotlin共享核心：https://www.jetbrains.com/kotlin-ecosystem/
- PDF.js：https://mozilla.github.io/pdf.js/

以上官方信息用于确认平台能力；性能/维护/选型取舍属于本评审的工程判断，须持续通过实测更新。
