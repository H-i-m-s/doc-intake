// doc-intake 面板卡的路由。
//
// 面板卡（ui/panel.html）是用户自己点开、自己填的一张临时卡：选文件、定目录、
// 手动跑一次。两条端点：
//   GET  /panel-defaults  打开时读一次，把设置里同名的字段铺到表单上
//   POST /run             按下「开始提取」，展开路径并起一次后台作业
//
// 作业怎么跑不在这里：建作业、逐文件落状态、收尾都在 lib/job-runner.js，
// 批处理在 lib/extract-batch.js。这里只做三件事：校验入参、把设置翻译成
// 提取用的 ctx 和参数、把作业号交回面板。
//
// 这条入口和工具入口的区别只有「怎么收尾」：工具要建宿主任务、要在调用窗口里
// 回执；面板没有 callToken，所以不建任务、不往会话里投任何东西，面板自己轮询
// /job-status（routes/settings.js 里那条，不在这里重写）。
//
// 只读配置 + 起作业，不下发任何 Token：面板拿到的就是表单要的那几个默认值。

import { basename } from "node:path";

import { scheduleAutoCleanup } from "../lib/cleanup.js";
import { expandSourcesWithPython, processFiles } from "../lib/extract-batch.js";
import { startJob } from "../lib/job-runner.js";
import { getSettings } from "../lib/settings.js";

/** 后端档位。面板的下拉给的就是这几个，其余一律回落到设置里的默认档。 */
const BACKENDS = new Set(["auto", "mineru", "oxr", "paddleocr", "mineru-local", "paddleocr-local", "local"]);

/**
 * 规整入参里的 sources：去空、去首尾空白、去重。
 * 单个字符串也收（面板发的是数组，手搓请求的人不一定）。
 * 去重按小写比：Windows 上同一个路径换一种大小写就是同一个文件，
 * 保留第一次出现的那种写法，用户看到的路径跟他输入的一致。
 */
