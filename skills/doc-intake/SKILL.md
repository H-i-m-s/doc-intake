---
name: doc-intake
description: >
  Use when the user asks to read, open, view, inspect, understand, summarize, analyze, transcribe, recognize, or extract text/tables/images from any PDF, DOCX, PPTX, PPT, XLSX, XLSM, HTML, or image file (PNG, JPG, JPEG, BMP, TIFF, TIF, WEBP, GIF), including when they mention Word document, Excel spreadsheet, PowerPoint presentation, slide deck, Office document, PDF report, scanned image, screenshot of text, or image containing text in passing. The first-line tool for any "read this file" or "what does this file say" request. Supports OCR for scanned/image-only PDFs and images. 读取/提取/解析/识别/转换任何 PDF、Word、Excel、PPT、图片、HTML 文件时必须使用此插件，不要自己读二进制或猜测文件内容。
compatibility: "需要 Python 环境（用户需在插件设置面板填 pythonPath）和可选的云端 API Token（MinerU / PaddleOCR）"
metadata:
  default-enabled: true
---

# Doc Intake

**必须插件**：用户发送任何文档/图片文件时，必须调用此插件提取内容。

## 触发条件

以下情况**必须**调用 `doc_intake`：
- 用户发送 PDF / Word / PPT / Excel / HTML / 图片文件
- 用户说"读取这个文档"、"提取内容"、"解析这个文件"、"转成 markdown"
- 用户说"OCR"、"识别文字"、"识别图片里的字"

以下情况**必须**调用 `doc_intake_validate`：
- 用户说"测试 token"、"测试 key"、"验证凭证"
- 用户问"token 有效吗"、"key 能用吗"
- 用户刚配置完 MinerU / PaddleOCR Token 后想确认是否正确

---

## 安全边界

- MinerU / PaddleOCR 凭证由 JS 通过一次性 stdin 管道传给 Python，不注入 `DOC_INTAKE_SETTINGS` 环境变量。
- Python 仍保留环境变量读取，仅用于直接命令行调用的兼容回退；正式插件入口不会使用该回退。
- Token 验证工具同样通过 stdin 传递凭证，命令行参数仅用于旧版手动调用。
- 错误日志会遮蔽已知完整 Token，避免异常文本或第三方响应回显凭证。

## 工具 1：`doc_intake`

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `source` | array | ✅ | — | 文件路径列表。**支持单个文件、多个文件、文件夹**。文件夹自动展开成所有支持的文档。 |
| `outputDir` | string | ❌ | 插件设置 `savePath` | 保存目录。**未指定时插件按 `autoSave` 配置自动决定**：若启用则保存到 `savePath`，否则不保存文件。 |
| `backend` | string | ❌ | `"auto"` | 强制后端。可选值：`auto`（按文件类型走默认链）/ `mineru` / `paddleocr` / `local`。 |
| `pageRange` | string | ❌ | 全部页 | PDF 页码范围，格式 `"1-5,10,15-20"`（1-based）。 |
| `language` | string | ❌ | 插件设置 `defaultLanguage`（默认 `zh`） | 文档语言，传给 OCR / 云端 API。 |
| `includeMedia` | boolean | ❌ | `true` | 是否提取媒体（图片/视频/音频）。**关闭后只输出文本，不抽文件**。 |
| `saveJson` | boolean | ❌ | `false` | 是否额外保存 JSON 格式文件（与 markdown 并列）。 |
| `splitOnly` | boolean | ❌ | `false` | 仅做图片分割测试，不调用后端。**调试用，正常提取不要传**。 |

### 后端选择

`backend` 默认 `auto`，按文件类型走默认链（用户在插件设置面板可改 `pdfBackendChain`）：

| 文件类型 | 默认链 | 说明 |
|---------|--------|------|
| PDF | local | 默认只走本地；用户显式配置云端链后失败自动降级到下一档 |
| 图片（jpg/png/webp/tiff/...） | paddleocr | 自动长图分割 |
| DOCX / PPTX / XLSX / HTML | local | 本地 Python 解析 |
| .ppt | local | 本地用 PowerPoint 转成 .pptx 后处理 |

需要强制只用某一档时，传 `backend="local"` 等。MinerU / PaddleOCR 支持多 Token 轮询（用户在设置面板用分号分隔多个 Token，单个 Key 失效自动切下一个）。

### 支持的文件格式

PDF / DOCX / PPTX / PPT / XLSX / XLSM / HTML / HTM / JPG / JPEG / PNG / BMP / TIFF / TIF / WEBP / GIF

### 返回内容（关键概念）

返回策略按最终结果大小判断，不按文件数量判断：

