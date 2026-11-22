<p align="center">
  <img src="https://img.shields.io/badge/version-2.5.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/python-3.11+-yellow" alt="python">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="platform">
</p>

<h1 align="center">Doc Intake</h1>

<p align="center">
  Hana v2 App（App 形态） · 文档与图片内容提取工具<br>
  PDF / Word / PPT / Excel / HTML / 图片 → 结构化 Markdown
</p>

---
在使用本插件前，推荐先仔细阅读本Readme，或将Readme交予Agent，让其生成说明。推荐在已大致了解本插件的情况下进行使用
---

## v2（App 形态）与 v1 的差异

> 只讲**用户需要知道**的部分。工具名、参数、返回结构与 v1 **完全一致**，下面这些用法说明照用。

**怎么装（v2 与 v1 不同）**

1. 把 `doc-intake` 整个目录放到 `<HANA_HOME>/apps/` 下（v1 在 `<HANA_HOME>/plugins/`）。
2. **先停用 v1 插件 `doc-intake`**。两个版本注册的工具名相同，同时启用会冲突。
3. 重启 Hana，在市集「已安装」→ App 类目的「待批准」区块批准一次。首次批准会确认两项能力：
   `app/process.spawn`（调用外部 Python）和 `app/tools.expose-to-model`（工具进入模型循环）。
   批准后可在设置窗「安全」→「应用能力」里单独开关。
4. **设置要重填**。v2 的设置与 v1 分开存储（v1 在 `plugin-data/doc-intake/config.json`，
   v2 在 `user/preferences.json` 的 `settings_contributions["v2-doc-intake"]`）。
   至少填 `pythonPath`，Token、降级链、保存路径按需补。
5. 设置位置不变：设置左侧「Doc Intake」。

**两处配置项写法变了**

| 配置项 | v1 | v2 |
|---|---|---|
| `pdfBackendChain` | 数组，如 `["mineru","local"]` | **字符串**，用 `>` 或 `;` 分隔，如 `mineru>paddleocr>local`；留空 = 自动 |
| `savePath` | 默认写死 `D:\Agent` | 留空 = 系统文档目录下的 `doc-intake`（按各自机器算，不写死盘符） |

**和 v1 一样的地方**：文件夹路径照旧自动展开、媒体提取、公式转 LaTeX、降级链、保存策略、
`doc_intake` 工具的名字与参数全部不变。
（v2 的 App 进程跑在 Node 权限模型下，读文件的工作已下放到被 spawn 的 Python 子进程完成，功能不受影响。）

**和 v1 不一样的地方**：v1 的 `doc_intake_validate` 工具已移除。Token 有效性检测改成设置页里每个
Token 字段旁的「检测」按钮，由插件自己发请求探测（纯 Node，不需要 Python 环境）。理由：验证凭证是
配置环节的一次性动作，不该占一个模型工具位。

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

旧版 Word `.doc`、Excel `.xls` 和 PowerPoint `.ppt` 会先通过独立的旧格式转换层转为 `.docx`、`.xlsx`、`.pptx`，再复用现有 OOXML 提取器。Windows 默认使用 Microsoft Office COM；LibreOffice 只能通过显式配置作为替代 provider。转换结果会在 metadata 中保留原始格式、转换后格式、provider、状态和兼容性警告。

**核心设计原则：**

- **敏感配置隔离**：MinerU / PaddleOCR 凭证通过一次性 stdin 管道传给 Python，不再注入 `DOC_INTAKE_SETTINGS` 环境变量；旧环境变量仅保留给手动兼容调用
- **敏感错误脱敏**：第三方异常、降级警告和日志会遮蔽已知完整 Token，避免凭证随错误文本回显

- **后端降级链**：PDF 默认只走本地 PyMuPDF，避免无 Token 时隐式上传原件；用户可在设置中显式配置 `MinerU → PaddleOCR → local` 等链，失败自动降级到下一档
- **多 Token 轮询**：每个云端 API 支持配置多个 Token，单个失效自动切换下一个，不中断批处理
- **双池并发**：云端 API 和本地解析分别走独立的并发池，互不抢资源
- **本地 MinerU 自管**：填上 `mineru-kit.exe` 路径后，插件在真要用到本地档时把它拉起来，空闲一段时间再自己关掉；不提供 MinerU 安装服务，只调用你装好的那个
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

