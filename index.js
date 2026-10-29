// doc-intake v2 App 入口。
//
// Agent 工具的实现仍放在 tools/*.js，本文件只负责：
//   1) 用 sdk.config 读一次设置，包成 { config: { get } } 适配层，
//      喂给原本同步调用 ctx.config.get 的 lib/settings.js（那里零改动）；
//   2) 经 sdk.tools.register 注册工具，并把 v2 的单参数 execute 调用
//      拆回工具模块期望的 (input, ctx) 签名；
//   3) 把存储、网络出口和 logger 一并挂进工具 ctx，供 Token 健康状态使用
//      （它要落盘结论，偶尔还要借宿主出口探一次，详见 lib/token-status.js）。
//
// Token 有效性探测本身不是工具，是设置页的动作（见 routes/settings.js
// 的 /validate、/token-status/* 与 lib/validate.js）。工具侧只做两件事：把提取时
// 真实撞到的鉴权拒绝记下来，以及把已有结论转成一句提醒带回去。

import { defineApp } from "./sdk/app-contract/server-client.js";
import * as toolDocIntake from "./tools/doc_intake.js";

export const name = "doc-intake";

const TOOL_MODULES = [toolDocIntake];

export default defineApp(async (sdk) => {
  // 启动日志带上两个能力探测结果：Token 健康状态要用存储落盘、偶尔借宿主网络出口探一次，
  // 这两样缺任何一样都会静默退化成"不提示"，所以把它写在启动行里，以后看日志一眼就能排除。
  await sdk.logger.info(
    "doc-intake v2 loaded"
    + ` | token-status storage=${typeof sdk?.storage?.global?.set === "function" ? "on" : "MISSING"}`
    + ` net=${typeof sdk?.network?.fetch === "function" ? "on" : "MISSING"}`,
  );

  for (const mod of TOOL_MODULES) {
    await sdk.tools.register({
      name: mod.name,
      description: mod.description,
      parameters: mod.parameters,
      execute: async (args, hostContext) => {
        const raw = args && typeof args === "object" ? args : {};
        const { context: _context, ...input } = raw;
        // 宿主有两种派发风格：sdk_tool 把调用上下文塞在参数对象里，pi_tool 走第二个参数。
        // 两种都接，免得拿不到 callToken 时后台跑完的结果无处可投。
        const toolContext = raw.context && typeof raw.context === "object"
          ? raw.context
          : (hostContext && typeof hostContext === "object" ? hostContext : {});
        const config = (await sdk.config.getAll()) || {};
        await sdk.logger.info(
          "tool context keys: "
          + `${Object.keys(toolContext).sort().join(",") || "(empty)"}`
          + ` | callToken=${toolContext.callToken ? "yes" : "no"}`
          + ` | sessionPath=${toolContext.sessionPath ? "yes" : "no"}`
          + ` | secondArg=${hostContext && typeof hostContext === "object" ? "yes" : "no"}`,
        );
        const ctx = {
          config: { get: (key) => config[key] },
          // App 进程没有 --allow-net，出网只能借宿主代发的出口；它受 manifest
          // 顶层 network.allowedHosts 约束（MinerU 与 PaddleOCR 那两个域名已声明）。
          network: sdk.network,
          storage: sdk.storage,
          logger: sdk.logger,
          // 工具要自己建宿主任务、拿调用凭据，所以把这两样往下传；
          // 只传用得到的字段，不把整个 invocation 丢给工具模块。
          sdk,
          invocation: {
            callToken: toolContext.callToken ?? null,
            sessionId: toolContext.sessionId ?? null,
            sessionPath: toolContext.sessionPath ?? null,
            messageId: toolContext.messageId ?? null,
          },
        };
        return await mod.execute(input, ctx);
      },
    });
  }

  // 后端路由只能有一个来源：宿主扫描 routes/*.js，与 sdk.routes.register 互斥。
  // 进度的 /job-status 因此在 routes/settings.js 里注册，这里不再另开一条。
});
