function parseChalkboardMediaSourceVersion(rawVersion) {
    if (!rawVersion || typeof rawVersion !== 'object' || Array.isArray(rawVersion))
        return undefined;
    const version = rawVersion;
    const mtimeMs = Number(version.mtimeMs);
    const size = Number(version.size);
    if (!Number.isFinite(mtimeMs) || !Number.isFinite(size))
        return undefined;
    return {
        mtimeMs,
        size,
        ...(typeof version.sha256 === 'string' && version.sha256
            ? { sha256: version.sha256 }
            : {}),
    };
}
function isPlainFilename(value) {
    const trimmed = value.trim();
    return !!trimmed
        && trimmed !== '.'
        && trimmed !== '..'
        && !trimmed.includes('/')
        && !trimmed.includes('\\');
}
export function normalizeChalkboardMediaResourceTarget(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const candidate = value;
    const sourceVersion = parseChalkboardMediaSourceVersion(candidate.sourceVersion);
    if (candidate.kind === 'resource') {
        const resourceId = typeof candidate.resourceId === 'string' ? candidate.resourceId.trim() : '';
        const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
        if (!resourceId || /\s|[/\\]/.test(resourceId) || !isPlainFilename(name))
            return null;
        return {
            kind: 'resource',
            resourceId,
            name,
            ...(sourceVersion ? { sourceVersion } : {}),
        };
    }
    if (candidate.kind !== 'mount')
        return null;
    const mountId = typeof candidate.mountId === 'string' ? candidate.mountId.trim() : '';
    const workspaceAgentId = typeof candidate.workspaceAgentId === 'string'
        ? candidate.workspaceAgentId.trim()
        : '';
    const rawPath = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    if (!mountId || !rawPath || /^[A-Za-z]:[\\/]/.test(rawPath) || rawPath.startsWith('/'))
        return null;
    // `default` is a public alias, so the persisted target must carry its stable
    // Agent owner. Managed mounts already have a stable identity in mountId.
    if (mountId === 'default' && !workspaceAgentId)
        return null;
    const parts = rawPath.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.');
    if (parts.length === 0 || parts.some((part) => part === '..'))
        return null;
    return {
        kind: 'mount',
        mountId,
        ...(mountId === 'default' ? { workspaceAgentId } : {}),
        path: parts.join('/'),
        ...(sourceVersion ? { sourceVersion } : {}),
    };
}
export function chalkboardMediaResourceTargetKey(target) {
    if (target.kind === 'resource')
        return `resource:${target.resourceId}`;
    if (target.mountId === 'default') {
        return `mount:default:agent:${encodeURIComponent(target.workspaceAgentId || '')}:${target.path}`;
    }
    return `mount:${target.mountId}:${target.path}`;
}
export function chalkboardMediaResourceTargetName(target) {
    if (target.kind === 'resource')
        return target.name;
    return target.path.split('/').filter(Boolean).at(-1) || target.path;
}
export function mintStandaloneTerminalCardId() {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `termcard-${Date.now().toString(36)}-${hex}`;
}
/**
 * The card-chrome owner-targeting identity of a card's binding, or `null`
 * when the binding has none. This is the 取数口径（data-sourcing convention）
 * `useContributedCardChrome` (`card-action-registry.tsx`) uses to resolve
 * `contributes.ui.cardChrome`'s `targetCard` contributions against a live
 * card instance. It is also the owner口径 `useContributedSlotChrome` and
 * `useContributedSlotCardActions` use for the *other* card-chrome/in-flow
 * anchor: a plugin's own declared `contributes.ui.slots` are only ever
 * rendered on cards this same function resolves as that plugin's — the host's
 * single fixed anchor for a plugin-declared slot (see
 * `UiPluginSlotDeclaration`'s doc comment in the shared vocabulary).
 *
 * Only `plugin-webview` (a plugin's own static `cardId`, from its manifest's
 * `pluginCards`) and `plugin-stream-card` (a plugin's dynamic stream card,
 * taken out to its own tile — no static `cardId` to report) count as
 * "plugin-owned" for this batch. `plugin-surface` and `plugin-chat-surface`
 * are deliberately left out — scoped decision, not an oversight, held over
 * unchanged from the card-chrome batch that first drew this line.
 */
export function pluginCardOwnerOfBinding(binding) {
    if (!binding)
        return null;
    if (binding.kind === 'plugin-webview')
        return { pluginId: binding.pluginId, cardId: binding.cardId };
    if (binding.kind === 'plugin-stream-card')
        return { pluginId: binding.pluginId };
    return null;
}
/** Binding identity projected into the contribution contract's `cardOwner` (`appId`). */
export function contributionCardOwnerOfBinding(binding) {
    const owner = pluginCardOwnerOfBinding(binding);
    if (!owner)
        return null;
    return { appId: owner.pluginId, ...(owner.cardId ? { cardId: owner.cardId } : {}) };
}
/**
 * 生成卡（pinned artifact）显示名的唯一解析序：**userTitle > title**（未来 LLM
 * 生成名接在 title 前的既定档位）。两者都空返回 null，调用方回落到 i18n 兜底
 * （'互动卡片'）。纯函数，供卡片中心磁贴、实例创建标题链、tab label 共用，
 * 避免各消费点各写一遍优先级。
 */
export function resolvePinnedArtifactDisplayTitle(entry) {
    const userTitle = typeof entry.userTitle === 'string' ? entry.userTitle.trim() : '';
    if (userTitle)
        return userTitle;
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    return title || null;
}
/**
 * 网页卡显示名解析：非空 trim 后 title 直接用，空则返回 null 交调用方回落
 * i18n 兜底（'未命名网页'）。与 resolvePinnedArtifactDisplayTitle 同形制。
 */
export function resolveWebCardDisplayTitle(entry) {
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    return title || null;
}
/**
 * 插件流内卡钉出物显示名解析：与 resolveWebCardDisplayTitle 同形制——非空
 * trim 后 title 直接用，空则返回 null 交调用方回落 i18n 兜底。
 */
export function resolvePluginStreamCardDisplayTitle(entry) {
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    return title || null;
}
//# sourceMappingURL=chalkboard-card-types.js.map