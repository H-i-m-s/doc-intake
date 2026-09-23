# mathtype —— MTEF 公式解析与转换

把 Word / PowerPoint 里嵌入的 MathType 公式（OLE 复合文件里的 `Equation Native` 流）
解析成 LaTeX。

两条**互相独立**的实现路线，按 body 首字节的 MTEF 版本号分流：

| 格式 | 来源 | 解析 | 渲染 |
|---|---|---|---|
| MTEF v5 | MathType 4/6/7（progId `Equation.DSMT4` / `DSMT6` / `DSMT7`） | `mtef_v5.py` | `mtef_v5_latex.py` |
| MTEF v3 | Equation Editor 3.x（progId `Equation.3`） | `mtef_v3.py` | `mtef_v3_latex.py` |

解析层只做「字节 → 记录树」，渲染层只做「记录树 → LaTeX」，互不越界。
统一入口是上一级的 `mathtype_converter.py`（`MathTypeConverter`）。

拿不准的一律不猜：任何一步读不懂就返回 `None`，由提取器退回该公式自己的预览图。

## 自测

四个自测脚本在仓库的 `test/` 下（跟着 app 一起发出去，谁都能跑）。脚本里的位置全部由
`__file__` 推出来，在任何工作目录下都一样：

```bash
python test/selftest_v5_parse.py     # 规范范例逐字节 + 语料走满率
python test/selftest_v5_render.py    # 范例 + 覆盖项 46 项 + 真机样本比对
python test/selftest_v3_parse.py
python test/selftest_v3_render.py
```

样本文件或语料目录不在时，脚本会明确打印「跳过」并按退出码 0 处理——**「跳过」不等于
「通过」**，完整判定标准（含 `audit.py`、`fallback.py` 的数字）见下一节那份文档。

## 文档

- [MTEF v5 支持说明](../../doc/MTEF-v5-支持说明.md)
- [MTEF v3 支持说明](../../doc/MTEF-v3-支持说明.md)
- [MTEF 接手与迭代](../../doc/MTEF-接手与迭代.md)：验证入口、三道关、加新构造、样本来源

## 参考

- 格式规范：<https://rtf2latex2e.sourceforge.net/MTEF5.html>、
  <https://rtf2latex2e.sourceforge.net/MTEF3.html>
- 早期实现参考过 [mtef-go](https://github.com/zhexiao/mtef-go)；那一版及其移植
  （`mtef.py`、`record.py`）已删除，只在 git 历史里留痕。
