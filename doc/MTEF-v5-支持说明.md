# MTEF v5 支持说明

本文说明 doc-intake 对 **MTEF v5**（MathType 4/6/7，Office 里 progId 为
`Equation.DSMT4` / `DSMT6` / `DSMT7` 的公式）的解析与转换：格式怎么分层、代码在哪、
验过什么、什么情况会退回预览图、还有哪些不确定。

面向两类读者：想改这段代码的人，和想知道「为什么这条公式又变成图片了」的人。

配套阅读：[MTEF-v3-支持说明.md](MTEF-v3-支持说明.md)（老公式 `Equation.3` 那一支）。

---

## 一、这份支持是什么

Office 里的公式有四种来源，doc-intake 分四条路处理：

| 来源 | 标识 | 处理方式 |
|---|---|---|
| OMML（Office 2007+ 原生公式） | `m:oMath` | `extractors/omml_converter.py` |
| **MathType（本文）** | progId `Equation.DSMT4` / `DSMT6` / `DSMT7`，MTEF v5 | `mathtype/mtef_v5.py` + `mtef_v5_latex.py` |
| Equation Editor 3.x | progId `Equation.3`，MTEF v3 | `mathtype/mtef_v3.py` + `mtef_v3_latex.py` |
| 无法解析 | 任意 | 用公式的兜底预览图（WMF/EMF 转 PNG） |

**「公式对象」不等于「MTEF」**。Office 里的公式对象在结构上都长一样（一个 OLE 对象
配一张预览图），但肚子里可以完全不同。实测过一份用 LaTeXSnipper（LaTeX 公式编辑器）
做的 docx：8 个对象、8 张 EMF 预览齐全，可 ProgID 是 `LaTeXSnipper.Formula.1`，
OLE 里的流是 `Payload` / `PresentationEmf` / `EPRINT` / `ObjInfo`，**没有
`Equation Native`**——它和 MTEF 不是一回事，本文这套代码对它没有入口。

判断一份文档里的公式能不能走本文这条路，只看 `word/document.xml` 里的 `ProgID`：
`Equation.DSMT4` / `DSMT6` / `DSMT7` 是 MathType（v5，本文范围）；`Equation.3` 是老
Equation Editor（v3，见 v3 那份说明）；别的 ProgID 都不在本范围。没有 `embeddings`
目录则说明用的是 Word 自带公式（OMML），那是另一条路。

MTEF v5 是现在最常见的公式格式：MathType 4 之后一直用它，学位论文、期刊模板、
课件里主力都是这一支。它的数据躺在 OLE 复合文件的 `Equation Native` 流里，
body 首字节就是 MTEF 版本号（5）。

**语料规模**：6 份文档共 **165 道** v5 公式，其中 153 道来自一篇 29 MB 的学位论文。
换算成「能不能转出 LaTeX」：165/165，**一道都没退回预览图**。

---

## 二、数据怎么分层

### 2.1 外层：OLE 与 Equation Native

- 文件里的 OLE 二进制（OOXML 包里的 `word/embeddings/oleObjectN.bin`）是 OLE 复合
  文件，用 `olefile` 或仓库自带的 `mathtype/ole_util/ole.py` 打开。
- 目标是名为 `Equation Native` 的流（少数写法带 `\x01` 前缀，匹配时去掉）。
- 流开头 28 字节是 `EQNOLEFILEHDR`：

  | 偏移 | 长度 | 内容 |
  |---|---|---|
  | 0 | 2 | `cbHdr`，恒为 28 |
  | 2 | 4 | OLE 对象版本 |
  | 6 | 2 | 剪贴板格式 |
  | 8 | 4 | `cbObject`，**后面 MTEF 数据的字节数** |
  | 12 | 16 | 保留字段（写它的进程留下的指针，无意义） |

**踩过的坑**：判断版本要看 `Equation Native` 流里的首字节，不是整个 `.bin` 文件。
`.bin` 的前 28 字节是 OLE 复合文件的头，拿它去判版本必然读错。

### 2.2 头部：版本字节与 EQN_PREFS

body 首字节是 MTEF 版本号（v5 是 5）。接着通常是一串 EQN_PREFS 记录（字号表、
间距等设置），解析时要跳过，但它们带尺寸信息，别当成内容。

规范里那个 292 字节的二次方程范例（`mtef_v5.spec_example()`）逐字节走通，是解析层
唯一的「不依赖语料」的金标准。

