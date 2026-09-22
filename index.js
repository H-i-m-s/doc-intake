// doc-intake v2 App 入口。
//
// 两个 Agent 工具的实现仍放在 tools/*.js，本文件只负责：
//   1) 用 sdk.config 读一次设置，包成 { config: { get } } 适配层，
//      喂给原本同步调用 ctx.config.get 的 lib/settings.js（那里零改动）；
//   2) 经 sdk.tools.register 注册工具，并把 v2 的单参数 execute 调用
//      拆回工具模块期望的 (input, ctx) 签名。

import { defineApp } from "./sdk/app-contract/server-client.js";
import * as toolDocIntake from "./tools/doc_intake.js";
import * as toolValidate from "./tools/doc_intake_validate.js";

export const name = "doc-intake";

const TOOL_MODULES = [toolDocIntake, toolValidate];

export default defineApp(async (sdk) => {
  await sdk.logger.info("doc-intake v2 loaded");

  for (const mod of TOOL_MODULES) {
    await sdk.tools.register({
      name: mod.name,
      description: mod.description,
      parameters: mod.parameters,
      execute: async (invocation) => {
        const raw = invocation && typeof invocation === "object" ? invocation : {};
        const { context: _context, ...input } = raw;
        const config = (await sdk.config.getAll()) || {};
        const ctx = { config: { get: (key) => config[key] } };
        return await mod.execute(input, ctx);
      },
    });
  }
});