1. **Python 环境**：在插件设置页的「基础项」填写 `Python 可执行文件路径`（conda 环境填 `<conda 目录>/envs/<环境名>/python.exe`）
2. **Python 依赖**：

```bash
pip install -r python/requirements.txt
```

依赖清单（以 `python/requirements.txt` 为准，与设置页「环境依赖管理」卡片一致）：

必装：

- `Pillow` — 图片处理：长图分割、EMF→PNG 转换、图片读写
- `PyMuPDF` — PDF 本地兜底提取，以及大 PDF 按页分块
- `requests` — 云端 API 调用、远程图片下载、HTML 抓取

可选：

- `mineru-open-sdk` — MinerU 云端 PDF 提取；缺失则降级链跳过 MinerU 这一档
- `html-to-markdown` — HTML → Markdown 转换；缺失则 HTML 解析不可用
- `pywin32` — 旧版 .doc/.xls/.ppt 经 Office COM 转换（仅 Windows）
- `xlrd` — 旧版 .xls（BIFF）数值读取

> v2 是 App 形态，Python 依赖同样装在你自己的环境里，不动系统 Python。

3. **云端 Token**（可选）：
   - MinerU Token：https://mineru.net/apiManage/token
   - PaddleOCR Token：https://aistudio.baidu.com/account/accessToken

没有 Token 也能用：PDF 默认走本地 PyMuPDF，不会隐式调用云端；如需 MinerU/PaddleOCR，请在设置中显式配置后端链并提供对应凭证。图片 OCR 仍需要 PaddleOCR Token。

如果需要使用MinerU，并且常年挂着机场/梯子，建议将以下链接纳入**直连**规则：
- 'DOMAIN,aistudio.baidu.com,DIRECT'
- 'DOMAIN,www.paddleocr.ai,DIRECT'
- 'DOMAIN,cdn-mineru.openxlab.org.cn,DIRECT'
- 'DOMAIN,mineru.net,DIRECT'
- 'DOMAIN,mineru.org.cn,DIRECT'
- 'DOMAIN,sso.openxlab.org.cn,DIRECT'


### 设置页

设置页分三段，改动即时生效、无需重启：

- **基础项**（默认展开）：`pythonPath`、默认解析后端、PDF 降级链、MinerU / OXR / PaddleOCR 三个 Token、默认语言、是否提取媒体、自动保存与保存路径。必填项和常用项都在这一层。
- **高级设置**（默认收起，点标题展开）：MinerU / PaddleOCR 细节、PDF 切割、图片分割、并发与重试、旧版 Office 转换、HTML 提取、Excel 行列上限、Agent 返回容量、日志。默认值都调过，不确定就别改。
- **环境依赖管理**：用你填的 `pythonPath` 逐项探测依赖装没装，列出「库名 / 功能 / 必装或可选 / 当前状态」。缺依赖时可以直接复制 `pip install` 命令，也可以点「一键安装缺失的必装依赖」就地安装（安装会改动你那个 Python 环境，页面内会先确认）。

> 检测是只读的：探测脚本只做导入判断与版本查询，不安装任何东西；只有你点了安装按钮，插件才会调用 `pip install`，且只允许安装依赖清单里登记过的包。

### 后续推荐操作

#### 1. 配置云端 Token

插件支持用户显式配置 `MinerU → PaddleOCR → 本地 PyMuPDF` 等 PDF 降级链，图片 OCR 只有 PaddleOCR 一档。要让扫描件和图片具备云端识别能力，需要配置对应 Token：