### 2.3 记录类型

| 值 | 名称 | 值 | 名称 |
|---|---|---|---|
| 0 | END | 10 | FULL |
| 1 | LINE | 11 | SUB |
| 2 | CHAR | 12 | SUB2 |
| 3 | TMPL | 13 | SYM |
| 4 | PILE | 14 | SUBSYM |
| 5 | MATRIX | 15 | COLOR |
| 6 | EMBELL | 16 | COLOR_DEF |
| 7 | RULER | 17 | FONT_DEF |
| 8 | FONT_STYLE_DEF | 18 | EQN_PREFS |
| 9 | SIZE | 19 | ENCODING_DEF |

`>=100` 是 FUTURE（预留给将来的记录类型，用一个变长无符号整数跳过）。

**哪些记录带选项字节**：只有结构记录（LINE / CHAR / TMPL / PILE / MATRIX / EMBELL）
加 COLOR_DEF 与 EQN_PREFS 有。END、RULER、FONT_STYLE_DEF、SIZE、FULL、SUB、SUB2、
SYM、SUBSYM、COLOR、FONT_DEF、ENCODING_DEF **没有**选项字节，照着「都有」去读会
一路错位。

### 2.4 子对象列表：读到 END 就收

LINE / TMPL / PILE / MATRIX 的对象列表都是**真嵌套**结构，读到 `END` 才算收尾，
不是平铺的一串记录。这一条是 v5 渲染质量的分水岭，见第七节 7.1。

### 2.5 nudge（位置微调）

带 `mtefOPT_NUDGE`（0x08）的记录，选项字节后面跟着 nudge 偏移。实测：小偏移 2 字节、
大偏移 6 字节，判据看两个分量是否都等于 128（等于 128 表示这一维没偏移）。
**语料里 0 个 nudge 记录**，所以这条只有微测试覆盖，没有实测样本。

### 2.6 字号标记的上下文规则

FULL / SUB / SUB2 这三个标记在不同位置含义不同：

- 在 **LINE / PILE 的行内**：按流式处理，SUB 真的开一层下标（还带基线下降）；
- 在 **模板槽位列表、矩阵单元列表**里：只是尺寸提示，**不参与结构**。

否则 `tmSUP` 槽位前的 SUB 会把 $b^{2}$ 渲染成 $b_{2}$。这条是实测出来的，
不是从规范读出来的。

### 2.7 LP_RULER 之后那份标尺

行记录带 `mtefOPT_LP_RULER` 时后面跟一份「左侧标尺」数据。实测（MathType 7 写出的
`oleObject4.bin`）：**那份标尺不带记录类型字节**，形如
`0A | 01 02 | 01 00 30 12 | 02 ...`。按「先读类型字节」的写法会直接读崩。

---

## 三、MATRIX 与 PILE

- **矩阵单元只认 LINE**。列表里夹着的 COLOR 记录、字号标记不算格：
  `oleObject69` 是 4×1（4 个 LINE + 3 个 COLOR），`oleObject128` 是 2×4（8 个 LINE
  + 5 个 FULL + 2 个 COLOR）。按「列表里每个对象都是一个格」数会把行列数搞乱。
- **矩阵本身不带分隔符**，那对括号来自外面的围栏（tmBRACK 之类），所以用
  `\begin{matrix}`。用 `bmatrix` 会自带一对括号，和围栏叠成两对。
- 单元数必须等于 `rows × cols`，不等就退回预览图（不猜）。
- PILE 是堆叠：多行用 `\begin{gathered}...\end{gathered}`，单行直接出内容。

---

## 四、模板与槽位顺序

模板（TMPL）记录的字段是：选择子号、变体号（1 或 2 字节，首字节高位表示续读）、
模板选项、然后是一组槽位（每个槽位都是一个对象列表）。

### 三处与规范正文不一致，以字节为准

| 项 | 规范正文 | 实测 |
|---|---|---|
| `tmSUP` 槽位顺序 | 上标槽在前 | **下标槽在前** |
| `tmROOT` 槽位顺序 | 次数槽在前 | **被开方在前** |
| 大运算符限位 | 变体位 `0x0001`/`0x0002` | **`0x10` 下限 / `0x20` 上限 / `0x40` 总和式** |

