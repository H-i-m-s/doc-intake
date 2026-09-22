/**
 * extension-contract.ts — generated from shared/extension-contract.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * extension-contract.ts — 扩展平台与扩展市场共用的最小契约：kind 取值、
 * permission 声明形状、id/capability 名称校验。
 *
 * 这几样本来分别在 lib/extension-platform/types.ts（运行时安装/注册表的权威
 * 定义）与 shared/extension-market-index.ts（市场 wire schema 的独立镜像）
 * 各存一份，靠头注释互相提醒"改一边记得改另一边"——注释不是编译器，两份定义
 * 迟早会漂开。shared/ 是 lib/ 的下游、不能反向 import lib/ 下的模块，但这几个
 * 定义本身不依赖任何扩展平台的运行时状态（注册表、安装记录都不在这里），
 * 所以把它们下沉到 shared/ 是唯一能让两个上游都直接引用同一份定义的办法：
 * lib/extension-platform/types.ts 从这里 re-export（见该文件），
 * shared/extension-market-index.ts 直接 import（同层，不违反分层）。
 */
/** 六种扩展 kind。product 顺序，不是字母序。 */
export type ExtensionKind = "app" | "skill" | "recipe" | "connector" | "role" | "bundle";
export declare const EXTENSION_KINDS: readonly ExtensionKind[];
export declare function isExtensionKind(v: unknown): v is ExtensionKind;
export interface PermissionDeclaration {
    capability: string;
    scope?: Record<string, unknown>;
    reason?: string;
}
/** manifest/市场条目的 id：小写字母数字加 . _ -，不能以 . / - 收尾，不能出现 .. 或 --。 */
export declare function isSafeExtensionId(id: unknown): id is string;
/** capability 名称：恰好一个内部斜杠，形如 "<namespace>/<name>"。 */
export declare function isCapabilityName(value: unknown): value is string;
//# sourceMappingURL=extension-contract.d.ts.map