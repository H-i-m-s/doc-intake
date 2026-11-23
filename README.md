<p align="center">
  <img src="https://img.shields.io/badge/version-3.3.0-blue" alt="version">
  <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license">
  <img src="https://img.shields.io/badge/hana-%E2%89%A5%200.978.0-lightgrey" alt="hana">
  <img src="https://img.shields.io/badge/python-3.11+-yellow" alt="python">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="platform">
</p>

<h1 align="center">Doc Intake</h1>

<p align="center">
  Hana v2 App · 文档与图片内容提取<br>
  PDF / Office / HTML / 图片 / 电子书 / 纯文本 → 结构化 Markdown
</p>

---

## 概述

doc-intake 是 Hana 的文档提取 App：把 PDF、Office 文档、网页、图片、电子书与纯文本转换为结构化 Markdown，把文档内的图片、视频、音频按类型编号落盘，并可按需同时输出一份结构化 JSON。

共支持 27 种扩展名。扫描件走 OCR，公式转 LaTeX，表格保留结构，图片与文档中的二维码、条码一并解出，纯文本自动判定编码。

## 为什么需要它

多数转换工具只做「把文件读成文字」；遇到扫描件、公式、媒体、编码时，内容会有所缺失。下表为 Hana 自带的文档读取能力（`office_read-document` 工具与通用 office 类 skill）与本 App 的对照：

| 能力 | Hana 内置文档读取 | doc-intake |
|---|:---:|:---:|
| Word / Excel / PPT 纯文本 | ✅ | ✅ |
| 数字版 PDF 文本 | ✅ | ✅ |
| 扫描件与图片型 PDF | ❌ | ✅ 云端或本地 OCR |
| 图片文字识别 | ❌ | ✅ |
| 公式转 LaTeX | ❌ | ✅ OMML、MTEF v3/v5 |
| 表格结构识别 | ❌ | ✅ |
| 媒体提取与编号 | ❌ | ✅ |
| EMF/WMF 矢量图转 PNG | ❌ | ✅ |
| 长图分割、大 PDF 分块 | ❌ | ✅ |
| 多凭证轮询与降级链 | ❌ | ✅ |
| 批量并发 | ❌ | ✅ |

与其他文档转换工具的差异在边界而不在速度。下表按各自公开文档整理。公式一项差异最大：除本项目外，其余三家对 MathType 的 `Equation Native` 对象均无入口。

| | doc-intake | MarkItDown | anymd | anydoc |
|---|---|---|---|---|
| 形态 | Hana App：工具、卡片、服务总线 | Python 库 / CLI | Rust MCP 服务 / CLI | Rust 库，含 Python、Node、WASM 绑定 |
| 扫描件 OCR | ✅ 云端三档与本地 MinerU | ❌ 需 OCR 插件与视觉模型 | ✅ 本地 tesseract 或视觉模型，需自行安装 | ❌ 不做本地 OCR，扫描页报 `NeedsOcr`，可用其云服务 |
| 公式 | ✅ OMML、MTEF v3/v5，失败回退预览图 | ❌ 不转换 | ✅ `.docx` 内公式转 LaTeX | ✅ OMML / MathML / RTF 公式转 LaTeX |
| MathType（`Equation Native`） | ✅ 自行实现 | ❌ 无入口 | ❌ 无入口 | ❌ 无入口 |
| EPUB | ✅ | ✅ | ✅ | ✅ |
| FB2 / CBZ / Kindle | ✅ | ❌ | ❌ | ❌ |
| 纯文本编码判定 | ✅ GBK / Big5 / UTF-16 等，判不准时给出依据 | ❌ 按文本读取 | ❌ 原样返回 | ❌ 不涉及 |
| 媒体落盘 | ✅ 按类型编号写入 `{文件名}_media/` | ❌ 图片以描述代替 | ✅ 图片存缓存并标注引用 | ❌ 留在文档模型，正文为占位 |
| 二维码与条码 | ✅ 结果注在引用该媒体的行下 | ❌ | ❌ | ❌ |
| 旧版 Office（`.doc` `.xls` `.ppt`） | ✅ 经 Office COM 或 LibreOffice | ❌ | 仅 `.xls` | ✅ 支持 `.doc` |
| 多后端降级与多凭证 | ✅ | ❌ | ❌ | ❌ |
| 产物 | Markdown、媒体目录、可选 JSON | Markdown | Markdown 与图片 | Markdown 或文档模型 |