大运算符那条的依据：`tmSUM` 变体 `0x70` 的槽位是「Σa_i² / i=1 / ∞」，变体 `0x40`
只有主槽。规范正文那套位值与数据对不上，按数据实现。

### 模板的子对象列表里不只有槽位

模板的子对象列表里除内容槽，还夹着两样东西：**装饰字形**（`fnEXPAND` 的 CHAR，比如
宽帽子那道帽尖、花括号本身）和 **COLOR 记录**。实测 MathType 7 写出的 `\widehat{ABC}`：

```text
TMPL #33 tmHAT var=0x0000 类=HatBox tattr=0x00
  COLOR 颜色#0
  LINE  CHAR A  CHAR B  CHAR C
  CHAR fnEXPAND mt=0x0302
```

真正的内容只有那个 LINE。所以「某个类有几个槽位」要**按 LINE 数**，不能按记录数——
按记录数会把装饰字形和颜色也算成槽位（新增覆盖第一版把 `tmHAT` 读成 3 个槽、
`tmHBRACE` 读成 8 个槽，就是这么来的）。

规范里 **Template subobject order** 那一节列了所有多槽位类的子对象顺序：ArroBox 2
（主槽 + 箭头字符）、BigOp 4（主槽 + 上 + 下 + 大运算符字符）、Dirac 5、Frac 2、
HFence 3（主槽 + 小槽 + 花括号字符）、LDiv 2、Lim 3、ParBox 3（主槽 + 左右围栏字符）、
Root 2、Scr 2、Slash 2。**BarBox / HatBox / StrikeBox / TBoxBox 不在表里**，即它们只有
一个内容槽。

### 上下标、限位与函数名

- `tmSUB` 下标槽在前；`tmSUP` 下标槽在前、上标槽在后；`tmSUBSUP` 先下标后上标。
- 变体 `0x0001`（`tvSU_PRECEDES`）表示脚本在底之前，用空组占位把脚本摆到前面。
- 限位摆放：`\sum` 类天生叠上下、`\int` 类天生在两侧，只有反着来才显式写
  `\limits` / `\nolimits`。
- `fnFUNCTION`（字体风格 2）**不专指函数名**：括号、围栏也带这一风格。只把
  连续的**字母**凑成词再认运算符（sin / cos / tan / log / ln / lim / max / min…），
  其余按正体文本。规范里那个 `xfAUTO` 位（`0x01`）认不出函数名——语料里 904 个字符
  有 349 个带这一位。

---

## 五、代码在哪

```text
python/
├── mathtype_converter.py      # 公式转换的统一入口，v3 / v5 在这里分流
└── mathtype/
    ├── mtef_v5.py             # 本文主角：MTEF v5 字节流 -> 记录树
    ├── mtef_v5_latex.py       # 记录树 -> LaTeX
    ├── mtef_v3.py             # MTEF v3 字节流 -> 记录树
    ├── mtef_v3_latex.py       # 记录树 -> LaTeX
    ├── chars.py               # 码位 -> LaTeX 符号表
    └── ole_util/              # OLE 复合文件读取
```

分工与边界：

- `mtef_v5.py`：只做「字节 → 记录树」。不产出 LaTeX。
- `mtef_v5_latex.py`：只做「记录树 → LaTeX」。不读字节。
- `mathtype_converter.py`：`_parse_ole_to_latex()` 读流、判版本，`mtef_body[0] == 5`
  走 `_parse_v5_to_latex()`，否则走 v3 那一套。

**接入点有两道门**（缺一不可，防止拿垃圾字节猜出「像样」的错解）：

1. body 首字节必须是 5；
2. `mtef_v5.parse()` 必须恰好走满 body，且**没有任何 error 提示**。

### 要加一个模板

1. 在 `mtef_v5.py` 的 `TMPL_CLASSES` 里确认选择子归属的类；
2. 在 `mtef_v5_latex.py` 的 `Renderer.tmpl()` 里给该类（或该选择子）加分支，
   槽位用 `slot_texts()` 取，不要自己去翻 `t.slots`；
3. 涉及限位就补 `BIGOPS` 的变体表；
4. 在 `_coverage_test()` 里加断言，跑第八节的自测。

---

## 六、硬闸与退回策略

一条公式要么给出**完整正确**的 LaTeX，要么退回**它自己的预览图**。中间状态不接受。

`render()` 返回 `None` 的几种情况：

