# 参数与设置参考

这份文档给要写代码接入 doc-intake 的人看：前半是工具入参，后半是设置项全表。想让别的 App 通过宿主服务总线调它，看同目录的 `SERVICE-API.md`。

设置项的权威来源是 `manifest.json` 里的 `contributes.settings.schema.properties`；这一篇是它的中文展开，也是登记在册的 71 个键的清单。两边对不上时以 manifest 为准，那是运行时真正校验的那一份。

---

## 工具入参 doc_intake

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|:---:|--------|------|
| `source` | `string[]` | 是 | — | 文件或目录路径列表。目录会被展开成里面所有支持格式的文件；也容忍单个字符串。 |
| `outputDir` | `string` | 否 | 由自动保存与保存路径决定 | 保存目录。不传时按设置里的自动保存、保存路径与 `summaryOnly` 规则裁决，见「输出与自动保存」。 |
| `backend` | `"auto" \| "mineru" \| "oxr" \| "paddleocr" \| "mineru-local" \| "local"` | 否 | `"auto"` | 解析后端。`auto` 按文件类型走默认降级链；显式给一档时**链上就只有这一档**，不再向后降级，且该档需要的凭证或地址没配时直接报错。电子书（EPUB / FB2 / CBZ / MOBI 等）不受它影响，一律本地解析，只在 `warnings` 里提一句。 |
| `pageRange` | `string` | 否 | 全部页 | PDF 页码范围，形如 `"1-5,10,15-20"`，1-based。其他格式忽略。 |
| `language` | `string` | 否 | 设置里的默认语言（出厂 `zh`） | 文档语言，透传给 OCR 与云端 API，影响识别语种。 |
| `includeMedia` | `boolean` | 否 | `true` | 是否提取并保存图片/视频/音频。只有用户明确说不要媒体时才传 `false`；「保存 JSON」「正文可省略」「只返回摘要」都不等于不要媒体。 |
| `saveJson` | `boolean` | 否 | 设置里的同名开关（出厂 `false`） | 是否额外落一份结构化 JSON，与 `.md` 并列。JSON 里 `metadata.mediaPaths` 是相对路径，工具返回的路径块是绝对路径。 |
| `splitOnly` | `boolean` | 否 | `false` | 只做长图分割测试，不调用任何后端。调试用，正常提取不要传。 |
| `summaryOnly` | `boolean` | 否 | `false` | 只回每个文件的成功/失败状态与落盘路径，不回正文。解析与保存照常执行，成功但带 warnings 的文件仍算成功。 |

服务入口另有一份入参（`sources` 复数、多一个 `waitMs`），两边不通用，见 `SERVICE-API.md`。

---

## 服务入参

别的 App 走宿主的服务总线：完整方法是 `app:doc-intake/<方法>`，四个方法分别是 `describe`（问能力与入参表）、`extract`（投递一次解析）、`status`（看进度）、`result`（取结果）。

字段名、类型、`waitMs` 与 `jobId` 的用法、七种错误码、结果字段表，全部在 `SERVICE-API.md` 里，这里不重复抄第二份。

---

## 设置项完整参考

全部在 App 设置页改，改完即时生效。页面上把最常用的一批放「基础项」，其余收在「高级设置」；下面的分组是功能视角，与页面展开与否无关。类型里的引号即枚举取值，默认值一栏是出厂值。

### 基础

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `pythonPath` | `string` | `""` | Python 可执行文件路径，如 `<conda 目录>/envs/<环境名>/python.exe`。**必填**，不填则工具直接回 `PYTHON_PATH_NOT_CONFIGURED`。 |
| `pipIndexMode` | `"inherit" \| "official" \| "tuna" \| "aliyun" \| "custom"` | `"inherit"` | 设置页「一键安装」装依赖时用的源。`inherit` 表示不传源，让 pip 读自己的 pip.ini 与环境变量。 |
| `pipIndexUrl` | `string` | `""` | 自定义安装源地址，只在上面选 `custom` 时生效，要填完整的 index-url。 |
| `defaultBackend` | `"auto" \| "mineru" \| "oxr" \| "paddleocr" \| "mineru-local" \| "local"` | `"auto"` | 默认解析后端。工具与服务没显式指定时用它。 |
| `defaultLanguage` | `string` | `"zh"` | 默认语言，透传给 OCR 与云端 API。 |
| `includeMedia` | `boolean` | `true` | 默认是否提取媒体（图片/视频/音频）。 |
| `barcodeScan` | `boolean` | `true` | 解析媒体里的二维码与条码，结果注在引用该媒体的那一行下面；未安装 `zxing-cpp` 时自动跳过并留一条 warning。 |