## 支持范围

解析在五个后端之间按链降级：MinerU（云端）、SoMark（云端）、PaddleOCR（云端）、本地 MinerU、本地解析。链的组成由用户配置，缺凭证的云端档位在选链时即被剔除，不会以失败的形式出现。默认链会用到 MinerU 的免 Token 档位，文件因此会上传至其服务；需要完全离线时，将链设为本地档位即可。

| 类别 | 扩展名 | 后端 | 说明 |
|---|---|---|---|
| PDF | `.pdf` | MinerU → SoMark → PaddleOCR → 本地 MinerU → 本地 | 链式降级；扫描件依赖 OCR 档位；缺凭证或地址的档位自动剔除 |
| Word | `.docx` `.doc` | 本地 | 文本、表格、公式、图片、视频、音频；`.doc` 经 Office COM 或 LibreOffice 转换后复用 DOCX 提取器 |
| PowerPoint | `.pptx` `.ppt` | 本地 | 文本、表格、公式、图片、视频、音频；`.ppt` 经转换后复用同一提取器 |
| Excel | `.xlsx` `.xlsm` `.xls` | 本地 | 表格与图片锚定；行列上限可配 |
| HTML | `.html` `.htm` | 本地 | 元数据、链接、代码块、远程媒体 |
| 图片 | `.jpg` `.jpeg` `.png` `.bmp` `.tiff` `.tif` `.webp` `.gif` | SoMark → PaddleOCR → MinerU → 本地 MinerU | 长图自动分割；本地解析档不参与图片链，它不产出 OCR 文本 |
| 电子书 | `.epub` `.fb2` `.fbz` | 本地 | 目录取 nav 或 ncx，章节层级由文档结构决定，图片按原始字节落盘 |
| 漫画 | `.cbz` | 本地 | 按页名自然序出图，默认不做 OCR |
| Kindle | `.mobi` `.azw` `.azw3` `.prc` | 本地 | 需可选依赖 `mobi`；文件带 DRM 时明确拒绝，不做解密 |
| 纯文本 | `.txt` | 本地 | 自动判定编码（BOM / UTF-8 / GBK / Big5 / UTF-16 / 西文），正文逐字保真 |

电子书与纯文本始终本地解析，不进入降级链。云端档位只处理 PDF 与图片，无法解析这些容器；若显式指定云端后端，插件仍按本地解析，并在 `warnings` 中记录该参数被忽略。

面向 PDF 的后端有各自的上限，MinerU 的免 Token 档（Flash）为单文件 10 MB、20 页，带 Token 的档位为 200 MB、200 页。超过分块阈值的 PDF 在插件进程内按 180 页切为内存块上传，结果按原顺序合并，源文件目录不会出现分块副本。

## 公式

Office 文档中的公式分四类：Office 2007 之后的原生公式（OMML）、MathType 的 `Equation.DSMT4/DSMT6/DSMT7`、旧版 Equation Editor 的 `Equation.3`、以及无法解析的对象。前三类分别转换为 LaTeX，其中后两类由本项目的 `python/mathtype/` 处理：自写的 OLE 复合文件读取、MTEF 记录树解析与 LaTeX 渲染，约 4300 行，不依赖 pywin32 或 olefile，随包分发。在真实文档语料上，MTEF v5 路线的 165 道公式全部转换成功，其中 153 道来自一篇 29 MB 的学位论文。