- 遇到没实现的模板、附饰或字符（不猜）；
- 矩阵单元数与行列数不符；
- `\left` 与 `\right` 数量不配对；
- 花括号不配对（忽略 `\{` `\}` 转义）。

### 退回预览图这一步在哪

`mathtype_converter.py` 只负责「转不转得出 LaTeX」，退回预览图由提取器完成：

- `extractors/docx_extractor.py`：`_check_ole_object()` 返回公式的 LaTeX，或在转不出
  时返回该公式**自己的**预览图引用；
- `_select_media_files()` 只导出「真的没转出来」的那些公式的预览图，转成功的公式
  不导出预览图（避免一篇论文里多出上百个没人用的 WMF）；
- `pair_ole_previews()` 负责「哪个 OLE 对象配哪张预览图」，见第七节 7.6。

---

## 七、踩过的坑（改代码前请读）

### 7.1 平铺读 vs 真嵌套

早期那版实现（已删的 `mtef.py`，是 zhexiao/mtef-go 的 Python 移植）把对象列表当
平铺记录流读。后果：`公式图表测试.pptx` 里一道 2×2 矩阵渲染成「两行变三行、两列
塌一列」，而解析器自测照样「走满、无 error」——**走满不等于读对**。
改成「读到 END 才收」的嵌套读之后，同一道公式与预览图完全重合。

### 7.2 double subscript：只有对预览图才发现

同一个基上挂两层同向上下标，例如 `\sigma_{Fd}^{2}_{i}`（论文 #130，预览图是
$\sigma^2_{Fdi}$）。这个错：

- 括号配平、`\left/\right`、走满检查**全都拦不住**；
- 真 LaTeX 报 `Double subscript`，KaTeX 直接不渲染；
- 是靠**把 14 道公式和它们自己的预览图并排看**才发现的。

修法：`join()` 在「上一段以脚本组结尾、这一段又以 `_` 或 `^` 开头」时补一个空组
`{}`，变成合法的 `{}_{...}`。代价是偶尔多补一个（如 `\dot{z}_{1}{}^{2}`），
因为「标记类型不同」这个信号分不出「真错」和「无害」。

### 7.3 公式里的中文裸着出

MathType 把中文当普通字符写进 CHAR 记录，`mt_code` 就是码位。裸着出也能显示，
但字体会走数学字体栈、字距不对。现在按**码位**识别中日韩 / 全角区间，合并成
`\text{...}` 输出（内部转义 `% & # _ $ { }`）。按码位判而不是按字体风格编号，
v3/v5 通用，也不用猜哪个 typeface 是中文。

### 7.4 矩阵单元只认 LINE

见第三节。这条错**硬闸拦不住**（括号数是对称的，单元数也可能恰好对上），
只能靠数单元与行列。

### 7.5 只有眼睛能发现的那类错

7.2 和「矩阵该用 `matrix` 还是 `bmatrix`」都是这一类：所有机器检查都通过，
渲染出来却是错的。所以第八节的「对照预览图」不是可选项。

### 7.6 退路串图（同段落多道公式）

`ole_preview_map` 早期对一个段落里的**所有**公式对象都塞 `preview_media[0]`，
`_select_media_files` 也只导出一张预览图。后果：同一段落里两道公式都转不出时，
第二道显示成**第一道的图**——比丢图更糟。

实测（把论文里同段落的 `oleObject23`/`24` 都清成 0 字节做样本）：

| | 图片引用 | 其中不同的图 |
|---|---|---|
| 改前 | 13 条 | 12 张（`image_036.png` 被两道共用） |
| 改后 | 13 条 | 13 张 |

现在按结构配对：从 OLEObject 往上找最近的公式容器（`w:object` /
`mc:AlternateContent` / `drawing` 等），取容器里第一张预览图。另外同一个 run 里
有两道公式时，`_check_ole_object()` 以前会在循环里直接 `return` 只出第一道，
现在收齐拼接；既转不出又没有预览图时落一个 `（公式未能转换）` 记号，不让公式
凭空消失。

---

## 八、怎么验证

（接手与迭代的完整流程——验证入口、三道关、加新构造的步骤、样本从哪来——见 `doc/MTEF-接手与迭代.md`。）

### 8.1 自测脚本（可随时跑）

```bash
python mathtype/selftest_v5_parse.py        # 解析：规范范例逐字节 + 语料走满率
python mathtype/selftest_v5_render.py  # 渲染：范例 + 新增覆盖 35 项 + 语料
python mathtype/selftest_v3_render.py  # v3 那一支：样本与基准逐字比对
```

