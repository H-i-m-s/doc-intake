---
name: doc-intake
description: >
  提取文档/图片内容，输出 Markdown。
  用户要求读取/提取/转换/解析任何文档文件时，必须使用此插件。
  MANDATORY TRIGGERS: 读取文档, 提取文档, 解析PDF, 识别图片, OCR, 文档转markdown,
  PDF提取, PPT提取, Excel提取, Word提取，图片内容提取，HTML提取, read document, extract text, parse PDF
compatibility: "需要 Python 环境和可选的云端 API Token"
metadata:
  default-enabled: true
---

# Doc Intake

**必须插件**：当用户发送任何文档/图片文件时，必须调用此插件提取内容。

## 触发条件

以下情况**必须**调用 `doc_intake`：
- 用户发送 PDF 文件
- 用户发送长图、满是文字的图片
- 用户发送 Word/PPT/Excel 文件
- 用户说"读取这个文档"、"提取内容"、"解析这个文件"
- 用户说"OCR"、"识别文字"、"转成 markdown"

以下情况**必须**调用 `doc_intake_validate`：
- 用户说"测试 token"、"测试 key"、"验证凭证"
- 用户问"token 有效吗"、"key 能用吗"
- 用户配置了 MinerU 或 PaddleOCR 后想确认是否正确

## 工具参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| source | array | ✅ | 文件路径列表（支持单个或多个文件，也支持文件夹路径） |
| outputDir | string | ❌ | 保存目录（空=只返回文本，**未指定时插件自动保存到默认路径**） |
| backend | string | ❌ | 强制后端：`auto`（默认）/ `mineru` / `paddleocr` / `local` |
| pageRange | string | ❌ | PDF 页码范围，如 `"1-5,10"` |
| language | string | ❌ | 语言：zh / en 等 |
| includeMedia | boolean | ❌ | 是否提取媒体（图片/视频/音频，默认 true）。关闭后只输出文本，不抽媒体文件 |
| format | string | ❌ | 输出格式：`markdown`（默认）/ `json` / `text` |
| saveJson | boolean | ❌ | 是否额外保存 JSON 格式（默认 false） |
| splitOnly | boolean | ❌ | 仅做图片分割测试，不调用后端（默认 false） |

**source 传文件夹时**：自动展开文件夹内所有支持的文档格式。

**批量处理（sources 或文件夹展开 ≥ 3 个文件）时**：只返回文件列表和处理结果概览，不返回文档具体内容。

## 后端选择与降级链

PDF 默认走**降级链**（用户在插件设置面板里配，默认 MinerU→PaddleOCR→Local）：
1. 先 MinerU；失败自动降到 PaddleOCR；再失败降到本地 PyMuPDF 兜底（提取纯文本，无 OCR）
2. 想强制只用某一档：传 `backend="local"`，chain 就被覆盖成 `["local"]`

| 文件类型 | 默认 chain | 说明 |
|---------|-----------|------|
| PDF | mineru→paddleocr→local | 失败自动降级 |
| 图片（jpg/png/webp/tiff...） | `["paddleocr"]` | 自动长图分割 |
| DOCX / PPTX / XLSX | `["local"]` | 本地 Python 解析 |
| .ppt | `["local"]` | 本地用 PowerPoint COM 转 .pptx 后处理 |

**多 Key 轮询**：MinerU / PaddleOCR 都支持多 Token，配置时用分号分隔。单个 Key 失效会自动切下一个。

**PaddleOCR 定位**：chain 上的降级档，不是独立路径。不建议用户单独把它当主用。

## 使用场景

### 场景 1：聊天中读取文档
```
用户：[发送文件 report.pdf]
Agent：调用 doc_intake(source=["report.pdf"])
```

### 场景 2：用户指定保存位置
```
用户：把这个 PDF 提取到 D:/Output
Agent：调用 doc_intake(source=["report.pdf"], outputDir="D:/Output")
```

**重要**：除非用户明确指定了保存位置，否则不要传 outputDir 参数，插件会自动保存到默认路径。

### 场景 3：只提取特定页
```
用户：只提取前 5 页
Agent：调用 doc_intake(source=["report.pdf"], pageRange="1-5")
```

### 场景 4：验证 Token
```
用户：测试一下 token
Agent：调用 doc_intake_validate()
返回：列出每个 Token 的有效性（通过实际 API 请求验证）

用户：只测 MinerU 的 token
Agent：调用 doc_intake_validate(backend="mineru")
```

