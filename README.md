<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/python-3.11+-yellow" alt="python">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="platform">
</p>

<h1 align="center">Doc Intake</h1>

<p align="center">
  Hana 插件 · 文档与图片内容提取工具<br>
  PDF / Word / PPT / Excel / HTML / 图片 → 结构化 Markdown
</p>

---

## 为什么不用 `office_read-document`？

`office_read-document` 是 Hana 内置的 Office 文档读取工具，适合快速读取 `.docx`、`.xlsx`、`.pptx` 等文件的纯文本内容。但它的能力边界很清晰：

| 能力 | `office_read-document` | `doc-intake` |
|------|:---:|:---:|
| 纯文本提取（Word/Excel/PPT） | ✅ | ✅ |
| PDF 文本提取 | ✅（仅数字 PDF） | ✅（数字 PDF + 扫描件 OCR） |
| **扫描件 / 图片型 PDF OCR** | ❌ | ✅ MinerU VLM |
| **图片文字识别（109+ 语言）** | ❌ | ✅ PaddleOCR |
| **公式识别 → LaTeX** | ❌ | ✅ OMML + MathType |
| **表格结构识别** | ❌ | ✅ MinerU / PaddleOCR |
| **文档内媒体提取（图片/视频/音频）** | ❌ | ✅ 按类型分别编号 |
| **EMF/WMF 矢量图 → PNG** | ❌ | ✅ |
| **MathType OLE → LaTeX** | ❌ | ✅ MTEF 解析 |
| **HTML 完整提取（元数据/链接/代码块）** | 基础 | ✅ 结构化 |
| **长图智能分割** | ❌ | ✅ 空白行检测 |
| **大 PDF 自动切割** | ❌ | ✅ 按页数分块 |
| **多 Token 轮询 + 自动降级** | ❌ | ✅ |
| **批量并行处理** | ❌ | ✅ 双池并发 |

简单说：`office_read-document` 拿到的是"文字"，`doc-intake` 拿到的是"内容"。如果你只需要读个 Word 纯文本，前者够用；如果涉及扫描件、公式、图片识别、媒体提取、批量处理，用 `doc-intake`。

---

## 这个插件做什么

`doc-intake` 是 Hana 的文档/图片内容提取插件，目标是把各种格式的文件转化为结构化 Markdown，同时把文档中的媒体（图片、视频、音频）提取到本地。

**核心设计原则：**

- **敏感配置隔离**：MinerU / PaddleOCR 凭证通过一次性 stdin 管道传给 Python，不再注入 `DOC_INTAKE_SETTINGS` 环境变量；旧环境变量仅保留给手动兼容调用
- **敏感错误脱敏**：第三方异常、降级警告和日志会遮蔽已知完整 Token，避免凭证随错误文本回显

- **后端降级链**：PDF 默认只走本地 PyMuPDF，避免无 Token 时隐式上传原件；用户可在设置中显式配置 `MinerU → PaddleOCR → local` 等链，失败自动降级到下一档
- **多 Token 轮询**：每个云端 API 支持配置多个 Token，单个失效自动切换下一个，不中断批处理
- **双池并发**：云端 API 和本地解析分别走独立的并发池，互不抢资源
- **归一化输出**：所有后端产出统一为 Markdown + 媒体文件，调用方不需要关心底层用的是哪个引擎

---

## 适用人群

| 人群 | 典型场景 |
|------|----------|
| **学术研究者** | 扫描版论文 PDF 提取、国标 GB/T 文件解析（Founder 方正字体乱码修复）、公式转 LaTeX、表格结构识别 |
| **技术文档维护者** | 批量提取 Word/PPT/Excel 内容转 Markdown 归档、提取文档内嵌图片和音视频 |
| **Hana 插件/Skill 开发者** | 在自己的插件中调用 `doc_intake` 获取文档内容，无需重复造轮子 |
| **数据采集与知识管理** | 网页 HTML 完整提取（元数据/链接/代码块/远程媒体）、长截图文字识别 |
| **经常处理中文 PDF 的用户** | 中文 OCR（109+ 语言）、扫描件表格识别、公式识别，覆盖 MinerU / PaddleOCR 双引擎 |