`--example` 可以把规范范例的记录树 / 渲染结果打出来。

另外 `mtef_v5_latex.py` 的自测里还挂着一项**真机样本**：仓库里的
`python/mathtype/samples/公式测试.docx`，那 11 个 MathType 亲手写的对象（第九节那张表），
逐个比对期望的 LaTeX——其中 2 个是空对象，期望 `None`。样本文件不在就跳过并返回 2。
这是唯一一份「人写式子 + MathType 亲笔 + 对过预览图」的数据，改解析或渲染都应该过这一关。

样本与语料都走 `python/mathtype/samples/` 这个相对目录（对**模块文件**定位，不看
当前工作目录），所以自测脚本不依赖任何外部路径，也没有任何环境变量。
v5 那份大语料（165 道，靠一篇 29 MB 的论文）不入库，走查看 `samples/corpus/`：
目录不存在就跳过；想跑就把语料文件丢进去。

第一条断言：292 字节范例逐字节走满（字符、字体、选择子、EQN_PREFS 字号表 8 项与
规范标注逐项一致）；语料 165 个对象全部走满且无 error 提示。

第二条断言：范例渲染成 $\frac{-b\pm \sqrt{b^{2}-4ac}}{2a}$；`_coverage_test()`
44 项（34 项期望输出 + 10 项期望闸门）全部符合；语料 165/165 渲染成功、
`\left/\right` 不配对 0 个、用 `array` 0 个。

两个自测都带基准常量（`CORPUS_EXPECTED`），语料路径不存在时**跳过并返回 2**，
不会假通过。

### 8.2 对照兜底预览图

自测只能证明「和上次一样」，不能证明「对」。真正的验收标准是**公式自己的兜底预览图**。

已经在 `公式图表测试.pptx`、`这是一个公式测试文件.docx`、`复杂—翻车机公式及表格
图片处理.docx`、`翻转课堂计算报告带公式.docx`、毕业论文里抽了 **14 道**逐张并排比对
（预览图在上、渲染结果在下）：**13 道逐项一致**，1 道（论文 #130）暴露 7.2 那个
double subscript，修好后一致。

另一层是**全量核账**：论文里 164 个公式对象 = 153 道 LaTeX + 11 张预览图，
一道不多一道不少（输出里 `$` 计数 306）。那 11 个对象是 `Equation.DSMT4` 但 `.bin`
为 0 字节的空壳（负载被剥掉），只能退预览图——**退路在这类文档里不是兜底，是主路**。

临时探针脚本放在一个开发目录里，没有保留下来（下面只是当时的记录）：

- `audit_all.py` — 全量体检：解析失败、渲染提示、内容量比、结构检查；
- `verify_v5_preview.py` — 抽公式、配预览图、拼「预览 ｜ 渲染」对照图；
- `check_fallback.py` / `check_fallback2.py` — 退路核账与串图样本；
- `test_v5_new_templates.py` — 新增覆盖的逐条断言（与 `_coverage_test()` 同源）；
- `MTEF5.html` / `MTEF5.txt` — 规范原文与剥好的纯文本，逐条查表用。

### 8.3 端到端回归

```bash
python <开发目录>/regress_converter.py
```

走应用入口 `MathTypeConverter`，覆盖 6 份文档全部公式，**合计 195 道**（v5 + v3），
用来确认解析层与渲染层的改动没有波及既有输出。

---

## 九、覆盖情况

### 有语料验证（165 道里出现的）

| 选择子 | 名称 | 语料里出现 |
|---|---|---|
| 27 | tmSUB | 553 次 |
| 11 | tmFRACT | 111 |
| 28 | tmSUP | 63 |
| 3、4 | tmBRACK、tmPAREN | 36 / 21 |
| 29 | tmSUBSUP | 18 |
| 15 | tmINTEG | 10 |
| 2 | tmBRACE | 9 |
| 16、10 | tmSUM、tmROOT | 8 / 8 |
| 23 | tmLIM | 2 |
| 1 | tmBAR | 1 |
| — | MATRIX / PILE | 1×1、2×1、2×2、2×4、4×1 / 多行 |
| 附饰 | 2 emb1DOT、3 emb2DOT | 23 / 12 |

