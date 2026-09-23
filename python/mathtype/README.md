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

```bash
python mathtype/mtef_v5.py --selftest        # 规范范例逐字节 + 语料走满率
python mathtype/mtef_v5_latex.py --selftest  # 范例 + 新增覆盖 35 项 + 语料渲染
python mathtype/mtef_v3.py --selftest
python mathtype/mtef_v3_latex.py --selftest
```

语料路径不存在时自测会跳过并返回 2，不会假通过。

## 文档

- [MTEF v5 支持说明](../../doc/MTEF-v5-支持说明.md)
- [MTEF v3 支持说明](../../doc/MTEF-v3-支持说明.md)

## 参考

- 格式规范：<https://rtf2latex2e.sourceforge.net/MTEF5.html>、
  <https://rtf2latex2e.sourceforge.net/MTEF3.html>
- 早期实现参考过 [mtef-go](https://github.com/zhexiao/mtef-go)；那一版及其移植
  （`mtef.py`、`record.py`）已删除，只在 git 历史里留痕。