- **MinerU Token**：[获取地址](https://mineru.net/apiManage/token) → 填入插件设置面板的 `mineruCredentials`（多个用分号分隔）
- **PaddleOCR Token**：[获取地址](https://aistudio.baidu.com/account/accessToken) → 填入插件设置面板的 `paddleTokens`（多个用分号分隔）

> ⚠️ MinerU Token 有效期 **90 天**，到期后提取会失败并自动降级到 PaddleOCR / 本地档。建议日历提醒自己续期。

没有 Token 也能用：PDF 默认走本地 PyMuPDF，不会隐式调用 MinerU Flash；如需云端识别，请显式配置云端后端并提供对应 Token。图片 OCR 仍需要 PaddleOCR Token。

#### 2. 验证 Token 是否生效

设置页里 MinerU、OXR、PaddleOCR 三个 Token 字段下面各有一个「检测」按钮。填好直接点，不用先保存；
结果逐行列出（第几个 · 掩码后的 Token · 结论），哪一把失效一眼能看到。

检测只回答「这把凭证能不能过鉴权」，不发真实解析任务，不占解析额度。

#### 3. 当确认doc-intake可用及符合您胃口后，可清理自带的 `office-documents` skill

Hana 自带 `office-documents` skill，它的设计思路是「一个 skill 干所有事」——读、写、转换、格式化全包。结果是每个场景都只能做到「能用」级别：扫描件是空白、公式丢失、媒体不提取、批量无并发。

`doc-intake` 和 `office-cli` 是反过来的思路：**把读和写拆成两个独立工具，各自做到专精**。

| | `office-documents` | `doc-intake` + `office-cli` |
|---|---|---|
| 读文档 | 能读，但不支持 OCR/公式/媒体 | `doc-intake`：扫描件 OCR、公式转 LaTeX、媒体提取全覆盖 |
| 写文档 | 能写，但格式控制粗糙 | `office-cli`：格式精确、排版可控 |
| 格式转换 | 基础转换 | `office-cli`：支持更多格式和高级选项 |
| 并发 | 无 | `doc-intake`：双池并发 + 多 Token 轮询 |

**操作**：在 Hana 的 Skills 管理界面中卸载 `office-documents`。卸载后 Agent 不会再优先调用它，文档请求会走 `doc-intake`。

#### 4. 对HanaAgent的推荐设置：

1. 推荐关闭HanaAgent自带的office-read-document工具（如果您已开启）
	具体位置：设置-助手（然后一直往下划，找到“工具”）-关闭Office
	此工具（Hana自带的office读取工具）会让agent优先调用内置工具读取，发现无法读取则会私自写py脚本，不调用doc-intake插件
2. 推荐将助手切换为“无”，因为“无”会更听话一点。不管是平时让他干活，还是让他遵循本插件的skill表现都会更好一些

#### 5. 推荐开启保存到本地

Hana平台对插件返回信息有字数限制，大于32k将被略去中间部分。所以推荐选择一个保存路径，保存到本地让agent自行读取。

注：2.0版本及以后插件已用特殊手段绕过了此限制，详情见 [`builders/PARAMETERS.md`](builders/PARAMETERS.md) 的「Agent 返回容量」一节（可通过更改插件中的“返回文本块数量上限”与“每个返回文本块的最大大小”提高返回内容上限。“返回文本块数量上限=8”+“每个返回文本块的最大大小=28k”已能满足绝大多数需求）。但依旧推荐保存到本地，因为这样可以让Hana看产出的媒体，获得更好的效果。

---


## 架构

```
┌─────────────────────────────────────────────────┐
│                  JS 层 (Node.js)                 │
│                                                 │
│  doc_intake.js ─→ service.js ─→ Python spawn    │
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
├── manifest.json                 # v2 清单：图标、能力、设置 schema 与自定义设置页、版本
├── index.js                      # defineApp 入口：读设置 + 注册工具
├── README.md
├── builders/                     # 面向开发者：对外服务（SERVICE-API）与参数/设置清单（PARAMETERS），随包发布
├── assets/
│   └── icon.png                  # 图标（512×512）
│
├── routes/settings.js            # 设置页后端路由：配置读写 + 依赖检测 + 一键安装 + Token 检测
├── ui/                           # 自定义设置页（settings.html + assets：样式、脚本、内置 SDK）
│
├── tools/                        # Hana 工具入口（JS）
│   └── doc_intake.js             # 主工具：文档/图片提取
│
├── lib/                          # JS 公共模块（调度、设置、输出格式、日志、并发）
├── sdk/                          # 随包分发的 @hana/app-sdk 闭包
├── skills/doc-intake/SKILL.md    # Agent 技能描述（触发条件、参数、使用场景）
├── doc/                          # 开发文档（MTEF 支持说明、接手与迭代、图标设计）
├── test/                         # 自测与体检脚本（自包含、零绝对路径）
│
├── python/                       # Python 后端
│   ├── main.py                   # 入口：参数解析、后端选择、链式降级、结果格式化
│   ├── mineru_client.py          # MinerU 云端 API 客户端（多 Token KeyPool）
│   ├── paddle_client.py          # PaddleOCR HTTP API 客户端（多 Token KeyPool）
│   ├── oxr_client.py             # SoMark（OXR）HTTP API 客户端（异步任务 + KeyPool）
│   ├── key_pool.py               # 多 credential 轮询 + 失败跳过
│   ├── api_retry.py              # HTTP 重试：指数退避、429/5xx 自动重试
│   ├── image_splitter.py         # 长图智能分割（空白行检测 + 色差容忍）
│   ├── pdf_splitter.py           # 大 PDF 内存分块（不落 chunk 文件）
│   ├── split_cli.py              # 旧版手动 PDF 切割 CLI（主流程不调用）
│   ├── list_sources.py           # 路径展开（文件夹 → 文件列表、类型过滤）
│   ├── utils.py                  # 图片归一化（URL/本地/对象 → {stem}_media/）
│   ├── probe_deps.py             # 依赖探测（设置页「环境依赖管理」用）
│   ├── logger.py                 # Python 端日志（stderr）
│   ├── mathtype_converter.py     # MathType OLE → LaTeX
│   ├── requirements.txt          # Python 依赖
│   │
│   ├── extractors/               # 本地提取器
│   │   ├── base.py               # 基类 BaseExtractor + ExtractionResult
│   │   ├── _utils.py             # 公共件：媒体分类/命名/渲染、XML、表格、公式文本规范化
│   │   ├── docx_extractor.py     # DOCX（文本/表格/公式/图/视/音）
│   │   ├── pptx_extractor.py     # PPTX（同上 + 旧版转换）
│   │   ├── xlsx_extractor.py     # XLSX/XLSM/旧版 XLS（表格/图片锚定）
│   │   ├── legacy_converter.py   # DOC/XLS/PPT → OOXML 临时转换层
│   │   ├── html_extractor.py     # HTML（元数据/链接/代码块/远程媒体）
│   │   ├── pdf_extractor.py      # PDF 本地兜底（PyMuPDF）
│   │   ├── emf_converter.py      # EMF/WMF → PNG
│   │   ├── omml_converter.py     # OMML（Office 公式）→ LaTeX
│   │   └── mathtype_filter.py    # MathType 预览图过滤
│   │
│   └── mathtype/                 # MTEF 解析与渲染（v3 与 v5 两条独立路线）
│       ├── chars.py              # 字符映射
│       ├── mtef_v3.py / mtef_v3_latex.py
│       ├── mtef_v5.py / mtef_v5_latex.py
│       ├── ole_util/             # OLE 复合文件读取
│       └── samples/              # 自测样本

```

---

## 支持的文件格式

| 格式 | 扩展名 | 后端 | 说明 |
|------|--------|------|------|
| PDF | `.pdf` | MinerU → OXR → PaddleOCR → MinerU 本地 → PaddleOCR 本地 → Local | 链式降级，扫描件走 OCR；缺凭证或缺地址的档位自动剔除 |
| Word | `.docx` | Local | 文本/表格/公式/图片/视频/音频 |
| Word（旧版） | `.doc` | Local（Office COM → `.docx`） | 转换后复用 DOCX 提取器；复杂内容可能有兼容性差异 |
| PowerPoint | `.pptx` | Local | 文本/表格/公式/图片/视频/音频 |
| PowerPoint (旧版) | `.ppt` | Local（Office COM → `.pptx`） | 需要 pywin32，自动转 pptx 后处理 |
| Excel | `.xlsx` / `.xlsm` | Local | 表格/图片锚定 |
| Excel（旧版） | `.xls` | Local（Office COM → `.xlsx`） | 转换后复用 XLSX 提取器；宏不保留，复杂对象需验证 |
| HTML | `.html` / `.htm` | Local | 元数据/链接/代码块/远程媒体 |
| 图片 | `.jpg` `.jpeg` `.png` `.bmp` `.tiff` `.tif` `.webp` `.gif` | OXR → PaddleOCR → PaddleOCR 本地 | 自动长图分割 |
| 电子书（EPUB） | `.epub` | Local | 章节成标题层级、目录取 nav 或 ncx、图片按原始字节落盘；字体混淆照常解，内容加密直接报 |
| 电子书（FB2） | `.fb2` / `.fbz` | Local | section 嵌套深度成标题层级，图片从 `<binary>` 的 base64 解出 |
| 漫画 | `.cbz` | Local | 按页名自然序出图（`page2` 在 `page10` 前），不主动 OCR |
| Kindle | `.mobi` `.azw` `.azw3` `.prc` | Local + 可选依赖 `mobi` | 先看 PalmDB 头的加密类型，有 DRM 直接拒；未装依赖时给出安装提示 |
| 纯文本 | `.txt` | Local | 判定编码（BOM / UTF-8 / GBK / Big5 / UTF-16 / 西文）、正文逐字不改；判不准时给正文并在 warnings 里说清 |

电子书一律本地解析，不进降级链——云端那几档做不了。CBZ 默认只出图不 OCR；MOBI/AZW 要的可选依赖是 GPL-3.0，插件本身不打包它，由用户在自己的 Python 环境里装。

---

## 参数与设置清单

工具入参、设置项的完整清单在 [`builders/PARAMETERS.md`](builders/PARAMETERS.md)；别的 App 通过服务总线怎么调用、四个方法各传什么，在 [`builders/SERVICE-API.md`](builders/SERVICE-API.md)。README 里不再留第二份参数表，免得两处各自漂移。

下面「其他插件/Skill 如何调用 doc-intake」保留最常用的几行调用写法，够用就不必翻文档。

---

## 输出结构

### 返回策略

`summaryOnly=true` 时会优先返回状态摘要，不受正文大小限制：

- 每个文件返回 `status: "success"` 或 `status: "failed"`。
- 失败项返回 `error`，成功但存在 warnings 的文件仍算成功。
- 如果指定了 `outputDir` 或启用了自动保存，状态项保留 `mdPath`、`mediaDir` 等路径。
- `details.data` 保留完整结构化结果；`content` 末尾附带独立的机器可读 `doc_intake_paths` 路径块，供 Agent 直接读取。
- 保存到磁盘的 JSON 结构不受 Agent 路径返回字段影响；JSON 中的 `metadata.mediaPaths` 使用相对路径，Agent 路径块中的 `mediaPaths` 使用绝对路径。
- 媒体数量不超过 `mediaPathReturnLimit` 时返回 `mediaDir` 和每个媒体的绝对 `mediaPaths`；超过上限时只返回 `mediaDir` 和 `mediaCount`。如果上游媒体路径缺少可用基准，则保留媒体总数量并返回警告，不静默丢弃。
- 只有实际生成 JSON 文件时才返回 `jsonPath`。
- 不返回 Markdown 正文，适合批量处理时只确认文件是否成功。

未设置 `summaryOnly` 时，返回策略按内容大小和文本块容量判断，不按文件数量判断：

- 结果不超过 `inlineBlockBytes × inlineBlockCount`：返回全部 Markdown，必要时拆成多个 text block。
- 结果超限且已保存到本地：只返回处理摘要和 `mdPath` / `mediaDir` 等路径信息。
- 结果超限且未保存到本地：在多个 text block 中保留开头和结尾，中间插入省略提示，并明确提示内容不完整。

### 未超限时

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

### 超限且已保存到本地

只返回摘要 + 文件列表，不返回正文；完整内容从 `mdPath` 读取：

```json
{
  "markdown": "处理完成：12/16 个文件成功\n\n✅ a.pdf\n✅ b.docx\n❌ c.pdf — 所有后端都失败",
  "metadata": { "batch": true, "count": 16, "success": 12 },
  "files": [
    { "name": "a.pdf", "metadata": { "mdPath": "D:\\out\\a.pdf.md", "mediaDir": "D:\\out\\a_media", "mediaCount": 86 } }
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

媒体命名规则：所有后端统一按类型分别连续编号，`image_NNN.ext` / `video_NNN.ext` / `audio_NNN.ext`；云端 MinerU/PaddleOCR 返回的超长原始媒体名会被插件丢弃。分块 PDF 会增加 `chunk_NNN_` 前缀，例如 `chunk_001_image_001.jpg`，避免并发分块之间覆盖。云端媒体重命名后，运行时 Markdown、Agent路径和保存的 JSON会同步使用新名称。

### Markdown 中的媒体引用格式

- 图片：`![alt](文件名_media/image_001.png)`
- 视频：`<video controls src="文件名_media/video_001.mp4" title="alt"></video>`
- 音频：`<audio controls src="文件名_media/audio_001.flac" title="alt"></audio>`

### 二维码与条码解析

设置项「解析媒体中的二维码与条码」（`barcodeScan`）默认开启。开启后，落盘时会把媒体里的码内容注到引用该媒体的那一行下面，正文结构不动：

```markdown
![image_001](report_media/image_001.png)
> 二维码：https://example.com/a1b2
```

支持的码型：QR / Micro QR / rMQR / Data Matrix，以及 Code 128、Code 39、Code 93、EAN-13/8、UPC-A/E、ITF、Codabar、DataBar。一维码统一写成「条码 Code 128：内容」。

多个不同内容用有序列表，同一内容在文档里第二次出现只写「同上」；内容含换行、反引号或超过 120 字符时改写成 ` ```text ` 围栏块，避免外部内容破坏 Markdown 结构。解不出来的码写作 `> 二维码：无法解码（ChecksumError）`——这时只有「存在但读不出」的信号，不会把解错的乱码当内容。

依赖 `zxing-cpp`（需要 Python 3.10+ 才有预编译 wheel），在设置页「环境依赖管理」里安装。没装时整段跳过，只加一条 warning「未安装 zxing-cpp，二维码解析已跳过」，提取本身照常完成。

免落盘短路：不传 `outputDir`、没开 `autoSave`、不是 `summaryOnly` 时，如果文件本身只有码没有正文（正文 ≤20 字符、页数 ≤3 且媒体 ≤3、至少一个可读码且占幅 ≥30%），会跳过整个后端链直接返回码内容，`metadata.barcodeOnlyDocument` 为 `true`，本地不落任何文件。30% 这个界限取自实测分布：文档页里嵌的码占 0.002～0.081，扫描页中间放一个大码占 0.139～0.337，码几乎占满画面 0.62～0.96。

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

不在工具里做了。设置页 → 应用 → Doc Intake，MinerU / OXR / PaddleOCR 三个 Token 字段下面各有一个
「检测」按钮，点一下逐把出结果。

---

## 其他插件/Skill 如何调用 doc-intake

如果你在开发自己的插件或 Skill，需要调用 `doc_intake` 提取文档内容，直接按 [`builders/PARAMETERS.md`](builders/PARAMETERS.md) 里的入参表调用即可；需要走服务总线（`app:doc-intake/*` 四个方法）则看 [`builders/SERVICE-API.md`](builders/SERVICE-API.md)。在你的 SKILL.md 中写明调用方式，Agent 会自动路由到这个插件。

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
