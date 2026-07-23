# MathType_MTEF
MTEF Data decode by python

## 简介
MTEF为MathType公式的数据格式。

这是一个解析MTEF格式的库。内包含解析OLE格式的库。

解析MTEF数据后，将公式转换为Latex公式。

## 参考用例
```python
mtef, err = MTEF.OpenBytes(ole_bytes)
latex_str = mtef.Translate()
```

## 参考项目
[mtef-go](https://github.com/zhexiao/mtef-go)