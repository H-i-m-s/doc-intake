# Doc Intake

Hana v2 App（`manifestVersion: 2`），位于 `<HANA_HOME>/apps/doc-intake`。
把 PDF / 图片 / Office（DOC/DOCX/PPT/PPTX/XLS/XLSX/XLSM/HTML）转成结构化 Markdown，
支持扫描件 OCR、公式转 LaTeX、表格识别、媒体提取。

由 v1 插件 `plugins/doc-intake` 迁移而来，两个 Agent 工具的对外名称、参数、
返回结构保持不变：`doc_intake`、`doc_intake_validate`。

## 结构

```text
doc-intake/
├── manifest.json          # v2 清单：能力、设置 schema
├── index.js               # defineApp 入口：读设置 + 注册两个工具
├── assets/icon.png        # 身份图标
├── lib/                   # JS 公共模块（调度、设置、输出格式）
├── tools/                 # 两个工具的实现
├── python/                # 提取器后端（原样迁移）
├── skills/doc-intake/     # 宿主自带 skills 目录，原样迁移
└── sdk/                   # 随包分发的 @hana/app-sdk 闭包
```

## v2 相对 v1 的关键变化

- **清单**：`manifestVersion: 1` → `2`；`contributes.configuration` → `contributes.settings.schema`；
  新增必填 `icon`、`entry`、`capabilities`。
- **能力**：声明 `app/process.spawn`（运行外部 Python）与 `app/tools.expose-to-model`（工具进入模型循环）。
- **文件系统边界**：App 进程跑在 Node Permission Model 下（安装目录只读、`app-data/doc-intake` 可写），
  裸 `fs` 读许可根以外的路径会被拒。原先 `tools/doc_intake.js` 里的 `expandPaths`（目录展开、存在性、
  后缀过滤）已下放到 `python/list_sources.py`，由被 spawn 的 Python 子进程完成（它不受该限制）。
  产物写入仍由 Python 完成，因此本 App 不需要 `app/resources.read` / `app/resources.write`。
- **设置读写**：`ctx.config` 从同步变异步。`index.js` 用 `sdk.config.getAll()` 取一次配置，
  包成 `{ config: { get } }` 适配层喂给 `lib/settings.js`，配置模块本身零改动。
- **工具调用签名**：v2 的 `execute` 是单参数调用 `execute({ ...args, context })`，
  由 `index.js` 拆回工具模块期望的 `(input, ctx)`。
- **设置 schema 表达力缺口**：v2 不支持 `minimum` / `maximum` / `items`。
  数值边界由代码内的 clamp 承担（如 `inlineBlockBytes` 4096–30720）；
  `pdfBackendChain` 从 array 降级为字符串，用 `>` 或 `;` 分隔（例如 `mineru>paddleocr>local`）。

## 配置

设置页左侧「Doc Intake」。注意 v2 的设置与 v1 插件分开存储
（v1 在 `plugin-data/doc-intake/config.json`，v2 在 `user/preferences.json` 的
`settings_contributions["v2-doc-intake"]`），迁移后需要重新填写，至少要填：

- `pythonPath`：conda 环境的 `python.exe`
- `mineruCredentials` / `paddleTokens`：云端 Token（可选）
- `pdfBackendChain`、`savePath`、`autoSave` 等按需

Python 依赖不变，仍装在用户自己的环境里（见 `python/requirements.txt`）。

## 安装

放到 `<HANA_HOME>/apps/doc-intake` 后重启 Hana，在市场「已安装」页 App 类目的
「待批准」区块批准。首次批准会对 `app/process.spawn` 和 `app/tools.expose-to-model`
两项能力一次性确认。批准后在设置窗「安全」页的「应用能力」面板可单独开关。

**批准前请先停用 v1 插件 `doc-intake`**：两者注册的工具名相同，同时启用会冲突。