如果你只是偶尔读个 Word 纯文本，Hana 内置的 `office_read-document` 够用，不需要装这个插件。

---

## 安装 & 配置
### 前置条件

1. **Python 环境**：在插件设置面板的 `pythonPath` 填写 conda 环境的 `python.exe` 路径
2. **Python 依赖**：

```bash
pip install -r python/requirements.txt
```

核心依赖：
- `pypdf` / `pdfplumber` — PDF 本地解析
- `Pillow` — 图片处理、EMF/WMF 转换
- `mineru-open-sdk` — MinerU 云端 API（可选）
- `requests` — PaddleOCR HTTP API（可选）

3. **云端 Token**（可选）：
   - MinerU Token：https://mineru.net/apiManage/token
   - PaddleOCR Token：https://aistudio.baidu.com/account/accessToken

没有 Token 也能用：PDF 默认走本地 PyMuPDF，不会隐式调用云端；如需 MinerU/PaddleOCR，请在设置中显式配置后端链并提供对应凭证。图片 OCR 仍需要 PaddleOCR Token。

### 后续推荐操作

#### 1. 配置云端 Token

插件支持用户显式配置 `MinerU → PaddleOCR → 本地 PyMuPDF` 等 PDF 降级链，图片 OCR 只有 PaddleOCR 一档。要让扫描件和图片具备云端识别能力，需要配置对应 Token：

