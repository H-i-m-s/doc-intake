# test/ —— 公式转换的验证与诊断

这个目录里的脚本只依赖两样东西：app 自己的代码（`../python`）和目录里自带的样本。
**没有任何绝对路径**，也没有你机器上的任何路径——整个 `test/` 可以跟着 app 拷到
别的电脑上直接跑。脚本里的位置全部由 `__file__` 推出来（见 `_common.py`）。

## 脚本

| 脚本 | 干什么 | 用法 |
|---|---|---|
| `audit.py` | 体检：把 docx/pptx 里每个 MathType 对象走一遍，报 MTEF 版本、能否转出 LaTeX、退回原因、空壳对象 | `python audit.py [文件或目录 ...]` |
| `peek.py` | 诊断：列出文件里的 ProgID 与每个公式对象的明细；`--tree N` 打印第 N 个对象的 MTEF 记录树 | `python peek.py 文件 [--tree N]` |
| `fallback.py` | 退路：数「公式对象 ↔ 预览图」的对应关系（查多道公式共用一张图），并现场造一个嵌入流被清空的副本，验证会走退路 | `python fallback.py [docx ...]` |

不给参数时，`audit.py` / `fallback.py` 看 `../python/mathtype/samples/` 里自带的那几份样本。

## 三方样本

`samples/oleObject1.bin`、`samples/oleObject2.bin` 取自 zhexiao/mtef-go 仓库的测试数据
（Apache License 2.0），是两个含 MathType 公式的 OLE 复合文件。来源见 `samples/NOTICE.txt`。
它们让 `audit.py` / `peek.py` 有一份不依赖任何文档的输入。

```bash
python audit.py samples/oleObject1.bin   # 不是 OOXML 的输入，会当成一个裸 OLE 对象来看
```

## 库自带的自测

跟这个目录是两回事：那是解析器/渲染器内部的基准（规范范例逐字节、真机样本比对等），
跑法是直接给模块加 `--selftest`：

```bash
python ../python/mathtype/mtef_v5.py --selftest
python ../python/mathtype/mtef_v5_latex.py --selftest
python ../python/mathtype/mtef_v3.py --selftest
python ../python/mathtype/mtef_v3_latex.py --selftest
```

其中「语料走查」需要 `../python/mathtype/samples/corpus/` 下有 docx/pptx 才会跑，
目录不存在就跳过（语料是私人的，不进仓库）。

## 一个教训

脚本名别用 `inspect` 这种标准库名字。`test/` 会进 `sys.path`，一旦同名就会把标准库
顶掉——实测过一次，库里的 `inspect.signature` 直接报 AttributeError，所有公式都退回
预览图。原来的 `inspect.py` 因此改名成 `peek.py`。
