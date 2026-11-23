// svc-probe —— 一个只做一件事的探针 App。
//
// 它存在的理由：doc-intake 对外注册了四个服务方法，但「别的 App 能不能真的调进来」
// 这一层，在被调方自己的进程里验不出来。那边能验的只有处理器本身（参数、准入、返回形状）。
// 真正的门槛有三道：宿主是否按 allowCrossApp 放行、调用方的 app/services.call 是否被批、
// 被调方的 app/services.provide 是否在注册时就在。这三道只有站在调用方这一侧才看得到。
//
// 所以这里不实现任何业务，只把调用结果原样交回去：成功就给原始 JSON，失败就给
// 宿主抛出的 code 与 message。它同时是一份可以直接照抄的调用示例。

import { defineApp } from "./sdk/app-contract/server-client.js";

/** 只暴露这四个方法：和被调方 describe 里列的完全一致，不多不少。 */
const ACTIONS = ["describe", "extract", "status", "result"];

const PROBE = {
  name: "doc_intake_probe",
  description:
    "从本 App 调用 doc-intake 的对外服务并原样返回结果，用于验证跨 App 服务调用是否可用。"
    + "action 选 describe / extract / status / result；payload 是传给该方法的原样参数。",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ACTIONS, description: "要调用的方法名" },
      payload: { type: "object", description: "该方法的原样参数；describe 可以为空" },
      timeoutMs: { type: "number", description: "这次调用最多等多久（毫秒）。默认 60000" },
    },
    required: ["action"],
  },
};

export const name = "svc-probe";

export default defineApp(async (sdk) => {
  await sdk.tools.register({
    ...PROBE,
    async execute(args) {
      const action = typeof args?.action === "string" ? args.action.trim() : "";
      if (!ACTIONS.includes(action)) {
        return {
          content: [{ type: "text", text: `action 只认 ${ACTIONS.join(" / ")}，收到「${action}」` }],
          details: { ok: false, stage: "input" },
        };
      }
      const payload = args && typeof args.payload === "object" && args.payload !== null ? args.payload : {};
      const timeoutRaw = Number(args?.timeoutMs);
      const options = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? { timeout: Math.floor(timeoutRaw) } : { timeout: 60000 };

      // 完整名必须带 app: 前缀和 App id，宿主按这个形状路由。
      const service = `app:doc-intake/${action}`;
      try {
        const result = await sdk.bus.requestService(service, payload, options);
        const text = JSON.stringify(result, null, 2) ?? "null";
        return {
          content: [{ type: "text", text: `${service} 调用成功：\n${text.slice(0, 12000)}` }],
          details: { ok: true, service, result },
        };
      } catch (error) {
        // 失败时把宿主给的 code 原样带出来：APP_SERVICE_CROSS_APP_DENIED、APP_CAPABILITY_DENIED、
        // APP_SERVICE_TIMEOUT 这些名字本身就是结论，套一层中文反而看不清卡在哪一步。
        const code = typeof error?.code === "string" ? error.code : "(无 code)";
        const message = error?.message || String(error);
        return {
          content: [{ type: "text", text: `${service} 调用失败：\ncode=${code}\nmessage=${message}` }],
          isError: true,
          details: { ok: false, service, code, message },
        };
      }
    },
  });
});
