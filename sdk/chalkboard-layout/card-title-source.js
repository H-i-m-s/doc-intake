/**
 * chalkboard-layout/card-title-source.ts — generated from shared/chalkboard-layout/card-title-source.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * 卡标题来源（persisted）与 App 卡标题纯解析。
 *
 * 布局文档上每张卡可以选择携带 `titleSource`：
 * - `'manifest'`：标题由 manifest / 目录（catalog）在创建时写入，属于宿主提供的
 *   初始值。App Chrome 的运行态动态标题允许覆盖它（动态标题不落 layout）。
 * - `'user'`：用户显式重命名过，优先级最高，动态标题不再覆盖。
 *
 * 历史记录没有该字段：实例标题非空时读取按 `'user'` 对待（不覆盖、不批量改写
 * 老记录），为空时按缺省 `'manifest'` 层处理。字段是 optional，不引入新的 schema
 * 版本或迁移。
 *
 * 本模块是叶子模块（不 import 任何 chalkboard-layout 兄弟文件），因此
 * `layout-document.ts` / `chalkboard-card-types.ts` 可以安全地只取类型，不会形成
 * 类型环。解析函数是纯函数：只按显式输入排序，不读全局状态、不落库。动态标题是
 * 运行态（App Chrome runtime），本模块不提前声称两壳已消费它，接入由后续 shell
 * 完成。
 */
export function isAppCardTitleSource(value) {
    return value === 'user' || value === 'manifest';
}
/**
 * 读时归一化持久 `titleSource`：合法值原样返回，非法值（任意其它字符串、数字、
 * 对象、null）返回 `undefined`——兼容缺字段并显式丢弃脏值，不猜测、不按某个
 * 字符串反推来源。调用方据此把脏值当"未标记"处理，不写回默认值。
 */
export function normalizeAppCardTitleSource(value) {
    return isAppCardTitleSource(value) ? value : undefined;
}
/**
 * v2 App 卡（channel === 'app'）由 manifest / 目录初始化时的持久标记。非 App
 * （v1、无 channel）返回 `undefined`，保持旧行为（标签直接用作标题，不参与动态
 * 覆盖）。
 */
export function manifestTitleSourceForChannel(channel) {
    return channel === 'app' ? 'manifest' : undefined;
}
/** 统一的 trim / 空值判定：非字符串或 trim 后为空一律 null。 */
function nonEmptyTitle(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
/**
 * 纯标题解析：user > dynamic > manifest > id。
 *
 * 持久来源只决定实例标题算哪一层：`'user'` 压住动态标题；`'manifest'` 让动态标题
 * 覆盖它。历史记录（无字段）在实例标题非空时读作 `'user'`，空时按 manifest 层回落。
 * 用户显式写下的空标题沿用既有用户操作语义（标题就是空），此时继续落到动态 /
 * manifest / id，不用空串去"删除" manifest 层。只对 App 消费者采用，非 App 输出
 * 旧行为不变。
 */
export function resolveAppCardTitle(input) {
    const instanceTitle = nonEmptyTitle(input.instanceTitle);
    const source = normalizeAppCardTitleSource(input.titleSource) ?? (instanceTitle ? 'user' : 'manifest');
    if (source === 'user' && instanceTitle) {
        return { title: instanceTitle, origin: 'user' };
    }
    const runtimeTitle = nonEmptyTitle(input.runtimeTitle);
    if (runtimeTitle) {
        return { title: runtimeTitle, origin: 'dynamic' };
    }
    const manifestTitle = nonEmptyTitle(input.manifestTitle)
        ?? (source === 'manifest' ? instanceTitle : null);
    if (manifestTitle) {
        return { title: manifestTitle, origin: 'manifest' };
    }
    return { title: nonEmptyTitle(input.fallbackId) ?? '', origin: 'id' };
}
//# sourceMappingURL=card-title-source.js.map