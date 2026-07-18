# Doc Intake

Hana 插件：文档/图片内容提取工具

## 功能

- **PDF 提取**：使用 MinerU 云端 API，支持公式/表格/图片
- **图片 OCR**：使用 PaddleOCR 云端 API，支持 109 种语言
- **Office 文档**：本地提取 DOCX/PPTX/XLSX，支持图片提取
- **多 Key 轮询**：支持多个 API Key 并发处理
- **大文件处理**：自动切割超限 PDF

## 安装

插件已包含在 HanaAgent 中，无需额外安装。

### Python 依赖

```bash
pip install -r python/requirements.txt
```

## 配置

在 Hana 插件设置中配置：

1. **Python 路径**：指定 conda 环境的 python.exe
2. **MinerU Token**：获取免费 Token https://mineru.net/apiManage/token
3. **PaddleOCR Token**：获取 Access Token https://aistudio.baidu.com/

## 使用

```
# 基本提取
doc_intake(source="document.pdf")

# 保存到目录
doc_intake(source="document.pdf", outputDir="D:/Output")

# 指定页码范围
doc_intake(source="document.pdf", pageRange="1-5,10")
```

## 目录结构

```
doc-intake/
├── manifest.json      # 插件配置
├── package.json
├── README.md
├── tools/
│   └── doc_intake.js  # 工具入口
├── lib/
│   ├── settings.js    # 设置管理
│   ├── service.js     # 核心服务
│   ├── key-pool.js    # Key 轮询
│   ├── file-checker.js
│   ├── errors.js
│   └── tool-output.js
├── python/
│   ├── main.py        # Python 入口
│   ├── extractors/    # 本地提取器
│   ├── mineru_client.py
│   ├── paddle_client.py
│   └── requirements.txt
└── skills/
    └── doc-intake/
        └── SKILL.md
```

## License

MIT