第四类没有 LaTeX 可转，回退为其自身的预览图：WMF/EMF 按矢量重绘（Windows 下经 `ctypes` 调用 `gdiplus.dll`，其余平台回退 Pillow），按墨迹裁剪后补白；预览图为空白的对象被拦下并记录警告。本地转换全部失败时，还可启用公式识别降级链，把预览图交给本机小模型识别，该链默认关闭，权重不入包。

## 安装

前置条件：

1. Hana 版本不低于 0.978.0。
2. 在设置页填写 Python 可执行文件路径（`pythonPath`）。建议使用独立环境，不影响系统 Python。
3. 安装 Python 依赖。

```bash
pip install -r python/requirements.txt
```

必装三项：`Pillow`（图片处理与长图分割）、`PyMuPDF`（PDF 本地解析与分块）、`requests`（云端接口、远程图片、网页抓取）。

可选依赖按用途安装，缺失只会使对应功能不可用：

| 依赖 | 用途 | 缺失影响 |
|---|---|---|
| `mineru-open-sdk` | MinerU 云端解析 | 降级链跳过该档 |
| `html-to-markdown` | HTML 转换 | HTML 解析不可用 |
| `zxing-cpp` | 二维码与条码 | 跳过码内容抽取并记录警告 |
| `pywin32` | 旧版 Office 转换（Windows） | 仅影响 `.doc` `.xls` `.ppt` |
| `xlrd` | 旧版 `.xls` 数值读取 | 部分数值格式偏差 |
| `mobi` | Kindle 电子书 | 该格式不可用；GPL-3.0，不随插件分发 |

设置页的「环境依赖管理」会按填写的解释器逐项探测并列出状态，缺项可一键安装，也可复制 `pip` 命令自行执行。探测只做导入与版本查询，安装仅限登记的依赖清单。

云端凭证均在设置页填写，三处 Token 字段旁各有「检测」按钮，用于确认凭证能否通过鉴权，不发起解析任务，不计入额度：

- MinerU：https://mineru.net/apiManage/token
- SoMark：https://somark.cn/workbench
- PaddleOCR：https://aistudio.baidu.com/account/accessToken

不填凭证也可使用：MinerU 的免 Token 档位仍在链上，本地解析不受影响，本地 MinerU 需另行填写启动器路径。

若长期经代理访问，建议将 `mineru.net`、`mineru.org.cn`、`cdn-mineru.openxlab.org.cn`、`www.paddleocr.ai`、`aistudio.baidu.com` 设为直连。

## 配置

设置分三层：基础项、高级设置、环境依赖管理。以下按需要决定的事项组织，完整键表见 `builders/PARAMETERS.md`。

**解析链路。** PDF 与图片各有一条链，留空即取默认值：PDF 为 `mineru > oxr > paddleocr > mineru-local > local`，图片为 `oxr > paddleocr > mineru > mineru-local`。链条目可用 `>`、`;` 或换行分隔，顺序即优先级。四种常见组合：

| 目标 | PDF 链 | 图片链 | 前提 |
|---|---|---|---|
| 默认 | `mineru > oxr > paddleocr > mineru-local > local` | `oxr > paddleocr > mineru > mineru-local` | 无需配置 |
| 全离线 | `local` | `mineru-local` | 填本地 MinerU 启动器路径 |
| 云端优先 | `mineru > oxr > paddleocr > local` | `oxr > paddleocr > mineru` | 三处凭证齐全 |
| 只用本地 MinerU | `mineru-local` | `mineru-local` | 填本地 MinerU 启动器路径 |

显式指定后端（工具参数 `backend` 或面板的「解析后端」）等于把链收缩为单一档位，失败不再降级；该档位缺少凭证或地址时直接返回错误，不会静默改道。

**本地 MinerU。** 填写 `mineru-kit.exe` 的完整路径后，插件在真正用到该档位时自行拉起服务，空闲达设定秒数后卸载（`0` 表示每次解析结束即关闭）。服务端口从设定值起顺序尝试，被占用则后移。已在运行的外部实例只借用、不接管、不终止；填写了服务地址时只探测该地址，不另起实例。首次解析需加载模型，耗时可达百秒量级，此后同进程内显著缩短。

