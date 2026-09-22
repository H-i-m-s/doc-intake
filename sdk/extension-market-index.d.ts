/**
 * extension-market-index.ts — generated from shared/extension-market-index.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * extension-market-index.ts — 扩展市场索引 v2 schema：纯类型 + 校验，无 IO
 *
 * 覆盖六种 kind（app / skill / recipe / connector / role / bundle）的统一市场
 * 索引形状。这是一份"源发布什么、市场怎么读"的 wire schema。kind 取值、
 * permission 声明的形状、id 与 capability 名称的校验规则不在这里自己声明
 * 一份——直接从 shared/extension-contract.ts 引入那份唯一定义（同属
 * shared/，互相 import 不违反分层；只有 shared/ 反向 import lib/ 才违反，
 * 而这几样定义本就与扩展平台的运行时状态无关）。之前这里各自维护一份、
 * 靠头注释提醒"改一边记得改另一边"的镜像已经删除。市场条目的 permissions
 * 字段本就是未经信任的网络数据、仅供"安装前审查卡"展示，真正生效的权限来自
 * 包内 manifest（下一片对接注册表时会在边界重新校验一次并互相比对，见
 * lib/extension-platform/registry.ts 的安装确认路径）。
 *
 * 校验策略是"整份 vs 逐条"两级：schemaVersion 不对、顶层字段缺失或类型错误
 * 时整份拒绝（调用方——lib/remote-data/refresh-channel.ts 的 validatePayload
 * 契约——据此把这次下载判定为 unavailable）；items 数组内某一条目自身非法时
 * 只丢弃该条目并记一条 warning，不连累整份索引（工程底线第 7 条：故障可见，
 * 但爆炸半径收敛到出错的那个单元）。
 */
import { type ExtensionKind, type PermissionDeclaration } from "./extension-contract.js";
export declare const MARKET_INDEX_SCHEMA_VERSION = 2;
export declare const MAX_MARKET_ARCHIVE_BYTES: number;
export interface MarketArchive {
    url: string;
    sha256: string;
    size: number;
    format: "zip";
}
export interface MarketItemVersion {
    version: string;
    minAppVersion?: string;
    archive: MarketArchive;
}
export interface MarketItemCompatibility {
    minAppVersion?: string;
    formFactors?: string[];
}
export interface MarketItemV2 {
    kind: ExtensionKind;
    id: string;
    name: string;
    publisher: string;
    description: string;
    version: string;
    versions?: MarketItemVersion[];
    archive: MarketArchive;
    permissions: PermissionDeclaration[];
    compatibility?: MarketItemCompatibility;
    homepage?: string;
    repository?: string;
    license?: string;
    icon?: string;
    categories?: string[];
    keywords?: string[];
    readmeUrl?: string;
}
export interface MarketIndexV2 {
    schemaVersion: 2;
    sourceId: string;
    name: string;
    publishedAt: string;
    items: MarketItemV2[];
}
export type ValidateMarketIndexResult = {
    index: MarketIndexV2;
    warnings: string[];
} | {
    errors: string[];
};
/**
 * 校验一份 unknown 原始市场索引值。
 *
 * 整份拒绝的情形（返回 `{ errors }`）：不是对象、schemaVersion 不是 2、或
 * sourceId/name/publishedAt/items 缺失或类型错误——这些字段是索引本身的
 * 身份与调度依据（publishedAt 是刷新通道的单调门），坏了整份都不可信。
 *
 * 逐条丢弃的情形（计入返回值 `{ index, warnings }` 的 warnings）：items
 * 数组里某一条目自身不合法。合法条目原样进入 index.items，不合法条目被
 * 跳过且不改写其余字段——这里不做任何字段补全/规范化。
 */
export declare function validateMarketIndexV2(raw: unknown): ValidateMarketIndexResult;
/**
 * 一份合法但比当前读者认识的 schema 更新的索引——schemaVersion 是数字且
 * 大于 2。lib/remote-data/refresh-channel.ts 的 UNSUPPORTED_SCHEMA 约定
 * 只应该用在这种"合法但更新"的场景（spec 用语见该文件头注释），不能用在
 * 任何其他整份校验失败上，否则一份单纯损坏的索引会被误判成"只是版本更新"
 * 而不再重试/报错。
 */
export declare function isForwardCompatibleMarketIndex(raw: unknown): boolean;
//# sourceMappingURL=extension-market-index.d.ts.map