### 后端与降级链

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `pdfBackendChain` | `string` | `""` | PDF 降级链。留空 = `mineru → oxr → paddleocr → mineru-local → local`。分隔符接受 `>`、`;`、`,`、换行。链上缺凭证（MinerU / OXR / PaddleOCR 无 Token）或缺地址（两个自建服务的 endpoint 为空）的档位会被自动剔除，不会白失败一次。 |
| `imageBackendChain` | `string` | `""` | 图片降级链。留空 = `oxr → paddleocr`。同一个分隔符规则。 |
| `formulaChain` | `string[]` | `["local"]` | 公式识别降级链，**顺序即优先级**。`local`（现有 OMML + MathType 转换器）永远首位、不可取消，它是前置条件而不是可选后端；`texo` / `plus-m` 是本机小模型，要装了才参与（未装静默剔除，只记一条 debug）。图片不落盘的公式才会走到它：成功时正文换成 `$latex$`，那张预览图既不写入 `images`、也不留在输出目录。只在设置页配置，**不进工具参数**，也没有 per-call 覆盖。 |
| `autoSplitLargePDF` | `boolean` | `true` | 自动切割超限 PDF。切割在插件 Python 进程内按 `splitChunkPages` 生成内存 PDF bytes 直接上传，**不会**在源文件目录留下 `*_chunks` 文件夹或 chunk PDF。 |
| `splitChunkPages` | `number` | `180` | 内存分块时每块页数，取小于 MinerU 200 页上限的值。 |

**大 PDF 的切割**只用于云端上传。所有 chunk 的识别结果按 `chunkIndex` 在插件内部按原 PDF 顺序合并，再统一保存为一个 Markdown/JSON；媒体直接写进原 PDF 对应的唯一 `{原文件名}_media/` 目录，并用 `chunk_NNN_` 前缀避免并发分块重名。插件不先生成 chunk PDF 再上传，也不先生成 chunk Markdown 再做事后拼接。

**本地档（`local`，PyMuPDF）的能力边界。** 它是 PDF 降级链的最末档，直接读 PDF 内嵌文本与图片，不调任何 API：

- 不做 OCR：扫描版（无文本层）只能拿到空白，得走 PaddleOCR / MinerU / OXR
- 不做公式识别、表格识别、分栏重排
- Founder 方正 PDF 的 ToUnicode CMap 可能缺失。这类文件（不少国标 GB/T 文档）经 PyMuPDF 提取会出现「犐犆犛」「犌犅」这类乱码：原本的 ASCII `ICS`、`GB` 被错误 fallback 到 CJK 兼容区。这是 PDF 自身的缺陷，本地档修不了

本地档会检测方正特征乱码（Unicode U+7280–U+72FF）并写进 `warnings`，建议改用云端 OCR 后端重提取。看到这条警告就把 `backend` 换成 `mineru`、`oxr` 或 `paddleocr`。

**本地档的图片按位置插入。** 每页内嵌图片按 `page.get_image_info()` 给出的 y 坐标插到对应文字 block 前后，输出 Markdown 时按视觉顺序拼接：同一 y 行的多张图按 x0 升序（左到右），容忍 ±5px 浮点误差；同一 xref 在一页内只引用一次；inline image（xref=0）跳过，PyMuPDF 不暴露它的原始 bytes；只出现在 `get_images` 而 `get_image_info` 没显示的资源引用不抽。

### 电子书（不进降级链）