**公式兜底。** 公式识别降级链默认只有 `local`，即 OMML 与 MTEF 转换器。另有两条本机小模型可选用，安装后才会进入该链，未安装时静默剔除。该链只处理本地转换失败后留下的预览图，识别成功时正文写入 LaTeX，对应图片不落盘、不出现在正文与媒体清单中。

**保存与清理。** 保存路径留空时取系统文档目录下的 `doc-intake`。可开启自动保存与结构化 JSON 输出。自动清理按保留时长把保存目录中过期的提取产物移入系统回收站，默认关闭；清理记录在设置页可查，含时间、释放体积与条目。网络位置与部分可移动磁盘没有回收站，这类路径下的清理为直接删除，使用前需自行确认。

**返回容量。** 单条返回文本块默认 28 KiB、最多 4 块，另有媒体路径返回条数上限。内容超过容量且已落盘时，只返回处理摘要与路径；未落盘时保留首尾并标明结果不完整。这一层只决定当场发送多少正文，不改变已提取的数据与已落盘的文件。

## 使用

App 提供三个入口：模型循环（工具 `doc_intake`）、面板卡片（应用内「文档提取」）、服务总线（`app:doc-intake/*`）。

由 Agent 调用时，最常用的形式如下：

```python
doc_intake(source=["report.pdf"])
doc_intake(source=["report.pdf"], outputDir="D:/Output")
doc_intake(source=["report.pdf"], pageRange="1-5")
doc_intake(source=["a.docx", "b.pptx", "c.xlsx"])
doc_intake(source=["paper.pdf"], backend="local")
```

目录会被展开为其中所有受支持的文件。`summaryOnly` 只返回每个文件的状态与路径，解析与落盘照常执行，适用于批量归档。文件中只要有一份走云端，整批即转入后台作业，宿主任务完成后把结果投回原会话，聊天流中显示进度卡片；全部走本地的批次同步返回。

面板卡片用于手动处理，可一次指定多个文件或目录、保存位置、页码范围、语言、后端，以及是否提取媒体、是否另存 JSON。运行结束后可将结果投递回对话。

其他 App 通过服务总线调用，方法名为 `app:doc-intake/<方法>`：

```js
const r = await sdk.bus.requestService("app:doc-intake/extract",
  { sources: ["C:\\Users\\me\\Documents\\报告.pdf"] }, { timeout: 120000 });
if (r.state === "done") { /* r.files[0].markdown */ }
```

四个方法的参数、`jobId` 与 `waitMs` 的用法、错误码与结果字段见 `builders/SERVICE-API.md`。服务只接受绝对路径；作业记录保留 30 分钟，逾期后 `status` 与 `result` 返回 `JOB_NOT_FOUND`，已落盘的文件不受影响。

## 输出

保存目录的结构固定：正文、可选的 JSON、以及唯一的媒体目录。

```
outputDir/
├── 文件名.pdf.md
├── 文件名.pdf.json
└── 文件名_media/
    ├── image_001.png
    ├── image_002.jpg
    ├── video_001.mp4
    └── audio_001.flac
```

媒体按类型分别连续编号，云端返回的原始文件名不保留；分块处理的媒体带 `chunk_NNN_` 前缀。正文中以相对路径引用：

```markdown
![image_001](report_media/image_001.png)

<video controls src="report_media/video_001.mp4" title="演示"></video>
```

开启条码解析时，码内容注在引用该媒体的那一行下方，正文结构不变：

```markdown
![image_001](report_media/image_001.png)
> 二维码：https://example.com/a1b2
```

结构化 JSON 与工具返回的路径块是两套口径：JSON 中的 `mediaPaths` 为相对路径，便于整目录迁移；工具返回中的路径为绝对路径，便于当场读取。