- **MinerU Token**：[获取地址](https://mineru.net/apiManage/token) → 填入插件设置面板的 `mineruCredentials`（多个用分号分隔）
- **PaddleOCR Token**：[获取地址](https://aistudio.baidu.com/account/accessToken) → 填入插件设置面板的 `paddleTokens`（多个用分号分隔）

> ⚠️ MinerU Token 有效期 **90 天**，到期后提取会失败并自动降级到 PaddleOCR / 本地档。建议日历提醒自己续期。

没有 Token 也能用：PDF 默认走本地 PyMuPDF，不会隐式调用 MinerU Flash；如需云端识别，请显式配置云端后端并提供对应 Token。图片 OCR 仍需要 PaddleOCR Token。

#### 2. 验证 Token 是否生效

配置完 Token 后，调用一次验证：

```
doc_intake_validate()
```

返回每个 Token 的有效性。全部通过说明降级链三档齐全，覆盖面最广。

#### 3. 清理自带的 `office-documents` skill

Hana 自带 `office-documents` skill，它的设计思路是「一个 skill 干所有事」——读、写、转换、格式化全包。结果是每个场景都只能做到「能用」级别：扫描件是空白、公式丢失、媒体不提取、批量无并发。

`doc-intake` 和 `office-cli` 是反过来的思路：**把读和写拆成两个独立工具，各自做到专精**。

| | `office-documents` | `doc-intake` + `office-cli` |
|---|---|---|
| 读文档 | 能读，但不支持 OCR/公式/媒体 | `doc-intake`：扫描件 OCR、公式转 LaTeX、媒体提取全覆盖 |
| 写文档 | 能写，但格式控制粗糙 | `office-cli`：格式精确、排版可控 |
| 格式转换 | 基础转换 | `office-cli`：支持更多格式和高级选项 |
| 并发 | 无 | `doc-intake`：双池并发 + 多 Token 轮询 |

**操作**：在 Hana 的 Skills 管理界面中卸载 `office-documents`。卸载后 Agent 不会再优先调用它，文档请求会走 `doc-intake`。

---


## 架构

```
┌─────────────────────────────────────────────────┐
│                  JS 层 (Node.js)                 │
│                                                 │
│  doc_intake.js ─→ service.js ─→ Python spawn    │
│  doc_intake_validate.js                         │
│                                                 │
│  职责: 参数校验 / 文件级并发控制 / 批量摘要      │
│        / 结果格式化                              │
└──────────────────────┬──────────────────────────┘
                        │ 配置走 stdin，结果走 stdout
                       ▼
┌─────────────────────────────────────────────────┐
│                Python 层 (main.py)               │
│                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ MinerU   │  │  PaddleOCR   │  │  Local    │ │
│  │ Client   │  │  Client      │  │ Extractors│ │
│  └────┬─────┘  └──────┬───────┘  └─────┬─────┘ │
│       │               │                │        │
│       ▼               ▼                ▼        │
│  cloud API      cloud API       PyMuPDF /       │
│  (vlm/pipeline)  (HTTP API)     python-docx /   │
│                                  openpyxl /      │
│                                  html2markdown   │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │          Shared Infrastructure           │   │
│  │  KeyPool · api_retry · ImageSplitter     │   │
│  │  EMF→PNG · OMML→LaTeX · MathType→LaTeX  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 项目结构

```
doc-intake/
├── manifest.json                 # 插件清单（配置项 schema、版本、描述）
├── package.json                  # Node.js 包信息
├── README.md
│
├── tools/                        # Hana 工具入口（JS）
│   ├── doc_intake.js             # 主工具：文档/图片提取
│   └── doc_intake_validate.js    # 工具：Token 验证
│
├── lib/                          # JS 公共模块
│   ├── service.js                # 核心调度：Python spawn、结果解析
│   ├── settings.js               # 配置读取（合并 manifest defaults + 用户设置）
│   ├── file-checker.js           # 文件类型检测、PDF 页数查询
│   ├── doc-intake-helpers.js     # 媒体引导词构建、Agent payload 格式化
│   ├── tool-output.js            # 统一工具输出格式（toToolResult / toToolError）
│   ├── errors.js                 # DocIntakeError 错误类 + 序列化
│   ├── semaphore.js              # 并发信号量（双池并发控制）
│   ├── logger.js                 # JS 端日志（stderr，不污染 stdout JSON）
│   └── validate.js               # Token 验证逻辑（JS 端实现）
│
├── python/                       # Python 后端
│   ├── main.py                   # Python 入口：参数解析、后端选择、链式降级、结果格式化
│   ├── mineru_client.py          # MinerU 云端 API 客户端（多 credential KeyPool）
│   ├── paddle_client.py          # PaddleOCR HTTP API 客户端（多 token KeyPool）
│   ├── key_pool.py               # 统一 KeyPool：多 credential 轮询 + 失败跳过
│   ├── api_retry.py              # HTTP 重试：指数退避、429/5xx 自动重试
│   ├── image_splitter.py         # 长图智能分割（空白行检测 + 色差容忍）
│   ├── pdf_splitter.py           # 大 PDF 内存分块（PyMuPDF bytes）
│   ├── split_cli.py              # 旧版手动 PDF 切割兼容 CLI（主流程不调用）
│   ├── utils.py                  # 图片归一化（URL/本地/对象 → {stem}_media/）
│   ├── validate.py               # Token 验证脚本（Python 端实现）
│   ├── logger.py                 # Python 端日志（stderr）
│   ├── mathtype_converter.py     # MathType OLE → LaTeX（基于 MTEF 解析）
│   ├── requirements.txt          # Python 依赖
│   │
│   ├── extractors/               # 本地提取器
│   │   ├── __init__.py           # 提取器注册表（get_extractor）
│   │   ├── base.py               # 基类 BaseExtractor + ExtractionResult 数据结构
│   │   ├── _utils.py             # 公共工具（媒体分类/命名/渲染、XML namespace、表格）
│   │   ├── docx_extractor.py     # DOCX 提取（文本/表格/公式/图/视/音）
│   │   ├── pptx_extractor.py     # PPTX 提取（文本/表格/公式/图/视/音、.ppt 转换）
│   │   ├── xlsx_extractor.py     # XLSX/XLSM 提取（表格/图片锚定）
│   │   ├── html_extractor.py     # HTML 提取（元数据/链接/代码块/远程媒体下载）
│   │   ├── pdf_extractor.py      # PDF 本地兜底（PyMuPDF 文本+内嵌图）
│   │   ├── emf_converter.py      # EMF/WMF → PNG 转换 + 媒体通用抽取
│   │   ├── omml_converter.py     # OMML（Office 数学标记）→ LaTeX
│   │   └── mathtype_filter.py    # MathType 预览图过滤（避免重复提取）
│   │
│   └── mathtype/                 # MathType MTEF 解析库
│       ├── __init__.py
│       ├── mtef.py               # MTEF 二进制格式解析
│       ├── record.py             # MTEF 记录解析
│       ├── chars.py              # 字符映射
│       ├── ole_util/             # OLE 复合文件读取
│       └── setup.py
│
└── skills/
    └── doc-intake/
        └── SKILL.md              # Agent 技能描述（触发条件、参数、使用场景）
```

---

## 支持的文件格式

| 格式 | 扩展名 | 后端 | 说明 |
|------|--------|------|------|
| PDF | `.pdf` | MinerU → PaddleOCR → Local | 链式降级，扫描件走 OCR |
| Word | `.docx` | Local | 文本/表格/公式/图片/视频/音频 |
| PowerPoint | `.pptx` | Local | 文本/表格/公式/图片/视频/音频 |
| PowerPoint (旧版) | `.ppt` | Local (COM→pptx) | 需要 pywin32，自动转 pptx 后处理 |
| Excel | `.xlsx` / `.xlsm` | Local | 表格/图片锚定 |
| HTML | `.html` / `.htm` | Local | 元数据/链接/代码块/远程媒体 |
| 图片 | `.jpg` `.jpeg` `.png` `.bmp` `.tiff` `.tif` `.webp` `.gif` | PaddleOCR | 自动长图分割 |

---

## 工具参数完整参考

### 工具 1：`doc_intake`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|:---:|--------|------|
| `source` | `string[]` | ✅ | — | 文件路径列表。支持单个文件、多个文件、文件夹路径。文件夹自动展开为所有支持格式的文件。 |
| `outputDir` | `string` | ❌ | 由 `autoSave` + `savePath` 配置决定 | 保存目录。未指定时：若 `autoSave=true` 则保存到 `savePath`，否则不保存文件。 |
| `backend` | `"auto" \| "mineru" \| "paddleocr" \| "local"` | ❌ | `"auto"` | 强制指定后端。`auto` 按文件类型走默认降级链。 |
| `pageRange` | `string` | ❌ | 全部页 | PDF 页码范围，格式 `"1-5,10,15-20"`（1-based）。仅 PDF 有效。 |
| `language` | `string` | ❌ | `"zh"` | 文档语言，传递给 OCR / 云端 API。影响 PaddleOCR 和 MinerU 的识别语言。 |
| `includeMedia` | `boolean` | ❌ | `true` | 是否提取媒体文件（图片/视频/音频）。设为 `false` 时只输出文本，不抽取文件。 |
| `saveJson` | `boolean` | ❌ | `false` | 是否额外保存结构化 JSON 文件（与 .md 并列）。JSON 包含 markdown 内容 + metadata。 |
| `splitOnly` | `boolean` | ❌ | `false` | 仅做图片分割测试，不调用后端。调试用，正常提取不要传。 |

### 工具 2：`doc_intake_validate`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|:---:|--------|------|
| `backend` | `"all" \| "mineru" \| "paddleocr"` | ❌ | `"all"` | 要验证的后端。`all` 同时验证 MinerU 和 PaddleOCR 的所有 Token。 |

---

## 插件配置项完整参考

以下所有配置项均在 Hana 插件设置面板中修改，不需要手动编辑配置文件。

### 基础配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `pythonPath` | `string` | `""` | Python 可执行文件路径（如 conda 环境的 `python.exe`）。**必填**，不填则无法运行。 |
| `defaultBackend` | `"auto" \| "mineru" \| "paddleocr" \| "local"` | `"auto"` | 默认解析后端。 |
| `defaultLanguage` | `string` | `"zh"` | 默认语言（`zh` / `en` 等），传递给 OCR 和云端 API。 |
| `includeMedia` | `boolean` | `true` | 默认是否提取媒体（图片/视频/音频）。 |
| `saveJson` | `boolean` | `false` | 默认是否保存结构化 JSON。 |
| `autoSave` | `boolean` | `false` | 默认是否自动保存到本地。 |
| `savePath` | `string` | `"D:\\Agent"` | 默认保存路径。 |

### MinerU 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `mineruCredentials` | `string` | `""` | MinerU Token，多个用分号分隔。获取地址：https://mineru.net/apiManage/token |
| `mineruModelVersion` | `"vlm" \| "pipeline" \| "MinerU-HTML"` | `"vlm"` | MinerU 模型版本。`vlm` 精度最高，`pipeline` 速度快。 |
| `mineruEnableOCR` | `boolean` | `true` | MinerU 是否开启 OCR（仅 `pipeline` / `vlm` 有效）。 |
| `mineruEnableFormula` | `boolean` | `true` | MinerU 是否开启公式识别。 |
| `mineruEnableTable` | `boolean` | `true` | MinerU 是否开启表格识别。 |
| `mineruFlashMaxMB` | `number` | `10` | MinerU Flash 模式最大文件大小（MB）。无 Token 时走 Flash。 |
| `mineruFlashMaxPages` | `number` | `20` | MinerU Flash 模式最大页数。 |
| `mineruPrecisionMaxMB` | `number` | `200` | MinerU Precision 模式最大文件大小（MB）。有 Token 时走 Precision。 |
| `mineruPrecisionMaxPages` | `number` | `200` | MinerU Precision 模式最大页数。 |

### PaddleOCR 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `paddleTokens` | `string` | `""` | PaddleOCR Token，多个用分号分隔。获取地址：https://aistudio.baidu.com/account/accessToken |
| `paddleUseDocOrientationClassify` | `boolean` | `false` | 文档方向分类。 |
| `paddleUseDocUnwarping` | `boolean` | `true` | 文档去扭曲。 |
| `paddleUseChartRecognition` | `boolean` | `true` | 图表识别。 |
| `paddleUseSealRecognition` | `boolean` | `false` | 印章识别。 |
| `paddleUseTableRecognition` | `boolean` | `true` | 表格识别。 |
| `paddleUseFormulaRecognition` | `boolean` | `true` | 公式识别。 |

### PDF 降级链 & 切割

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `pdfBackendChain` | `string[]` | `["local"]` | PDF 后端降级链，默认只使用本地后端；用户显式配置云端后按顺序尝试，失败自动降级到下一档。 |
| `autoSplitLargePDF` | `boolean` | `true` | 自动切割超限 PDF（在插件 Python 进程内按 `splitChunkPages` 生成内存 PDF bytes，直接上传云端，不创建 `*_chunks` 文件夹）。 |
| `splitChunkPages` | `number` | `180` | 内存分块时每块页数（小于 MinerU 200 页限制）。 |

大 PDF 的切割只用于云端上传，chunk 会在 Python 进程内以 PDF bytes 存在，不会在源文件目录创建 `*_chunks` 文件夹或 chunk PDF。所有 chunk 的识别结果会按 `chunkIndex` 在插件内部按原 PDF 顺序合并，再统一保存为一个 Markdown/JSON 文件；媒体也会直接写入原 PDF 对应的唯一 `{原文件名}_media/` 目录，并使用 chunk 前缀避免重名。插件不会先生成 chunk PDF 再上传，也不会先生成 chunk Markdown/JSON 再做文件级后处理。

#### 本地档（PyMuPDF）的限制

`local` 是 PDF 降级链的最末档 — 基于 PyMuPDF 直接读 PDF 内嵌文本和图片。它不调用云端 API，但有以下能力边界：

- **不做 OCR**：扫描版（无文本层）只能拿到空白，需走 PaddleOCR / MinerU
- **不做公式识别 / 表格识别 / 分栏重排**
- **Founder 方正 PDF 的 ToUnicode CMap 可能缺失**：这类 PDF（很多国标 GB/T 文件）在 PyMuPDF 提取后会出现「犐犆犛」、「犌犅」之类乱码字符（实际是 ASCII 'I''C''S''G''B' 等被错误 fallback 到 CJK 扩展区）。这是 PDF 文件本身的缺陷，**本地档无法修复**

本地档会在 `warnings` 里检测 Founder 方正特征乱码（Unicode U+7280–U+72FF）并给出明确提示，建议改用云端 OCR 后端重新提取。看到此警告请改传 `backend="mineru"` 或 `backend="paddleocr"`。

#### 本地档的图片按位置插入

本地档会把每页内嵌图片按 `page.get_image_info()` 给出的 y 坐标，插入到对应文字 block 之前 / 之后，输出 markdown 时按视觉顺序拼接：

- 同 y 行的多张图按 x0 升序排（左到右），容忍 ±5px 浮点误差
- 同一 xref 在一页内只引用一次
- inline image（xref=0）跳过：PyMuPDF 不暴露原始 bytes，极少出现
- "纯资源引用"(在 `get_images` 但 `get_image_info` 没显示)不抽

例：GB+4674-2009.pdf 的第 7 页有 7 张图(6 张并排示意图 + 1 张页脚图标)，markdown 输出会按视觉位置穿插在对应段落之间。

### 图片分割

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `splitImageThreshold` | `number` | `1.2` | 高度/宽度超过此值才启用分割。 |
| `splitImageTolerance` | `number` | `15` | 分割色差容忍度（欧氏距离）。 |
| `splitImageBlankRatio` | `number` | `0.98` | 一行中多少比例的像素相近才算空白行。 |
| `splitImageMinBlank` | `number` | `5` | 连续多少行空白才作为切割点。 |

### 并发 & 重试

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `maxConcurrent` | `number` | `4` | 云端 API 后端并发数（MinerU / PaddleOCR）。 |
| `maxConcurrentLocal` | `number` | `8` | 本地后端并发数（DOCX / PPTX / HTML 等）。 |
| `maxRetries` | `number` | `3` | API 临时错误最大重试次数（429 / 5xx / 网络抖动）。 |
| `retryBaseDelayMs` | `number` | `1000` | 重试基础退避毫秒（5xx/network 按 `base × 2^attempt`；429 独立用 8s base）。 |
| `keyRetryOnFailure` | `boolean` | `true` | Key 失败时自动重试下一个。 |
| `notifyKeyFailure` | `boolean` | `true` | Key 失效时通知用户。 |

### HTML 提取

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `htmlExtractMetadata` | `boolean` | `true` | 提取元数据（title、author、description 等）。 |
| `htmlExtractLinks` | `boolean` | `true` | 提取所有链接列表。 |
| `htmlExtractImages` | `boolean` | `true` | 提取并下载所有图片。 |
| `htmlExtractCodeBlocks` | `boolean` | `true` | 提取代码块并标注语言。 |
| `htmlHeadingStyle` | `"ATX" \| "SETEXT"` | `"ATX"` | Markdown 标题风格。 |
| `xlsxMaxRows` | `number` | `100` | XLSX 最大提取行数，超过时在 warnings 中提示截断。 |
| `xlsxMaxCols` | `number` | `50` | XLSX 最大提取列数，超过时在 warnings 中提示截断。 |
| `maxRemoteImagesPerHtml` | `number` | `100` | HTML 页面最多下载多少远程图片。 |

### 批量 & 日志

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `summaryThreshold` | `number`（≥2） | `3` | 文件数阈值：≥ 此值时返回结果去掉 markdown/mediaMap（只保留 metadata + mdPath + imagesDir，省 context）。 |
| `logLevel` | `"DEBUG" \| "INFO" \| "WARNING" \| "ERROR"` | `"INFO"` | 日志级别。 |
| `logFile` | `string` | `""` | 日志文件路径（留空则只输出到控制台 stderr）。 |

---

## 输出结构

### 单文件 / 少量文件（< `summaryThreshold`）

返回完整 markdown + metadata，Agent 可直接读取内容：

```json
{
  "name": "report.pdf",
  "markdown": "# report.pdf\n\n提取的完整内容...",
  "metadata": {
    "mediaPaths": ["/path/to/report_media/image_001.png"],
    "format": "pdf",
    "reader": "mineru",
    "backendChain": ["local"],
    "warnings": [],
    "usedBackendInChain": true
  }
}
```

### 批量（≥ `summaryThreshold`）

只返回摘要 + 文件列表，不返回 markdown（省 context）：

```json
{
  "markdown": "处理完成：12/16 个文件成功\n\n✅ a.pdf\n✅ b.docx\n❌ c.pdf — 所有后端都失败",
  "metadata": { "batch": true, "count": 16, "success": 12 },
  "files": [
    { "name": "a.pdf", "metadata": { "mdPath": "/out/a.pdf.md", "imagesDir": "/out/a_media" } }
  ]
}
```

### 保存到本地时的文件结构

大 PDF 的分块只在插件内部以内存 PDF bytes 完成，源文件目录不会出现 `*_chunks` 文件夹或 chunk PDF。

```
outputDir/
├── 文件名.pdf.md          ← 完整合并后的 Markdown
├── 文件名.pdf.json        ← 完整合并后的 JSON（仅 saveJson=true 时）
└── 文件名_media/          ← 唯一媒体目录
    ├── image_001.png
    ├── image_002.jpg
    ├── video_001.mp4
    └── audio_001.flac
```

媒体命名规则：普通文档按类型分别连续编号，`image_NNN.ext` / `video_NNN.ext` / `audio_NNN.ext`；分块 PDF 会增加 `chunk_NNN_` 前缀，例如 `chunk_001_image_001.jpg`，避免并发分块之间覆盖。

### Markdown 中的媒体引用格式

- 图片：`![alt](文件名_media/image_001.png)`
- 视频：`<video controls src="文件名_media/video_001.mp4" title="alt"></video>`
- 音频：`<audio controls src="文件名_media/audio_001.flac" title="alt"></audio>`

---

## 使用示例

### 基础提取

```python
# 聊天中读取文档
doc_intake(source=["report.pdf"])

# 用户指定保存位置
doc_intake(source=["report.pdf"], outputDir="D:/Output")

# 只提取前 5 页
doc_intake(source=["report.pdf"], pageRange="1-5")

# 只要文本，不抽媒体
doc_intake(source=["document.docx"], includeMedia=false)

# 强制用本地后端（不走云端）
doc_intake(source=["paper.pdf"], backend="local")
```

### 批量处理

```python
# 提取整个文件夹
doc_intake(source=["D:\\各种文件"], outputDir="D:\\输出")
# → 返回：16 个文件处理完成，12 成功 4 失败 + 文件列表

# 手动指定多个文件
doc_intake(source=["a.docx", "b.pptx", "c.xlsx"], outputDir="D:\\输出")
```

### Token 验证

```python
# 验证所有 Token
doc_intake_validate()
# → 返回：每个 Token 的有效性

# 只测 MinerU
doc_intake_validate(backend="mineru")

# 只测 PaddleOCR
doc_intake_validate(backend="paddleocr")
```

---

## 其他插件/Skill 如何调用 doc-intake

如果你在开发自己的插件或 Skill，需要调用 `doc_intake` 提取文档内容，直接使用上面的参数即可。在你的 SKILL.md 中写明调用方式，Agent 会自动路由到这个插件。

**最小调用：**

```python
doc_intake(source=["文件路径"])
```

**典型调用（带保存）：**

```python
doc_intake(source=["文件路径"], outputDir="保存目录")
```

**PDF 指定页码范围：**

```python
doc_intake(source=["report.pdf"], pageRange="1-10,15")
```

**强制降级到本地（无 API 时）：**

```python
doc_intake(source=["document.pdf"], backend="local")
```

---


## 错误处理

| 错误码 | 含义 | 处理方式 |
|--------|------|----------|
| `PYTHON_PATH_NOT_CONFIGURED` | 未配置 `pythonPath` | 去插件设置面板填写 |
| `INVALID_SOURCE` | 文件路径无效 | 检查路径是否存在、格式是否支持 |
| 链式降级全失败 | 所有后端都返回空/错误 | 返回的 markdown 包含错误提示，`warnings` 列出每档失败原因 |
| `SPAWN_FAILED` | Python 进程启动失败 | 检查 `pythonPath` 是否正确、Python 环境是否完整 |
| `PYTHON_ERROR` | Python 进程非零退出 | 查看 stderr 输出定位具体问题 |

---

## License

MIT