function normalizeSources(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === "string" ? [raw] : []);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export default function registerPanelRoutes(app, ctx) {
  app.get("/panel-defaults", async (c) => {
    try {
      const all = (await ctx?.config?.getAll?.()) || {};
      // getSettings 要的是同步取值的 ctx.config.get，而宿主这边只有异步的 getAll。
      // 一次性把原始配置拿全，再包一层薄壳喂进去：取值的归一化留在 lib 里，这里只做搬运。
      const settings = getSettings({ config: { get: (key) => all[key] } });
      return c.json({
        ok: true,
        defaults: {
          savePath: settings.savePath,
          defaultBackend: settings.defaultBackend,
          // 设置里的键叫 defaultLanguage，面板上那块输入框叫「语言」，
          // 对外统一成 language，面板不用知道后端字段名。
          language: settings.defaultLanguage,
          includeMedia: settings.includeMedia === true,
          saveJson: settings.saveJson === true,
          // 面板只关心「有没有配 Python」。真实依赖是否装齐由设置页的 /deps 探，
          // 那是要起子进程的事，不该在每次打开面板时都跑一遍。
          pythonReady: Boolean(settings.pythonPath),
        },
      });
    } catch (error) {
      // 读配置失败是一种能说清的结果，不是 500 裸错：面板照着手上的默认值继续画。
      return c.json({ ok: false, error: `读取默认值失败：${error?.message || error}` }, 200);
    }
  });

  // ---- 手动跑一次 -------------------------------------------------------
  // 返回的是作业号，不是解析结果：云端一个文件就可能跑几分钟，同步等一定超时，
  // 所以这里起完作业立刻回话，进度由面板自己拉 /job-status 追。
  app.post("/run", async (c) => {
    const body = await c.req.json().catch(() => ({}));

    // 1) 入参第一道：一条路径都没有就不用往下走了。
    const sources = normalizeSources(body?.sources);
    if (sources.length === 0) {
      return c.json({ ok: false, error: "没有可解析的路径" }, 400);
    }

    // 2) 配置读一次拿全，后面所有默认值都从 settings 出。
    let all = {};
    try {
      all = (await ctx?.config?.getAll?.()) || {};
    } catch (error) {
      return c.json({ ok: false, error: `读取配置失败：${error?.message || error}` }, 200);
    }
    const settings = getSettings({ config: { get: (key) => all[key] } });

    // 3) 没有 Python 就直接说清楚。退回系统 python 是最坏的兜底：
    //    跑起来的解释器不是用户装依赖的那一个，报出来的错会离真相很远。
    if (!settings.pythonPath) {
      return c.json({
        ok: false,
        code: "PYTHON_PATH_NOT_CONFIGURED",
        error: "还没配置 Python 环境，先去 App 设置里填写 pythonPath",
      }, 400);
    }

    // 4) 目录展开交给 Python 子进程：JS 侧没有 --allow-fs-read 覆盖用户目录，
    //    裸 fs 枚举会被权限模型挡掉（见 lib/extract-batch.js 的注释）。
    let expanded = [];
    try {
      expanded = await expandSourcesWithPython(settings.pythonPath, sources);
    } catch (error) {
      return c.json({ ok: false, error: `展开路径失败：${error?.message || error}` }, 200);
    }
    if (!Array.isArray(expanded) || expanded.length === 0) {
      return c.json({ ok: false, error: "没有找到可解析的文件" }, 400);
    }

    // 5) 自动清理在开头起个头就走，不 await（和工具入口同一处、同一时机）。
    //    放在开头而不是收尾：这时候本次要产出的文件还不存在，扫到的都是上一轮的。
    scheduleAutoCleanup({ settings, ctx, logger: ctx?.logger });

    // 6) 组装提取参数。
    //    面板上留空的项一律不传（不是传空串）：空串会被 Python 当成一个「填了但为空」
    //    的值，而缺项才是「按设置里的规则来」。
    const input = {
      backend: BACKENDS.has(trimmedString(body?.backend)) ? trimmedString(body.backend) : settings.defaultBackend,
      // 三档并发上限跟着设置走，和工具入口的 enrichedInput 保持一致。
      _apiConcurrency: settings.maxConcurrent ?? 4,
      _localConcurrency: settings.maxConcurrentLocal ?? 8,
      _legacyConversionConcurrency: settings.legacyConversionConcurrency ?? 1,
    };
    const outputDir = trimmedString(body?.outputDir);
    if (outputDir) input.outputDir = outputDir;
    const pageRange = trimmedString(body?.pageRange);
    if (pageRange) input.pageRange = pageRange;
    const language = trimmedString(body?.language);
    // 语言与两个开关有明确取值才覆盖，否则让 settings 里的值生效。
    if (language) input.language = language;
    if (typeof body?.includeMedia === "boolean") input.includeMedia = body.includeMedia;
    if (typeof body?.saveJson === "boolean") input.saveJson = body.saveJson;

    // 7) 提取用的 ctx：只给 logger 与一份同步取值的配置壳。
    //    extractDocument 内部会再读一次配置，所以这里必须挂上 config.get；
    //    不出网是因为云端请求全在 Python 子进程里发，JS 侧不需要宿主的网络出口。
    const extractCtx = { logger: ctx?.logger, config: { get: (key) => all[key] } };

    try {
      const { jobId } = await startJob({
        sources: expanded,
        input,
        ctx: extractCtx,
        settings,
        runBatch: processFiles,
        // 没有 onFinish：面板不需要回执，结论它自己轮询 /job-status 拿。
        // 这里不建宿主任务，也就没有 taskId 要收尾。
      });
      return c.json({
        ok: true,
        jobId,
        count: expanded.length,
        // 只回文件名：面板拿它先把结果区的行摆出来，完整路径它用不上。
        files: expanded.map((source) => basename(source)),
      });
    } catch (error) {
      return c.json({ ok: false, error: `发起解析失败：${error?.message || error}` }, 200);
    }
  });
}