电子书不参与上面那两条链：云端几档都只吃 PDF 和图片，做不了容器格式。四类一律本地解析，若 `backend` 显式指定了云端档，会在 `warnings` 里说一句「电子书只能本地解析，已忽略 backend=xxx」，不报错——设置页的默认后端是全局的，把它设成 oxr 的人不该因此一本书都读不了。

| 扩展名 | 细类型 | 提取器做什么 |
|---|---|---|
| `.epub` | `epub` | 解 zip → 找 OPF → spine 定阅读顺序 → nav/ncx 取目录 → XHTML 转 Markdown；图片按原始字节落盘。字体混淆（IDPF / Adobe font）照常解，内容加密（ADEPT 等）直接报错 |
| `.fb2` / `.fbz` | `fb2` | 单个 XML；`<binary>` 里的 base64 解成图片，section 嵌套深度成标题层级，`body name="notes"` 挪到文末 |
| `.cbz` | `cbz` | zip 装图，按页名自然序（`page2` 在 `page10` 前）出图；不主动 OCR，要文字得显式走图片链 |
| `.mobi` `.azw` `.azw3` `.prc` | `mobi` | 先看 PalmDB 记录头的加密类型，有 DRM 直接拒；再交给可选依赖 `mobi` 解包，解出 epub 就复用 EPUB 提取器，解出 html 走 HTML 转 Markdown，解出 pdf 是 Print Replica，报错请用户先转 PDF |
| `.txt` | `txt` | 编码判定（BOM → UTF-8 严格 → charset-normalizer → 自建打分）后原样转出；正文只做去 BOM、换行归一成 LF、剥行尾空白，不加标题、不合段、不去缩进、不压空行 |

MOBI/AZW 那条依赖是 GPL-3.0，插件不打包它，由用户在设置页「环境依赖」里一键装进自己的 Python 环境。没装时返回的是可读的安装提示，不是 traceback。

`.txt` 的存在理由是 `.txt` 本身：加密那节不管，问题在“猜错也不报错”。Big5 的字节在 GB18030 里也能解成合法字符，于是拿到一段看似中文的乱码——比报错危险。所以它的产出除了正文，还带 `encoding` / `encodingSource` / `encodingConfidence` / `replacementCount`，判不准时在 `warnings` 里说清按谁解的、有几处替换符。`.txt` 的正文是逐字保真的：`main.py` 那两处“美化”（折空行、抹 `<img>`）对它一律不生效。

`pageRange` 对电子书无效（它们没有页的概念，CBZ 的页是图片顺序）；`language` 也只当提示，真正的语言取自书籍自身的元数据。

### MinerU

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `mineruCredentials` | `string` | `""` | MinerU Token，多个用分号分隔。获取地址：https://mineru.net/apiManage/token |
| `mineruModelVersion` | `"vlm" \| "pipeline" \| "MinerU-HTML"` | `"vlm"` | MinerU 模型版本。`vlm` 精度最高，`pipeline` 速度快。 |
| `mineruEnableOCR` | `boolean` | `true` | 是否开启 OCR（对 `pipeline` / `vlm` 有效）。 |
| `mineruEnableFormula` | `boolean` | `true` | 是否开启公式识别。 |
| `mineruEnableTable` | `boolean` | `true` | 是否开启表格识别。 |
| `mineruFlashMaxMB` | `number` | `10` | Flash 模式单文件大小上限（MB）。走 Flash 还是 Precision 由有没有 Token 决定，不由这里决定。 |
| `mineruFlashMaxPages` | `number` | `20` | Flash 模式页数上限。 |
| `mineruPrecisionMaxMB` | `number` | `200` | Precision 模式单文件大小上限（MB）。有 Token 时生效。 |
| `mineruPrecisionMaxPages` | `number` | `200` | Precision 模式页数上限。 |

### OXR（SoMark）

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `oxrTokens` | `string` | `""` | OXR Token，一行一个（分号也认）。获取地址：https://somark.cn/workbench |

