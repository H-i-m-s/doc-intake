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
import { configureJobsStore, loadJobs } from "./lib/jobs.js";
import { configureCleanupLog } from "./lib/cleanup-log.js";
import { getSettings } from "./lib/settings.js";
import { configureMineruService } from "./lib/mineru-service.js";
import { createServiceHandlers } from "./lib/service-api.js";
import * as toolDocIntake from "./tools/doc_intake.js";

export const name = "doc-intake";

const TOOL_MODULES = [toolDocIntake];

export default defineApp(async (sdk) => {
  // 作业表要落盘：进度卡是聊天流里的一条历史，用户切走会话再回来时，
  // 记录只在内存里就等于卡片回来时查不到任务（App 进程不保证还活着）。
  // 目录只能用宿主给的 dataDir，App 自己猜路径在宿主换存储布局后会静默写丢。
  const jobsStore = configureJobsStore({ dataDir: sdk.dataDir, logger: sdk.logger });
  // 读回上一个进程留下的记录；读坏了退成空表，返回值就是真正收下的条数。
  const restoredJobs = loadJobs();
  // 清理记录跟着 dataDir 走。它不在保存目录里，清理动作碰不到自己。
  const cleanupLog = configureCleanupLog({ dataDir: sdk.dataDir });
  // 自管 MinerU 实例的 service.json / activity / service.log 都放这里。
  // 只能来自宿主给的 dataDir：自己猜路径，宿主换存储布局后会静默写丢。
  configureMineruService({ dataDir: sdk.dataDir, logger: sdk.logger });

  // 启动日志带上两个能力探测结果：Token 健康状态要用存储落盘、偶尔借宿主网络出口探一次，
  // 这两样缺任何一样都会静默退化成"不提示"，所以把它写在启动行里，以后看日志一眼就能排除。
  // 作业表存在哪儿同理：持久化没开，卡片在重启后失效，也是只能从日志里看出来的事。
  await sdk.logger.info(
    "doc-intake v2 loaded"
    + ` | token-status storage=${typeof sdk?.storage?.global?.set === "function" ? "on" : "MISSING"}`
    + ` net=${typeof sdk?.network?.fetch === "function" ? "on" : "MISSING"}`
    + ` | jobs-store=${jobsStore.enabled ? "on" : "MISSING"} restored=${restoredJobs}`
    + ` | cleanup-log=${cleanupLog.enabled ? "on" : "MISSING"}`,
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

  // ---- 对外开放的服务 ----------------------------------------------------
  // 别的 App 可以直接调这四个方法（宿主把完整名固定成 app:doc-intake/<方法名>），
  // 不经过模型。它们不建宿主任务、不往会话投东西、不弹卡片、不写全局存储。
  //
  // 注册需要用户已授予 app/services.provide（默认关闭）。没授予时 handle 会抛
  // APP_CAPABILITY_DENIED：这里逐条接住并记一条日志，绝不让 App 启动失败 ——
  // 工具与卡片照常可用，只是外部调不到。授权之后要重载 App，注册才会重新走一遍。
  const serviceHandlers = createServiceHandlers({
    // 读配置的写法与工具入口保持同一套：原始配置 + getSettings 归一。
    readSettings: async () => {
      const raw = (await sdk.config.getAll()) || {};
      return getSettings({ config: { get: (key) => raw[key] } });
    },
    logger: sdk.logger,
  });
  for (const [method, handler] of Object.entries(serviceHandlers)) {
    try {
      // allowCrossApp：别的 App 也能调。不给这一项就只本 App 自己能用，
      // 而对一个对外服务来说「只有自己能调」等于没开。
      await sdk.bus.handle(method, handler, { allowCrossApp: true });
      // 成功也要留一行：以前只有失败会写日志，结果是“没报错”和“压根没跑”分不开。
      // 这条日志是以后排查“别的 App 调不进来”的起点。
      try {
        await sdk.logger.info(`服务已注册：app:doc-intake/${method}（allowCrossApp）`);
      } catch { /* 日志失败不影响注册 */ }
    } catch (error) {
      // 记日志本身也不允许把启动带崩，两层各管一层。
      try {
        await sdk.logger.info(`服务未注册（${method}）：${error?.message || error}；授权后需重载 App`);
      } catch { /* 日志都失败就只能放弃了，但启动照旧继续 */ }
    }
  }
});