### 场景 5：批量处理文件夹
```
用户：提取这个文件夹里的所有文档  D:\各种文件
Agent：调用 doc_intake(source=["D:\各种文件"], outputDir="D:\输出")
返回：16 个文件处理完成，12 成功 4 失败
      ✅ 报告.docx
      ✅ 说明.pptx
      ❌ 合同.pdf（平台限制）
      ...
（文件已保存到本地，具体内容需查看本地文件）
```

### 场景 6：手动指定多个文件
```
用户：处理这三个文件
Agent：调用 doc_intake(source=["a.docx","b.pptx","c.xlsx"], outputDir="D:\输出")
```

**注意**：1-2 个文件返回完整内容，3 个及以上只返回概览。

## 输出格式

### Markdown 返回（默认）
直接返回 Markdown 文本到对话中。

### 保存文件
指定 `outputDir` 或启用自动保存后保存：
```
outputDir/
├── 文件名.pptx.md          ← markdown 文件（原始文件名 + 扩展名）
├── 文件名.pptx.json        ← JSON 格式（可选，saveJson=true）
├── 文件名.pptx_media/      ← 媒体目录(图/视频/音频都在这里)
│   ├── image_001.png
│   ├── image_002.png
│   ├── video_001.mp4
│   ├── audio_001.mp3
│   └── ...
```

媒体命名按类型分别连续编号：`image_001.png` / `video_001.mp4` / `audio_001.mp3`。

### 引导文字
保存到本地且有媒体时，markdown 末尾自动追加：
```
📎 提取了 X 个媒体文件（📷 N 张图片、🎬 M 个视频、🎵 K 个音频），已保存到本地。请先阅读以上媒体，再结合文档内容回复。
```

### Markdown 媒体引用语法
- 图片：`![alt](stem_media/image_001.png)` — 渲染成普通图片
- 视频：`<video controls src="stem_media/video_001.mp4" title="alt"></video>` — 标准 HTML5 标签，Markdown 渲染器普遍支持
- 音频：`<audio controls src="stem_media/audio_001.mp3" title="alt"></audio>` — 同上

### 公式支持
PPTX / DOCX 中的公式支持：
- **OMML**（Office Math Markup Language）：自动转换为 LaTeX
- **MathType (MTEF)**：自动转换为 LaTeX
- **Equation.3**（不支持的公式）：回退为预览图片

### EMF 转换
Office 文档中的 EMF 图片自动转换为 PNG（用 Pillow；老 Pillow 不支持 EMF 时保留原文件）。

### 视频/音频提取
DOCX / PPTX / XLSX / HTML 中的嵌入视频和音频会被一并抽出（开启 `includeMedia` 时）：
- **PPTX**：扫描 `p:video` / `p:audio` 节点（含 AlternateContent.Fallback、videoFile/audioFile 的 r:link）
- **DOCX**：从 `word/media/*` 抽取所有媒体（含 mp4/mp3/wav 等），不做特殊引用语法区分
- **XLSX**：从 `xl/media/*` 抽取所有媒体，按 drawings 锚定位置插入到对应单元格
- **HTML**：下载 `<img>` / `<video>` / `<audio>` / `<source>` 引用的远程媒体

### .ppt 转换
旧版 .ppt 文件用 PowerPoint COM（`win32com` + `DispatchEx`）后台转 .pptx 后再走 PPTX 提取；过程不闪窗口（Microsoft COM 限制：Visible=False 会抛错，所以仅靠 DispatchEx 隔离进程 + SaveAs 后立即 Close+Quit）。

## 错误处理

| 错误 | 表现 |
|------|------|
| `PYTHON_PATH_NOT_CONFIGURED` | 未填 Python 路径时硬报错，**不** fallback 到 PATH 里的 python |
| `INVALID_SOURCE` | source 不是有效文件路径 |
| `SPAWN_FAILED` | Python 子进程启动失败 |
| `PYTHON_ERROR` | Python 提取失败（stderr 透传到 details） |
| 链式降级全失败 | `warnings` 列出每档失败原因，`markdown` 是错误提示 |

`metadata.usedBackend` 记录实际用到的后端档；`metadata.fallbackReasons` 记录每档失败原因。

## pythonPath 必填
插件设置面板里 `pythonPath` 必须填（conda 环境路径，如 `E:\Conda\envs_dirs\Agent\python.exe`）。未填时不静默 fallback，直接报错提醒用户配置。