### PaddleOCR

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `paddleTokens` | `string` | `""` | PaddleOCR Token，多个用分号分隔。获取地址：https://aistudio.baidu.com/account/accessToken |
| `paddleUseDocOrientationClassify` | `boolean` | `false` | 文档方向分类。 |
| `paddleUseDocUnwarping` | `boolean` | `true` | 文档去扭曲。 |
| `paddleUseChartRecognition` | `boolean` | `true` | 图表识别。 |
| `paddleUseSealRecognition` | `boolean` | `false` | 印章识别。 |
| `paddleUseTableRecognition` | `boolean` | `true` | 表格识别。 |
| `paddleUseFormulaRecognition` | `boolean` | `true` | 公式识别。 |

### Token 检测（设置页上的动作，不是工具）

Token 检测不在工具列表里，它不是「提取文档」这类活，而是配置环节的一次性检查。设置页里 MinerU、OXR、PaddleOCR 三个 Token 字段下面各有一个「检测」按钮，填完直接点，不必先存盘。

数据面是设置页路由的 `POST /validate`：一次请求可以同时带上三个字段，哪个传了字符串就检哪个，回逐行的「第几个 · 掩码后的 Token · 结论」。请求由 `lib/validate.js` 纯 Node 发出去（走宿主的网络出口，受 manifest 的 `network.allowedHosts` 约束），不 spawn Python。它只回答「这把凭证能不能过鉴权」，不发真实解析任务，不占解析额度。

### 本地服务

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `mineruLocalEndpoint` | `string` | `""` | 自建 MinerU 服务地址，如 `http://127.0.0.1:8000`。留空 = 用插件自管的实例；填了就用填的这个，只探活，不会替它启动也不会替它停。 |
| `mineruLocalApiKey` | `string` | `""` | 自建 MinerU 的 API Key，服务端用 `--api-key` 启动时才需要，一般留空。 |
| `mineruLocalTier` | `"" \| "flash" \| "basic" \| "standard" \| "advanced"` | `""` | 自建 MinerU 的档位，留空按服务端默认。选服务端没装的档会被拒（`GET /v1/tiers` 能看到的才算有）。 |
| `mineruKitPath` | `string` | `""` | `mineru-kit.exe` 的完整路径，如 `E:\Conda\envs_dirs\mineru\Scripts\mineru-kit.exe`。只在自动拉起时需要，只认文件不认目录。 |
| `mineruLocalPort` | `number` | `8010` | 自管实例的起始端口。被占就自动往后找邻位（最多试 21 个），解析用的地址跟实际端口走。 |
| `mineruLocalIdleSeconds` | `number` | `300` | 空闲多少秒后卸载自管实例。`0` = 每次解析完立刻关。 |
| `mineruLocalAutoStart` | `boolean` | `true` | 关掉后只用已在运行的服务，不再自动拉起。 |

#### 自管实例的启停

填了 `mineruLocalEndpoint` 就只用它：插件探一次 `/v1/health`，通了就用，不通就带着原因报失败，**不会**改成去拉起自管实例——用户显式给的地址就是唯一意图。留空则走自管：先看 `service.json` 里记的端口上有没有自己上一轮留下的实例（那个端口可能是上回被占后换过的邻位），没有就按 `mineruKitPath` 从 `mineruLocalPort` 往后找第一个能监听的端口拉起一个守护脚本，由它在空闲 `mineruLocalIdleSeconds` 秒后把服务关掉。

守护脚本是 `python/mineru_service.py`，状态文件在宿主的 `dataDir/mineru-service/`：`service.json`（自己与子进程的 pid、端口、kit 路径）、`activity`（最后活跃时间，由 App 每次解析前刷新）、`service.log`（服务端输出）。杀死只认这三样同时成立：`service.json` 记的 pid 活着、命令行含 `mineru-kit`、端口对得上。用户在 8000 上自己起的实例永远不在这条路上——没 `service.json` 就不接管、也不在同一个端口再起一个。

两件容易误会的事：一次首次解析会花 179 秒左右加载模型（后续请求快），所以「醒一次用一下」适合低频大文件，不适合连续小文件；`mineruLocalIdleSeconds = 0` 是每次解析完立刻关，代价是下一次又要冷启动。
### 图片分割

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `splitImageThreshold` | `number` | `1.2` | 图片高/宽比超过此值才尝试切分。 |
| `splitImageTolerance` | `number` | `15` | 判断两行像素相近的色差容忍度（欧氏距离）。 |
| `splitImageBlankRatio` | `number` | `0.98` | 一行里多少比例的像素相近才算空白行。 |
| `splitImageMinBlank` | `number` | `5` | 连续多少行空白才作为切割点。 |