## 已知限制

- 本地解析档只读取 PDF 内嵌文本，不执行 OCR。扫描版 PDF 未配置云端或本地 OCR 档位时只能得到空白。
- 部分国标类 PDF 缺少 ToUnicode 映射，提取结果会出现「犐犆犛」这类乱码。插件会识别该特征并记录警告，建议改用 OCR 档位。
- OMML 公式转换失败时没有预览图可退，Word 不为这类公式保存图像。MTEF 转换失败时则保留其预览图。
- Kindle 文件带 DRM 时直接拒绝，不做解密；`.prc` 仅支持 `BOOKMOBI` 容器，老式纯 PalmDOC 不在支持范围。
- 电子书没有页码概念，`pageRange` 对其无效；`language` 仅作提示。
- 漫画归档默认只出图，不主动 OCR。
- 自动清理依赖系统回收站，网络位置与部分可移动磁盘上为直接删除。

常见错误与处理方式：

| 错误码 | 含义 | 处理 |
|---|---|---|
| `PYTHON_PATH_NOT_CONFIGURED` | 未填写 Python 路径 | 在设置页填写 `pythonPath` |
| `INVALID_SOURCE` | 路径无效或无受支持文件 | 核对路径与扩展名 |
| `SPAWN_FAILED` | Python 进程无法启动 | 核对解释器路径与环境完整性 |
| `PYTHON_ERROR` | Python 进程非零退出 | 查看日志中的 stderr 摘要 |
| `CONVERSION_*` | 旧版 Office 转换失败 | 检查 Office、`pywin32` 或 LibreOffice 配置 |
| `PATH_NOT_ALLOWED` | 服务入口收到非绝对路径 | 调用方改为绝对路径 |
| `JOB_NOT_FOUND` | 作业已过期或不存在 | 作业记录保留 30 分钟 |

## 在 Hana 中的推荐设置

- 关闭 Hana 内置的 `office_read-document` 工具（设置 → 助手 → 工具 → Office）。该工具会先于本 App 被选用，遇到读不了的文件时改为自行编写脚本，不经过本 App 的解析链。
- 卸载通用的 office 类 skill（旧版 Hana 自带 `office-documents`）。它以纯文本提取为目标，不处理扫描件、公式与媒体，且在技能列表中排在前面。
- 将助手切换为「无」。该配置对指令的遵循更稳定，技能路由也更可预期。
- 开启保存到本地。Hana 对单条返回有长度限制，超出部分会被截断；落盘后 Agent 可直接读取完整正文与媒体文件。

## 开发者接口

- `builders/SERVICE-API.md`：对外服务的四个方法、参数、错误码与结果字段。
- `builders/PARAMETERS.md`：工具入参与设置项全表。
- `builders/svc-probe/`：跨 App 调用的可运行示例，含注册与调用两侧的写法。
- `doc/MTEF-v5-支持说明.md`、`doc/MTEF-v3-支持说明.md`、`doc/MTEF-接手与迭代.md`：MathType 解析器的格式说明、验证方法与会话记录。

App 的能力声明为 `app/process.spawn`、`app/tools.expose-to-model`、`app/ui.open-external`、`app/resources.read`、`app/resources.write`、`app/tasks.manage`、`app/session.start-turn`、`app/services.provide`。出站网络仅限 `mineru.net`、`somark.cn`、`paddleocr.aistudio-app.com`、`github.com`。

## 许可

本项目以 Apache License 2.0 发布，正文见 `LICENSE`，归属与第三方声明见 `NOTICE`。

随包分发的 `sdk/` 为 Hana App SDK，其第三方声明见 `sdk/THIRD_PARTY_NOTICES.txt`。`release/` 下的打包脚本衍生自 git-save-load 与 GitHana，按文件保留 MPL-2.0，且不随 App 分发包发布。可选依赖（Kindle 解包库、公式兜底权重）不随包分发，由用户自行安装。