- 未超过默认 `4 × 28 KiB`：返回完整 Markdown + 文件元信息 + 媒体列表，正文可能拆成多个 text block。
- 超过块容量且已保存到本地：返回处理概览和 `mdPath` / `imagesDir`，完整内容从本地文件读取。
- 超过块容量且未保存到本地：在多个 text block 中保留 Markdown 开头和结尾，中间内容插入省略提示，并明确标记内容不完整。

大 PDF 的分块只用于云端上传；插件会在 Python 进程内生成内存 PDF bytes，不创建源目录下的 `*_chunks` 文件夹或 chunk PDF，再按 `chunkIndex` 顺序合并所有结果，统一生成一个原文件对应的 Markdown/JSON 和唯一媒体目录，不会把 chunk 结果作为本地输出文件。

### 输出文件结构（保存到本地时）

大 PDF 的分块只在插件内部以内存 PDF bytes 完成，源文件目录不会出现 `*_chunks` 文件夹或 chunk PDF。

```
outputDir/
├── 文件名.pdf.md      ← 完整合并后的 markdown（原始 PDF 文件名 + .md 后缀）
├── 文件名.pdf.json    ← 完整合并后的 JSON（仅 saveJson=true 时）
└── 文件名_media/      ← 唯一媒体目录（图/视频/音频都在这里）
    ├── image_001.png
    ├── video_001.mp4
    ├── audio_001.flac
    └── ...
```

媒体命名按类型分别连续编号：普通文件使用 `image_001.png` / `video_001.mp4` / `audio_001.flac`；分块 PDF 会增加 `chunk_NNN_` 前缀，避免并发分块之间覆盖。

### markdown 中的媒体引用

- 图片：`![alt](文件名_media/image_001.png)`
- 视频：`<video controls src="文件名_media/video_001.mp4" title="alt"></video>`
- 音频：`<audio controls src="文件名_media/audio_001.flac" title="alt"></audio>`

### 使用场景

**场景 1：聊天中读取文档**
```
用户：[发送文件 report.pdf]
→ 调用 doc_intake(source=["report.pdf"])
```

**场景 2：用户指定保存位置**
```
用户：把这个 PDF 提取到 D:/Output
→ 调用 doc_intake(source=["report.pdf"], outputDir="D:/Output")
```

> **重要**：除非用户明确指定了保存位置，否则不要传 `outputDir`，让插件按配置自动处理。

**场景 3：只提取特定页**
```
用户：只提取前 5 页
→ 调用 doc_intake(source=["report.pdf"], pageRange="1-5")
```

**场景 4：批量处理文件夹**
```
用户：提取这个文件夹里的所有文档  D:\各种文件
→ 调用 doc_intake(source=["D:\\各种文件"], outputDir="D:\\输出")
→ 返回：16 个文件处理完成，12 成功 4 失败 + 文件列表
> 内容需查看本地文件，不要让 agent 假装自己读到了
```

**场景 5：手动指定多个文件**
```
用户：处理这三个文件
→ 调用 doc_intake(source=["a.docx", "b.pptx", "c.xlsx"], outputDir="D:\\输出")
```

**场景 6：只想要文本，不要抽文件**
```
用户：快速看一下文档内容就行
→ 调用 doc_intake(source=["x.pdf"], includeMedia=false)
```

### 错误处理

| 错误 | 表现 |
|------|------|
| `PYTHON_PATH_NOT_CONFIGURED` | 用户没在插件设置面板填 `pythonPath`，硬报错。**指引用户去设置面板配置**。 |
| `INVALID_SOURCE` | source 不是有效文件路径 |
| 链式降级全失败 | 返回的 markdown 是错误提示，`warnings` 列出每档失败原因 |

---

## 工具 2：`doc_intake_validate`

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `backend` | string | ❌ | `"all"` | 要验证的后端。可选值：`all` / `mineru` / `paddleocr`。 |

### 使用场景

```
用户：测试一下 token
→ 调用 doc_intake_validate()
→ 返回：每个 Token 的有效性（通过实际 API 请求验证）

用户：只测 MinerU 的 token
→ 调用 doc_intake_validate(backend="mineru")

用户：只测 PaddleOCR 的 token
→ 调用 doc_intake_validate(backend="paddleocr")
```

### 注意事项

- 验证是对每个 Token 发实际请求，所以会消耗 API 配额（很少，几 KB）
- 用户配置了 Token 但没传 `backend` 时，默认全部验证
- 用户没配置任何 Token 时返回"未配置"的提示

---

## 输出格式参考

保存到本地且有媒体时，markdown 末尾会自动追加引导词：
```
📎 提取了 X 个媒体文件（📷 N 张图片、🎬 M 个视频、🎵 K 个音频），已保存到本地。请先阅读以上媒体，再结合文档内容回复。
```

**Agent 看到这条引导词时，应该真的去读媒体文件**，不要跳过。