### 有真机样本验证（MathType 7 手写，11 个对象，其中 2 个是空对象）

`python/mathtype/samples/公式测试.docx`（MathType 7.0 写出，11 个 `Equation.DSMT4` 对象）
是唯一一份「为验证而写」的真机样本，每个对象都与它自己的 WMF 预览并排对过：

| 写的式子 | MathType 的真实编码 | 渲染结果 |
|---|---|---|
| `\vec{v}` | 附饰 **11**（embRARROW） | `\vec{v}` ✓ |
| `\overline{ABC}` | `tmOBAR` 变体 `0x0000` | `\overline{ABC}` ✓ |
| `\widehat{ABC}` | `tmHAT` 变体 `0x0000` | `\widehat{ABC}` ✓ |
| `\overbrace{a+b+c}` | `tmHBRACE` 变体 **`0x0001`** | `\overbrace{a+b+c}` ✓ |
| `\underbrace{a+b+c}` | `tmHBRACE` 变体 **`0x0000`** | `\underbrace{a+b+c}` ✓ |
| `\overrightarrow{AB}` | `tmVEC` 变体 **`0x0002`**（指右） | `\overrightarrow{AB}` ✓ |
| `\overleftarrow{v}` | 附饰 **12**（embLARROW） | `\overleftarrow{v}` ✓ |
| `\cancel{x+y}`（两遍） | `tmSTRIKE` 变体 **`0x0002`**（左下→右上斜杠） | `\cancel{x+y}` ✓ |
| `\xrightarrow{f}` | `tmARROW` 变体 **`0x0024`**（上标签槽 + 指右） | `\xrightarrow{f}` ✓ |
| `\xleftarrow{f}` | `tmARROW` 变体 **`0x0014`**（上标签槽 + 指左） | `\xleftarrow{f}` ✓ |

另有 2 个空对象（无内容、无模板、预览图也是空白），退回预览图——不是转换失败。
一共 11 个对象，**9 个正确、2 个空**。

`tmARROW` 的子对象顺序也从真机读出来了（`\xrightarrow{f}`）：

```text
TMPL #14 tmARROW var=0x0024 类=ArroBox
  SUB / COLOR 颜色#0
  LINE  f                     ← 上标签槽
  LINE opts=0x01 空           ← 下标签槽
  FULL / CHAR fnEXPAND mt=0x2192   ← 箭头字形本身
```

**上标签槽在前、下标签槽在后**，箭头字形在最后。双线/半箭（`0x0001`/`0x0002`）、只有下标签槽、
两个标签槽都没有的情形仍退回预览图（没实测，不猜）。

顺带验实两件事：

- **同一个视觉构造走哪条路是有分工的**：单个字母上的向量箭头，MathType 用的是
  **附饰 11**；两个字母上要拉伸的长箭头，才用 `tmVEC` 模板（变体 `0x0002`）。
  两条都得支持，只做模板会漏掉单字母向量。
- **宽窄是内容长度决定的，不是变体**：`\widehat{ABC}` 与 `\hat{x}` 都是 `tmHAT` 变体 0，
  箭头跟着内容伸缩，所以渲染时才按内容长度选 `\hat` / `\widehat`。

### 新增覆盖：按规范实现，**没有样本验证**

这批构造语料里一次都没出现过。选择子号、变体位、附饰值全部照规范 MTEF5 的表
（选择子表、变体位表、附饰值表）实现，单槽模板不存在槽位顺序风险，多槽与含义不明
的一律继续退图。

