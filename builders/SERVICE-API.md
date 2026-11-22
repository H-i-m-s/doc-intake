# 文档提取 · 对外服务

别的 App 可以直接让这个插件干活，不经过模型、不进对话、不弹卡片。本文是给**调用方**看的：怎么拿到授权、四个方法各传什么、回什么、失败长什么样。

---

## 一、开始之前

三件事，少一件都调不通。

**1. 被调方（doc-intake）这边要开。** 宿主会把每个 App 的对外服务默认关掉。打开路径：设置 → 应用 → 文档提取，授予「提供服务」，然后**重载这个 App**。注册动作只在 App 启动时走一遍，不重载就一直是「未注册」。

**2. 调用方要声明并获批。** 在你自己的清单里申请调用别的 App 的能力，用户同样要在设置里给你打开。没这一步，请求会以「缺少 app/services.call」被拒。

**3. Python 环境要配好。** 这个插件不是纯 Node 实现，解析靠外部 Python。没配的话，`extract` 会直接回 `PYTHON_PATH_NOT_CONFIGURED`，不会退回到系统 python 糊过去。

还有一件只影响读得到什么的事：服务接受任意绝对路径，没有目录白名单。边界落在两道授权上（它被授权对外提供服务、调用方被授权调用别的 App），而不是落在路径前缀上。卡片和工具同理。

---

## 二、怎么调

完整名字由宿主拼好，固定是 `app:doc-intake/<方法名>`。

```js
// 调用方 App 的代码里
const res = await sdk.bus.requestService(
  "app:doc-intake/extract",
  {
    sources: ["D:\\文档\\报告.pdf"],
    outputDir: "D:\\文档\\out",
  },
  { timeout: 60000 }
);
```

几点说明：

- `requestService` 要求完整名（`app:<id>/<方法>`），不带前缀会被本地拒绝。
- 第三个参数是请求选项。宿主默认等 30 秒，你预计要等更久就显式给一个毫秒数，只校验「正数且有限」，没有内部封顶。但请注意：**一次调用等上几分钟，占的是你自己的执行线**，长活请走「投递拿单号」那套。
- 也可以直接用 `ctx.bus.request("app:doc-intake/extract", payload, options)`，效果一样。
- 参数与返回值都必须是纯数据：普通对象、数组、字符串、数字、布尔、null，嵌套不超过 64 层。带函数、类实例、循环引用会被拒绝。

---

## 三、四个方法

### describe

问能力。参数基本是静态的，问一次就能记住。

```json
{
  "ok": true,
  "app": "doc-intake",
  "inputs": [ { "key": "sources", "type": "string[]", "required": true, "description": "…" } ],
  "backends": ["auto", "mineru", "oxr", "paddleocr", "mineru-local", "paddleocr-local", "local"],
  "formats": [".pdf", ".docx", ".png", "…"],
  "waits": { "defaultMs": 20000, "maxMs": 600000 },
  "markdown": "默认返回全文"
}
```

`inputs` 就是下面 `extract` 的入参表，字段名、类型、枚举都在里面，照着组参数即可。

### extract

投递一次解析。**返回有两种形状，先看 `state`。**

```json
// 等到了终态
{ "ok": true, "state": "done", "jobId": "dj_9f2c…", "files": [ /* 见第五节 */ ] }

// 到点还没跑完
{ "ok": true, "state": "running", "jobId": "dj_9f2c…",
  "progress": { "doneCount": 0, "total": 1,
                "files": [ { "name": "报告.pdf", "status": "running", "backend": "mineru", "pages": 12, "durationMs": 8400 } ] } }
```

入参：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sources` | 字符串数组 | 是 | 文件或目录的**绝对路径**；目录会被展开。也容忍单个字符串。相对路径直接拒。 |
| `outputDir` | 字符串 | 否 | 产物保存目录；留空按设置里的规则由解析器决定 |
| `backend` | 字符串 | 否 | 七个档位之一；缺省用设置里的默认档 |
| `pageRange` | 字符串 | 否 | 如 `1-20`；留空为全部 |
| `language` | 字符串 | 否 | 如 `zh` / `en`；缺省用设置里的默认语言 |
| `includeMedia` | 布尔 | 否 | 是否提取图片与媒体；缺省用设置值 |
| `saveJson` | 布尔 | 否 | 是否另存结构化 JSON；缺省用设置值 |
| `splitOnly` | 布尔 | 否 | 只做图片分割测试，不调用任何解析后端；只适用于图片，对其它文件会失败 |
| `summaryOnly` | 布尔 | 否 | 只回每个文件的状态，不返正文；会自动落盘，所以 `mdPath` 仍然可用 |
| `waitMs` | 数字 | 否 | 最多等多久再回，缺省 20000，上限 600000；`0` 表示只投递不等 |

「到点没跑完」不是失败。活已经独立跑起来了，跟这次调用还在不在没关系，拿 `jobId` 回来问就行。

### status

看进度。轻量，可以频繁问。

```json
{ "ok": true, "state": "running", "jobId": "dj_9f2c…", "doneCount": 1, "total": 3,
  "files": [ { "name": "报告.pdf", "status": "done", "backend": "mineru", "pages": 37,
               "durationMs": 32000, "error": null, "stage": "ok" } ] }
