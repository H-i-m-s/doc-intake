// doc-intake 面板卡的路由。
//
// 面板卡（ui/panel.html）是用户自己点开、自己填的一张临时卡：选文件、定目录、
// 手动跑一次。它打开时读一次这里的 /panel-defaults，把设置里同名的字段铺到表单上
// —— 用户改了设置，面板上的默认值就跟着变，不需要在面板里再维护一套。
//
// 口径只维护一份：默认值走 lib/settings.js 的 getSettings，那边负责缺省补齐、
// 路径归一、旧键兼容（比如 includeImages 退化成 includeMedia）。这里不重复实现，
// 否则设置页与面板对同一个键给出两种解释。
//
// 只读、只出展示需要的字段：Token、密钥这类东西一律不从这个端点出去。

import { getSettings } from "../lib/settings.js";

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
}