| 选择子 | 名称 | 写法 |
|---|---|---|
| 12、13 | tmUBAR、tmOBAR | `\underline` / `\overline`，变体 `0x0001` 双线套两层 |
| 14 | tmARROW | 上标签槽存在时：`\xrightarrow[下]{上}` / `\xleftarrow` / `\xleftrightarrow`（变体 `0x0004` = 上标签槽，`0x0010`/`0x0020` = 指左/指右）；其余变体退回预览图 |
| 31 | tmVEC | 方向变体：`0x1` 指左 / `0x2` 指右 / `0x4` 箭头在下方 / `0x8` 半箭；两向位不标默认向右。单原子 `\vec`，长内容可拉伸写法，半箭用 `\overset` / `\underset` |
| 32–34 | tmTILDE、tmHAT、tmARC | `\tilde`｜`\widetilde`、`\hat`｜`\widehat`、`\overset{\frown}{}` |
| 24 | tmHBRACE | `\overbrace` / `\underbrace`（变体 `0x0001` = 槽在上） |
| 30 | tmDIRAC | `\left\langle a \middle| b \right\rangle` |
| 36 | tmSTRIKE | `0x1` 横线（变体 0 同义）→ `\sout`；斜线按 `0x2` / `0x4` 组合 → `\cancel` / `\bcancel` / `\xcancel` |
| 37 | tmBOX | 整框（四边位全有，或全不标）→ `\boxed`；圆角与缺边退回预览图 |
| 9 | tmINTERVAL | 左围栏取变体低 2 位、右围栏取 `0x0030` 两位（能出 $\left] a \right)$ 这种错配） |
| 21、22 | tmINTOP、tmSUMOP | 运算符在槽里：按记录类型分（限位槽一定是 LINE），摆放显式写 `\limits` / `\nolimits` |
| 附饰 11、12、13 | embRARROW、embLARROW、embBARROW | `\vec`｜`\overrightarrow`、`\overleftarrow`、`\overleftrightarrow` |
| 附饰 14、15 | embR1ARROW、embL1ARROW | `\overset{\rightharpoonup}{}` / `\overset{\leftharpoonup}{}` |

单原子用短写法（$\vec{v}$）、长内容用拉伸写法（$\overrightarrow{ab}$），因为 MathType
的箭头会跟着内容变宽，而 `\vec` 不会。

**这栏没有第二只眼睛**。出现渲染可疑时，先怀疑这一栏——尤其变体号对不上的情形。
按它的写法，`_coverage_test()` 能证明「按规范写出来的形状能正确渲染」，**不能证明
「和 MathType 真实输出一致」**。真机验证缺一份含这些构造的文档：如果你手边有带
向量箭头、上划线、宽帽子、上下花括号这类公式的 docx/pptx，把它喂进来就能补上。

### 未实现（一律退回预览图）

- `tmHBRACK`（水平方括号）：KaTeX 没有 `\overbracket`；
- `tmJSTATUS`（接头状态构造）：含义不明；
- `tmARROW` 的双线 / 半箭 / 带上下标签槽：`0x0001` / `0x0002` 与 `tvAR_LOS` /
  `tvAR_SOL`（大小压小）复用，方向不唯一；两向位都不标时也不猜方向；
- 斜线分式（`tmFRACT` 变体 `0x0002`）：LaTeX 写法与 `\frac` 外观差异大，宁可不给；
- 围栏类里语料没出现过的组合；
- 附饰 7（反向撇号）、10（斜杠穿过）、21（双斜杠）、22、23（斜杠类）：没有合适的
  LaTeX 写法。

已实现的附饰：2、3、4（点/双点/三点）、5、6、18（撇号）、8、9（波浪/尖帽）、
11、12、13（各种箭头）、14、15（半箭）、16、17（中横线/上划线）、19、20（下凹/上凸弧）。

---

## 十、已知不确定项

1. **新增覆盖那批没有真机样本**（第九节第二栏）。变体位是按规范位表实现的，
   没有实测佐证。这是本文最大的一块不确定。
2. **限位变体位与规范正文冲突**：规范正文写 `0x0001` / `0x0002`，数据里是
   `0x10` / `0x20` / `0x40`。以字节为准。规范若另有版本说法，要重新核对第四节的物证。
3. **nudge 的 2 / 6 字节判据来自启发式**（两个分量是否都等于 128），且语料里
   nudge 记录 0 个，只有微测试覆盖。
4. **标尺（RULER）记录的读法按实测**：`LP_RULER` 之后那份标尺不带记录类型字节。
   依据是 MathType 7 写出的一个样本（`oleObject4.bin`），样本量 1。
5. **`tmSUP` / `tmROOT` 槽位顺序与规范表格相反**，依据是语料实测。规范正文若另有
   说法，同样以字节为准，但要重新核对。
6. **公式里的中文**：按码位判定的规则在 v5 上是逻辑推演（语料里的中文样本全在 v3
   那一支），没有 v5 中文样本。
7. **一处保守代价**：`join()` 补空组挡 double subscript 时会多补（如
   `\dot{z}_{1}{}^{2}`），输出合法、渲染一致，只是写法上多了一个空组。
