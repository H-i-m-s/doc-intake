# svc-probe —— 跨 App 调用 doc_intake 的最小可运行示例

这是一个只有几十行的 App，只做一件事：**从另一个 App 的进程里调用 doc-intake 的对外服务，把结果原样吐回来。** 它既是探针，也是一份可以照抄的调用例子。

之所以要拿它做参考，是因为「服务注册好了」和「别人真能调进来」是两件事。三个门槛都只有站在**调用方**这一侧才看得见：

1. 宿主是否按 `allowCrossApp` 放行这次跨 App 调用；
2. 调用方的 `app/services.call` 能力有没有被批准；
3. 被调方注册服务的那一刻，`app/services.provide` 是否已经在。

在 doc-intake 自己的进程里验，只能验到处理器本身（参数校验、准入、返回形状），验不到上面三道。

## 文件

```
manifest.json      两个能力：app/services.call 与 app/tools.expose-to-model
index.js           全部逻辑，一百来行，含注册工具与调用
assets/icon.png    图标
```

## 关于没带的 sdk/

原 App 目录下有一份 `sdk/`（宿主契约的副本，约 100 KB），这里**故意没放**：它是宿主那边的东西，跟着宿主版本走，放进参考目录只会过期。

`index.js` 第一行是 `import { defineApp } from "./sdk/app-contract/server-client.js"`。要真跑起来，得让 `svc-probe` 目录下有 `sdk/`：

- 用脚手架重建时，脚手架会把它补进去；
- 或者直接从机器上任意一个 v2 App 目录里拷一份 `sdk/` 过来（内容是同一份宿主契约）。

## 怎么用

装好之后，它的工具叫 `doc_intake_probe`，四个动作对应 doc-intake 的四个服务方法：

```
action: "describe"   → app:doc-intake/describe   列方法与参数
action: "extract"    → app:doc-intake/extract    发起一次解析
action: "status"     → app:doc-intake/status     查任务进度
action: "result"     → app:doc-intake/result     取回结果
payload              → 原样透传给该方法
timeoutMs            → 这次调用最多等多久，默认 60000
```

调用成功时返回宿主的原始 JSON；失败时返回宿主的 `code` 与 `message`，**不做中文包装**——`APP_SERVICE_CROSS_APP_DENIED`、`APP_CAPABILITY_DENIED`、`APP_SERVICE_TIMEOUT` 这些名字本身就是结论，套一层话术反而看不清卡在哪一步。

## 最容易踩的一处

服务全名必须写成 `app:<App id>/<方法名>`，也就是 `app:doc-intake/extract`。少了 `app:` 前缀，或者把 App id 写成显示名，宿主会按另一条路由去找，拿到的就是「服务不存在」。
