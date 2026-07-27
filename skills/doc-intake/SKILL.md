---
name: doc-intake
description: >
  必须用于读取、查看、理解、总结、分析、转录、OCR 或提取任何 PDF、DOCX、PPTX、PPT、XLSX、XLSM、HTML 或图片文件（PNG、JPG、JPEG、BMP、TIFF、TIF、WEBP、GIF）。当用户发送文档/图片、提到 Word、Excel、PowerPoint、PDF、扫描件、截图文字、公式、表格或图片内容时，优先调用本 skill 的工具，不要自行读取二进制文件或猜测文件内容。需要验证 MinerU/PaddleOCR Token 或 Key 时调用 doc_intake_validate。
compatibility: "需要 Python 环境（用户需在插件设置面板填 pythonPath）和可选的 MinerU / PaddleOCR Token"
metadata:
  default-enabled: true
---

# Doc Intake 调用规则

## 1. 工具选择

### 调用 `doc_intake`

以下情况直接调用 `doc_intake`：

- 用户发送或指定 PDF、DOCX、PPTX、PPT、XLSX、XLSM、HTML、HTM 或图片文件。
- 用户要求读取、查看、解析、提取、识别、OCR、转 Markdown、总结或分析文件内容。
- 用户询问文档中的文字、表格、公式、图片、视频、音频或链接。
- 用户要求批量处理多个文件或一个文件夹。

### 调用 `doc_intake_validate`

以下情况调用 `doc_intake_validate`，不要调用 `doc_intake`：

- 用户要求测试或验证 MinerU/PaddleOCR Token、Key 或凭证。
- 用户询问 Token/Key 是否有效。
- 用户刚配置 Token 后要求确认配置。

## 2. `doc_intake` 参数

只传有明确需求的参数；没有特别要求时使用默认值。

| 参数 | 类型 | 调用规则 |
|---|---|---|
| `source` | `string[]` | 必填。传文件路径、多个文件路径或文件夹路径。 |
| `outputDir` | `string` | 只有用户明确要求保存，或任务需要后续读取完整大文档时传。没有保存需求时不要主动传。 |
| `backend` | `string` | 只有用户指定后端时传：`auto`、`mineru`、`paddleocr`、`local`。 |
| `pageRange` | `string` | 用户指定 PDF 页码时传，例如 `1-5,10`。 |
| `language` | `string` | 用户指定 OCR/识别语言时传；否则不传。 |
| `includeMedia` | `boolean` | 用户明确不要提取图片、视频、音频时传 `false`；否则不传。 |
| `saveJson` | `boolean` | 用户要求 JSON，或明确要求结构化保存时传 `true`；否则不传。 |
| `summaryOnly` | `boolean` | 用户只想确认每个文件是否成功时传 `true`；传入后仍执行提取，但不返回 Markdown 正文。成功但带 warnings 的文件仍算成功。 |
| `splitOnly` | `boolean` | 只有用户要求测试长图切割时传 `true`；正常提取不要传。 |

常用调用：

```text
doc_intake(source=["report.pdf"])
doc_intake(source=["report.pdf"], outputDir="D:/Output")
doc_intake(source=["report.pdf"], pageRange="1-5")
doc_intake(source=["paper.pdf"], backend="local")
doc_intake(source=["document.docx"], includeMedia=false)
doc_intake(source=["a.docx", "b.pptx", "c.xlsx"], outputDir="D:/Output")
doc_intake(source=["a.pdf", "b.docx"], summaryOnly=true)
```

## 3. 后端选择

默认不传 `backend`，让插件按文件类型和设置中的降级链处理。

- PDF：默认本地后端；用户配置云端链时按设置顺序降级。
- 图片：默认走 PaddleOCR 配置链。
- DOCX、PPTX、XLSX、HTML、PPT：走本地 Python 解析。
- 用户要求不上传 PDF 或只用本地解析时传 `backend="local"`。
- 不要因为本地解析失败就自行改写参数；根据返回的 `warnings` 判断是否需要建议用户改用其他后端。

## 4. 结果处理

- 先读取工具返回的 `content` 和 `details.data`，再回答用户。
- `summaryOnly=true` 时，只根据每个文件的 `status`、`error` 和保存路径汇报结果，不要寻找或补写正文。
- 返回正文完整时，直接基于正文回答，不要重复调用工具。
- 返回 `mdPath` 时，正文已保存到本地；需要完整内容时读取该 Markdown 文件，不要假装已经看到了未返回的正文。
- 返回 `imagesDir` 或媒体列表时，用户的问题涉及图片、公式预览、视频或音频，就继续读取相关媒体；不要只看文字摘要。
- 返回 `contentTruncated: true`、`contentOmitted: true` 或“中间内容已省略”时，只能基于实际返回部分回答，并明确说明内容不完整；需要完整分析时先读取 `mdPath`，没有路径则请求用户允许保存或缩小范围。
- 批量结果中逐项查看成功/失败状态和 `warnings`，不要把部分成功说成全部成功。
- 看到后端降级警告时，在回答中说明实际使用的后端；不要声称使用了用户未要求或未成功的后端。
- 看到媒体引导文字时，按引导读取媒体后再回答涉及媒体的问题。

## 5. 保存与路径规则

- 用户明确给出保存目录时，原样传入 `outputDir`。
- 用户没有要求保存时，不要擅自指定 `outputDir`。
- 不要猜测或重写 `mdPath`、`imagesDir`、`mediaPaths`；按工具返回的真实路径读取。
- 不要把 Markdown 中的媒体引用路径当作本地绝对路径；需要读取文件时优先使用 `mediaPaths` 或 `imagesDir`。

## 6. 错误处理

- `PYTHON_PATH_NOT_CONFIGURED`：告知用户到插件设置中配置 `pythonPath`。
- `INVALID_SOURCE` 或找不到文件：检查路径和文件格式，请用户提供有效路径。
- `SPAWN_FAILED`、`PYTHON_ERROR`：说明 Python 环境或依赖启动失败，不要编造提取结果。
- 后端全部失败：展示实际错误和 `warnings`，建议用户检查配置或更换后端。
- Token 验证失败：说明具体后端和失败原因，不要回显完整 Token。

## 7. 禁止行为

- 不要绕过 `doc_intake` 自行解析用户文档或图片二进制内容。
- 不要把 `doc_intake_validate` 当作文档提取工具。
- 不要为了“看起来完整”补写工具没有返回的内容。
- 不要在未读取保存文件或媒体文件前声称已经分析了它们。