8. **v5 的 MATRIX 分隔线**（行列分隔线）已按规范解析，但语料里没出现过画分隔线的
   矩阵，只保证了字节数读取正确，渲染未实测。
9. **还有几样没有真机样本**：真机样本（见第九节）已经验掉 `tmOBAR`（0 = 单线）、
   `tmHBRACE`（`0x0001` 槽在上、0 = 槽在下）、`tmHAT`（0 = 单一变体）、`tmVEC`
   （`0x0002` = 指右）、`tmSTRIKE`（`0x0002` = 左下→右上斜杠）、`tmARROW`（`0x0024`/
   `0x0014` 带标签箭头）。**仍未验**：`tmSTRIKE` 的横线（变体 0 / `0x0001`）与
   左上→右下斜杠（`0x0004`）、`tmBOX`（尤其四边位全不标是否等于整框）、`tmARROW`
   的双线/半箭/只有下标签槽、`tmINTERVAL`、`tmINTOP`/`tmSUMOP`、`tmTILDE`、
   `tmVEC` 的半箭（`0x0008`）。这批的变体位都是照规范位表实现的，没有真机佐证。

---

## 十一、出处

- **格式规范**：MathType 官方 MTEF v5 文档，rtf2latex2e 项目存档：
  <https://rtf2latex2e.sourceforge.net/MTEF5.html>
  （原文另存了一份本地快照，剥好的纯文本为 `MTEF5.txt`）
- **旁证实现**：
  - 被删掉的旧实现 `python/mathtype/mtef.py` 是 zhexiao/mtef-go 的 Python 移植，
    读法（平铺流）与渲染（按选择子手抄）都不作依据，只在第七节 7.1 留作反面例证；
  - `mathtype/mtef_v3_latex.py` 里上下划线、箭头、Dirac、弧线这几类的既有口径，
    是 v5 新增覆盖的旁证之一（同一个模板概念、另一套格式的实现）；
  - zhexiao/mtef-go 的 `test/` 下两个真机样本（已下到
    `test/samples/`）：`oleObject1.bin` 我的解析走满 317/317、
    渲染成同一道二次方程（与规范范例、与该仓库自己打印的结果三方一致）；
    `oleObject2.bin` 走满 286/286，是一道带圈三重积分（槽位里是填充数字 `11`、下限
    `222`，输出 `\oiiint_{222}11` 与文件内容相符）。这两个样本里都没有向量、上划线、
    帽子、花括号，补不上第九节第二栏的缺口。
  **两者都不构成正确性证据**，只作旁证。
- **语料**：开发时用过的 6 份文档（不入库），合计 165 道 v5 公式
  （其中最大的一份 153 道 + 11 个
  0 字节空壳、`公式图表测试.pptx` 4 道、`复杂—翻车机公式及表格图片处理.docx` 5 道、
  `这是一个公式测试文件.docx` 2 道、`翻转课堂计算报告带公式.docx` 1 道）。
  v3 那 30 道来自 `[2]第二章_信息与信息论.pptx`。
- **为验证而写的真机样本**：`python/mathtype/samples/公式测试.docx`（MathType 7.0 写出，
  11 个 `Equation.DSMT4` 对象 + 11 张 WMF 预览；覆盖附饰 11/12、`tmOBAR`、`tmHAT`、
  `tmHBRACE` 上/下、`tmVEC` 指右、`tmSTRIKE` 上斜、`tmARROW` 带标签；另有 2 个空对象）。
  三份样本（连 v3 的两份 pptx）都收在 `python/mathtype/samples/` 下，自测用相对路径取。
- **相关提交**：

  ```text
  b599d1c  删掉孤儿模块 mathtype/record.py（连同它留下的陈旧字节码作废）
  431bf3f  v5 补齐缺的模板类与附饰；新增覆盖写进常驻自测
  c627a0b  修 docx 退路：同段落多个公式会串预览图；公式里的中文改按 \text{} 出
  c73073f  修 double subscript：上下标组后面再挂脚本时补空组
  db9a520  v3 渲染器补齐函数名与符号表；删除旧的 mtef.py
  6b38c09  MTEF v5：按规范实现渲染层，并接进转换器
  48d4398  新增 MTEF v5 记录解析器，按官方规范实现
  ```

  其中 `db9a520` 之前的历史（旧 `mtef.py` 那一版、以及从一份本地开发副本移植
  过来的 `record.py`）已不在当前实现里，保留在 git 历史中只为留痕。