### 并发与重试

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `maxConcurrent` | `number` | `4` | 云端 API 后端（MinerU / OXR / PaddleOCR）的并发上限。 |
| `maxConcurrentLocal` | `number` | `8` | 本地解析与自建服务后端的并发上限。旧版 Office 转换另有独立的限。 |
| `maxRetries` | `number` | `3` | 临时错误（429 / 5xx / 网络抖动）的最大重试次数。401 / 403 / 400 与业务错不重试，直接降级到下一档。 |
| `retryBaseDelayMs` | `number` | `1000` | 重试基础退避毫秒。5xx 按 `base × 2^attempt`；429 走独立的长 base（8s × 2^attempt），不受这个值影响。 |
| `keyRetryOnFailure` | `boolean` | `true` | 一把 Token 失败时自动换下一把重试。 |
| `notifyKeyFailure` | `boolean` | `true` | Token 失效时通知用户。 |

### 旧版 Office 转换

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `legacyConversionProvider` | `"auto" \| "office_com" \| "libreoffice" \| "disabled"` | `"auto"` | `.doc` / `.xls` / `.ppt` 的转换后端。`auto` 优先 Office COM，没有就退 LibreOffice。 |
| `libreOfficePath` | `string` | `""` | LibreOffice 可执行文件路径，仅上面选 `libreoffice`（或 `auto` 且本机无 Office COM）时使用。 |
| `legacyConversionConcurrency` | `number` | `1` | 旧格式转换并发上限。COM 默认串行。 |
| `legacyConversionTimeoutMs` | `number` | `180000` | 单次旧格式转换超时（毫秒）。 |

### HTML 与 Excel

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `htmlExtractMetadata` | `boolean` | `true` | 提取元数据（title / author / description 等）。 |
| `htmlExtractLinks` | `boolean` | `true` | 提取链接列表。 |
| `htmlExtractImages` | `boolean` | `true` | 提取并下载远程图片。 |
| `htmlExtractCodeBlocks` | `boolean` | `true` | 提取代码块并标注语言。 |
| `htmlHeadingStyle` | `"ATX" \| "SETEXT"` | `"ATX"` | Markdown 标题风格。 |
| `maxRemoteImagesPerHtml` | `number` | `100` | 单个 HTML 最多下载多少张远程图片。 |
| `xlsxMaxRows` | `number` | `100` | Excel 最多提取多少行，适用于 `.xls` / `.xlsx` / `.xlsm`；`0` 表示不限制。 |
| `xlsxMaxCols` | `number` | `50` | Excel 最多提取多少列，同上；`0` 表示不限制。 |

### Agent 返回容量

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `inlineBlockBytes` | `number`（代码内限 4096–30720） | `28672` | 每个返回文本块的最大字节数（UTF-8），默认 28 KiB。 |
| `inlineBlockCount` | `number`（代码内限 1–8） | `4` | 返回文本块数量上限。默认 4 块，总容量约 112 KiB。 |
| `mediaPathReturnLimit` | `number`（≥0） | `20` | 返回媒体绝对路径的条数上限。媒体数不超过它时给 `mediaPaths`，超过时只给 `mediaCount`。 |

**为什么拆成多个 text block。** Hana 对单个 `content[type="text"]` 有约 32 KiB 的 UTF-8 字节限制，单块顶到限制时平台可能对正文做头尾截断。所以正文按 `inlineBlockBytes` 切成多块，每块都留在限制以下，按 UTF-8 边界切；结构化数据仍在 `details.data`。块数上限是插件自己的保守取值，不是 Hana 的硬上限——往上加确实能扩大承载量，但还要撞 Agent 上下文、模型窗口、provider 请求限制和输入成本。

**三种返回策略**（按最终 Markdown 的大小判定，不按文件数）：

