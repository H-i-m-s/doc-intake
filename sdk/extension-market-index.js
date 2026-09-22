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
import { EXTENSION_KINDS, isCapabilityName, isExtensionKind, isSafeExtensionId, } from "./extension-contract.js";
export const MARKET_INDEX_SCHEMA_VERSION = 2;
// 上一代插件安装通道（lib 里那个已不在本仓库的旧市场模块）用的同一个包
// 体积上限，延续沿用，常量放在这里而不是抓取层，因为"多大算太大"是索引
// 数据本身的语义边界，不是传输层的关注点。
export const MAX_MARKET_ARCHIVE_BYTES = 50 * 1024 * 1024;
// ---------------------------------------------------------------------------
// 基础谓词：这份 wire schema 自己的通用类型守卫。id 与 capability 名称校验
// 不在这里——用的是上面从 shared/extension-contract.ts 引入的
// isSafeExtensionId / isCapabilityName。
// ---------------------------------------------------------------------------
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isHttpsUrl(value) {
    if (typeof value !== "string" || !value)
        return false;
    try {
        return new URL(value).protocol === "https:";
    }
    catch {
        return false;
    }
}
function isSha256Hex(value) {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}
function isParseableDate(value) {
    return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}
// ---------------------------------------------------------------------------
// 逐条校验：单条 MarketArchive / MarketItemVersion / MarketPermissionDeclaration
// / MarketItemV2。任何一处不满足，调用方把整条 MarketItemV2 丢弃并记 warning
// ——不在这一层内部再区分"哪个子字段坏了就单独丢子字段"，市场条目要么是一份
// 完整可信的安装候选，要么整条不展示，不存在"半条"状态。
// ---------------------------------------------------------------------------
function describeArchive(archive, path) {
    if (!isPlainObject(archive))
        return `${path} must be an object`;
    if (!isHttpsUrl(archive.url))
        return `${path}.url must be an https URL`;
    if (!isSha256Hex(archive.sha256))
        return `${path}.sha256 must be 64 lowercase hex characters`;
    if (!isPositiveInteger(archive.size))
        return `${path}.size must be a positive integer`;
    if (archive.size > MAX_MARKET_ARCHIVE_BYTES) {
        return `${path}.size exceeds the ${MAX_MARKET_ARCHIVE_BYTES} byte limit`;
    }
    if (archive.format !== "zip")
        return `${path}.format must be "zip"`;
    return null;
}
function describePermission(permission, path) {
    if (!isPlainObject(permission))
        return `${path} must be an object`;
    if (!isCapabilityName(permission.capability)) {
        return `${path}.capability must be a "<namespace>/<name>" string`;
    }
    if (permission.scope !== undefined && !isPlainObject(permission.scope))
        return `${path}.scope must be an object`;
    if (permission.reason !== undefined && typeof permission.reason !== "string") {
        return `${path}.reason must be a string`;
    }
    return null;
}
function describeItemVersion(entry, path) {
    if (!isPlainObject(entry))
        return `${path} must be an object`;
    if (!isNonEmptyString(entry.version))
        return `${path}.version must be a non-empty string`;
    if (entry.minAppVersion !== undefined && !isNonEmptyString(entry.minAppVersion)) {
        return `${path}.minAppVersion must be a non-empty string`;
    }
    return describeArchive(entry.archive, `${path}.archive`);
}
function describeCompatibility(value, path) {
    if (!isPlainObject(value))
        return `${path} must be an object`;
    if (value.minAppVersion !== undefined && !isNonEmptyString(value.minAppVersion)) {
        return `${path}.minAppVersion must be a non-empty string`;
    }
    if (value.formFactors !== undefined && !isStringArray(value.formFactors)) {
        return `${path}.formFactors must be an array of strings`;
    }
    return null;
}
/** 校验单条市场条目；返回 null 表示合法，否则返回一条人类可读的失败原因。 */
function describeMarketItem(raw, path) {
    if (!isPlainObject(raw))
        return `${path} must be an object`;
    if (!isExtensionKind(raw.kind)) {
        return `${path}.kind must be one of ${EXTENSION_KINDS.join(", ")}`;
    }
    if (!isSafeExtensionId(raw.id))
        return `${path}.id is not a safe extension id`;
    if (!isNonEmptyString(raw.name))
        return `${path}.name must be a non-empty string`;
    if (!isNonEmptyString(raw.publisher))
        return `${path}.publisher must be a non-empty string`;
    if (typeof raw.description !== "string")
        return `${path}.description must be a string`;
    if (!isNonEmptyString(raw.version))
        return `${path}.version must be a non-empty string`;
    const archiveError = describeArchive(raw.archive, `${path}.archive`);
    if (archiveError)
        return archiveError;
    if (!Array.isArray(raw.permissions))
        return `${path}.permissions must be an array`;
    for (let index = 0; index < raw.permissions.length; index += 1) {
        const permissionError = describePermission(raw.permissions[index], `${path}.permissions[${index}]`);
        if (permissionError)
            return permissionError;
    }
    if (raw.versions !== undefined) {
        if (!Array.isArray(raw.versions))
            return `${path}.versions must be an array`;
        for (let index = 0; index < raw.versions.length; index += 1) {
            const versionError = describeItemVersion(raw.versions[index], `${path}.versions[${index}]`);
            if (versionError)
                return versionError;
        }
    }
    if (raw.compatibility !== undefined) {
        const compatibilityError = describeCompatibility(raw.compatibility, `${path}.compatibility`);
        if (compatibilityError)
            return compatibilityError;
    }
    if (raw.homepage !== undefined && typeof raw.homepage !== "string")
        return `${path}.homepage must be a string`;
    if (raw.repository !== undefined && typeof raw.repository !== "string")
        return `${path}.repository must be a string`;
    if (raw.license !== undefined && typeof raw.license !== "string")
        return `${path}.license must be a string`;
    if (raw.icon !== undefined && typeof raw.icon !== "string")
        return `${path}.icon must be a string`;
    if (raw.categories !== undefined && !isStringArray(raw.categories))
        return `${path}.categories must be an array of strings`;
    if (raw.keywords !== undefined && !isStringArray(raw.keywords))
        return `${path}.keywords must be an array of strings`;
    if (raw.readmeUrl !== undefined && typeof raw.readmeUrl !== "string")
        return `${path}.readmeUrl must be a string`;
    return null;
}
function itemLabel(raw, index) {
    if (isPlainObject(raw) && typeof raw.id === "string" && raw.id)
        return raw.id;
    return `#${index}`;
}
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
export function validateMarketIndexV2(raw) {
    if (!isPlainObject(raw))
        return { errors: ["market index must be a JSON object"] };
    if (raw.schemaVersion !== MARKET_INDEX_SCHEMA_VERSION) {
        return { errors: [`unsupported market index schemaVersion: ${JSON.stringify(raw.schemaVersion)}`] };
    }
    if (!isNonEmptyString(raw.sourceId))
        return { errors: ["sourceId must be a non-empty string"] };
    if (!isNonEmptyString(raw.name))
        return { errors: ["name must be a non-empty string"] };
    if (!isParseableDate(raw.publishedAt))
        return { errors: ["publishedAt must be a parseable date string"] };
    if (!Array.isArray(raw.items))
        return { errors: ["items must be an array"] };
    const items = [];
    const warnings = [];
    raw.items.forEach((entry, index) => {
        const failureReason = describeMarketItem(entry, `items[${index}]`);
        if (failureReason) {
            warnings.push(`dropped market item ${itemLabel(entry, index)}: ${failureReason}`);
            return;
        }
        items.push(entry);
    });
    return {
        index: {
            schemaVersion: MARKET_INDEX_SCHEMA_VERSION,
            sourceId: raw.sourceId,
            name: raw.name,
            publishedAt: raw.publishedAt,
            items,
        },
        warnings,
    };
}
/**
 * 一份合法但比当前读者认识的 schema 更新的索引——schemaVersion 是数字且
 * 大于 2。lib/remote-data/refresh-channel.ts 的 UNSUPPORTED_SCHEMA 约定
 * 只应该用在这种"合法但更新"的场景（spec 用语见该文件头注释），不能用在
 * 任何其他整份校验失败上，否则一份单纯损坏的索引会被误判成"只是版本更新"
 * 而不再重试/报错。
 */
export function isForwardCompatibleMarketIndex(raw) {
    return isPlainObject(raw)
        && typeof raw.schemaVersion === "number"
        && raw.schemaVersion > MARKET_INDEX_SCHEMA_VERSION;
}
//# sourceMappingURL=extension-market-index.js.map