```

`status` 的取值只有 `running` / `done` / `failed`。单个文件的 `status` 另有一套：`pending` / `running` / `done` / `failed`。

查不到这个作业（过期或从没存在）会明确回 `JOB_NOT_FOUND`，不会含糊成「还在跑」。

### result

取结果。

```json
{ "ok": true, "state": "done", "jobId": "dj_9f2c…", "files": [ /* 见第五节 */ ] }
```

入参：`jobId`（必填）、`waitMs`（可选，缺省 0）、`includeMarkdown`（可选，缺省 `true`）。

`waitMs` 是长轮询：还没跑完就在这边挂着等，好了立刻回，到点还是没完就回 `state: "running"`。默认不等，因为「我现在有什么」这个方法默认阻塞二十秒很反直觉；想等的人自己给。

---

## 四、怎么判断这次到底成了没有

三层，别压成一层。

**第一层，这次请求的形状。** 看 `ok` 和 `state`：`ok: false` 是这次调用没成（参数或准入问题）；`state: "running"` 是活还没完；`state: "done"` 或 `"failed"` 是活已经结束。

**第二层，这次提取的整体结果。** `state: "done"` 只代表这批文件都跑完了，不代表全成功。整体成不成，看有多少个文件的 `status` 是 `success`。

**第三层，每个文件各自。** `files[].status` 是 `success` 或 `failed`，失败的 `files[].error` 里是一句人话。

注意别用「有没有 markdown 字段」去推断成功失败：扫描件可能识别出零个字，一份纯图片的 PDF 可能只剩几句图注，这些都是合法完成，正文就是空的。`charCount` 会如实给 0。

用 `summaryOnly` 时正文为空是正常的，路径仍然有效。

---

## 五、结果字段

每个文件一条：

| 字段 | 说明 |
|---|---|
| `name` | 文件名，不含目录 |
| `source` | 输入的原始路径 |
| `status` | `success` / `failed` |
| `error` | 失败原因，成功时为 null |
| `warnings` | 过程中的警告 |
| `backend` | 真实用到的后端（降级链走到哪一档就是哪一档） |
| `pages` | 页数，拿不到为 null |
| `durationMs` | 这个文件花了多久 |
| `mdPath` | 落盘的 Markdown 路径；没保存为 null |
| `jsonPath` | 结构化 JSON 路径，没另存为 null |
| `mediaPaths` | 提取出的媒体绝对路径数组 |
| `charCount` | 正文字数；拿不到正文时为 null |
| `markdown` | 正文全文，不截断；`includeMarkdown: false` 时没有这个键 |

---

## 六、错误码

失败一律是 `{ ok: false, code, error }`，`error` 是给人看的一句话，`code` 用来分支。

| code | 什么情况 |
|---|---|
| `NO_SOURCES` | 一条路径都没给 |
| `PATH_NOT_ALLOWED` | 传了相对路径（服务只接受绝对路径） |
| `PYTHON_PATH_NOT_CONFIGURED` | 被调方还没配 Python 环境 |
| `NO_FILES` | 路径展开后没有可解析的文件 |
| `EXPAND_FAILED` | 展开路径时出错 |
| `START_FAILED` | 建作业失败，或读不到设置 |
| `JOB_NOT_FOUND` | 单号不存在或已过期 |

---

## 七、三种典型写法

**只想要结果，文件不大。**

```js
const r = await sdk.bus.requestService("app:doc-intake/extract",
  { sources: [file] }, { timeout: 120000 });
if (r.state === "done") { /* 直接读 r.files[0].markdown */ }
else { /* 转成拿单号那条路 */ }
```

**文件大，或者一批很多。** 先投递只拿单号，自己决定什么时候来取。

```js
const start = await sdk.bus.requestService("app:doc-intake/extract",
  { sources: list, waitMs: 0 });
const jobId = start.jobId;
// …过一会儿
const r = await sdk.bus.requestService("app:doc-intake/result", { jobId, waitMs: 30000 });
```

**要边跑边报进度。** 用 `status`，建议间隔不低于 1 秒；想省事就改用 `result` 带 `waitMs` 长等，一次调用顶一轮轮询。

---

## 八、边界，先说清楚免得误会

- **服务不投递到对话、不弹卡片、不建宿主任务。** 它只回数据。想让结果进聊天，那是面板卡上「投递到对话」那条路的事。
- **正文只有本服务发起的作业才有。** 工具或面板发起的作业，`result` 能查到状态和落盘路径，但正文拿不到（`charCount` 给 null）。不编一个空串冒充。
- **作业记录 30 分钟过期。** 过期后 `status` / `result` 都回 `JOB_NOT_FOUND`，但已经落盘的文件还在，`mdPath` 请自己留好。
- **服务接受任意绝对路径。** 没有目录白名单。它能读到的范围，就是这个 App 进程本身能读到的范围；调用方则是用户亲手授权过的 App。
- **`waitMs` 上限 10 分钟。** 再长就该走拿单号那条路，而不是挂着一个调用等。
- **跨 App 真实调用已验证过一轮**（2026-11-22，用一个只做转发的探针 App 从调用方侧打进来）：`describe`、`extract`（local 后端 + HTML + 单文件）、`status`、`result` 四条都通，非法路径也按 `PATH_NOT_ALLOWED` 被拒。未覆盖：云端后端的长任务与 `waitMs` 到点转 `running`、多文件并发、`summaryOnly` 与 `splitOnly` 两条分支。探针代码在 `D:\Agent\svc-probe`，可以直接当调用示例拄。