1. 内容能放进 `inlineBlockBytes × inlineBlockCount`：返回完整 Markdown，必要时拆多块
2. 超限且已有本地保存结果：只返回处理摘要与 `mdPath` / `mediaDir`，正文自己去读文件
3. 超限且没落盘：跨块保留开头和结尾，中间插省略提示，并标记这次结果不完整

**`xlsxMaxRows` / `inlineBlock*` 是两层。** 前者作用于 Excel 解析阶段，决定把多少行多少列写进 Markdown；后者只决定当场发给 Agent 多少正文，不会减少已提取的数据，也不会缩短已落盘的 Markdown / JSON。反过来说，本地 Markdown 是大文档的完整兜底，但它同样只含行列上限以内的内容。

老配置里的 `maxInlineReturnBytes` 仍作为 `inlineBlockBytes` 的兼容 fallback，新键优先。

### 输出与自动保存

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `saveJson` | `boolean` | `false` | 默认是否额外落结构化 JSON。 |
| `autoSave` | `boolean` | `false` | 默认是否自动保存到本地。 |
| `savePath` | `string` | `""` | 默认保存路径。留空 = 系统文档目录下的 `doc-intake`（没有 Documents 就退到家目录），不写死盘符，按各自的机器算。 |

`outputDir` 与 `summaryOnly` 的裁决顺序：传了 `outputDir` 就用它；没传时，开了 `autoSave` 或 `summaryOnly` 就落到保存路径；两者都没有则不落盘，只回正文。

### 服务入口的读取范围

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `serviceReadRoots` | `string` | `""` | 服务入口只接受这些目录下的路径，一行一个或分号分隔（中英文分号、换行都认）。留空 = 一律拒收外部路径。 |

这条闸只管服务入口（`app:doc-intake/*`）。工具调用与面板卡片是用户自己点的，不受它限制；`outputDir` 也不受它限制，它管的是读，不管写。目录匹配按规范化后的绝对路径前缀比，配置项写不成绝对路径的那一项直接丢掉。

### 自动清理

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cleanupEnabled` | `boolean` | `false` | 开启后，保存路径里超过保留时长的提取产出会被移到系统回收站。默认关：它会删文件，不该因为升级就自己开始动别人的目录。 |
| `cleanupKeepValue` | `number` | `7` | 保留时长数值，配下面的单位用，例如 7 天、12 小时、30 分钟。非法值按归零处理，结果是跳过清理，而不是立刻删光。 |
| `cleanupKeepUnit` | `"minute" \| "hour" \| "day"` | `"day"` | 上面那个数值的单位。 |

清理在每次提取开头起个头就走，不与本次提取同步等：这时本次要产出的文件还不存在，扫到的都是上一轮留下的。

### 日志

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `logLevel` | `"DEBUG" \| "INFO" \| "WARNING" \| "ERROR"` | `"INFO"` | 日志级别。 |
| `logFile` | `string` | `""` | 日志文件路径。留空则只输出到控制台（stderr）。 |

---

## 接入时最容易踩的几个坑

1. **显式给 `backend` 等于关掉降级。** 点名 `local` 之后，云端那几档不会再被试；扫描件只会安静地拿到空白。要降级就别指定。
2. **三个 Token 字段的「检测」只验鉴权。** 它不发解析任务，所以「检测通过」不等于这份文件能解析成功，也不消耗额度。
3. **服务入口的读取范围默认是空的。** 空着不是「全放开」，而是一律拒收外部路径；第一次接进来报 `PATH_NOT_ALLOWED` 多半是这个原因，而不是路径写错。
4. **`summaryOnly` 不是「只探测文件在不在」。** 它照常解析、照常落盘，只是不回正文；拿它当轻量预检会白烧一遍额度。
5. **保存下来的 JSON 与工具返回的路径块不是同一套路径。** 前者是相对路径（便于整个目录搬走），后者是绝对路径（便于当场读取）。
6. **图片链只有云端两档。** 默认 `oxr → paddleocr`，两个 Token 都没配就整链失败；纯离线场景要文字，只能自己想办法（本地那条路目前不接图片 OCR）。
