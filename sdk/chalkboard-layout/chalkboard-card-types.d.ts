/**
 * chalkboard-layout/chalkboard-card-types.ts — generated from shared/chalkboard-layout/chalkboard-card-types.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { CanonicalAnnotationResourceRef, WorkspaceAnnotationResourceRef } from '../annotations.js';
export type CanonicalResourceRef = CanonicalAnnotationResourceRef;
export interface FileVersion {
    mtimeMs: number;
    size: number;
    sha256?: string;
}
export type RetiredWorkspaceContentKind = `work${'bench'}-file` | `mobile-${'work'}${'bench'}`;
export interface RemoteWorkspaceContentRef {
    kind: 'workspace-file' | RetiredWorkspaceContentKind;
    mountId?: string;
    rootId?: string;
    subdir: string;
    name: string;
    contentPath: string;
    version?: FileVersion | null;
}
export interface ChalkboardDetachedBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export type ChalkboardRestoreEdge = 'left' | 'right' | 'top' | 'bottom';
/** Durable seat recipe frozen with an archive entry. Missing on pre-field rows. */
export type ChalkboardCardRestorePlacement = {
    version: 1;
    kind: 'detached';
    bounds?: ChalkboardDetachedBounds;
} | {
    version: 1;
    kind: 'docked';
    pageId: string;
    slotNodeId?: string;
    referenceCardInstanceId?: string;
    edge?: ChalkboardRestoreEdge;
};
export interface ChalkboardDetachedWindowEntry {
    bounds: ChalkboardDetachedBounds;
}
export type ChalkboardTilePlacementPreference = 'docked' | 'detached' | 'newPage';
export type ChalkboardPreviewDocumentTarget = {
    kind: 'local-file';
    filePath: string;
    workspaceResourceRef?: WorkspaceAnnotationResourceRef;
    resourceIdentity?: CanonicalResourceRef;
    /** @deprecated 文件身份成分已移除；仅为存量 layout 读兼容保留，新 target 不再写入。 */
    workspaceAgentId?: string;
} | {
    kind: 'workspace-file';
    target: RemoteWorkspaceContentRef;
    /** @deprecated 文件身份成分已移除；仅为存量 layout 读兼容保留，新 target 不再写入。 */
    workspaceAgentId?: string;
};
/**
 * Media Card 的可持久目标。mount 引用 ResourceIO 工作区定位；resource 引用
 * 本地档案目录发放的 canonical resource id，与 Agent 解耦。
 */
export interface ChalkboardMediaMountTarget {
    kind: 'mount';
    mountId: string;
    /** Required only for the public `default` mount; managed mounts own identity themselves. */
    workspaceAgentId?: string;
    path: string;
    /** Last provider-observed byte revision. It is not part of resource identity. */
    sourceVersion?: FileVersion;
}
export interface ChalkboardMediaCanonicalTarget {
    kind: 'resource';
    /** Canonical resource identity from the local resource catalog; stable across renames. */
    resourceId: string;
    /** Display filename (with extension); resource targets carry no mount path. */
    name: string;
    sourceVersion?: FileVersion;
}
export type ChalkboardMediaResourceTarget = ChalkboardMediaMountTarget | ChalkboardMediaCanonicalTarget;
export interface ChalkboardMediaCardBinding {
    kind: 'media';
    schemaVersion: 1;
    targets: ChalkboardMediaResourceTarget[];
    /** 首次打开的目标键；之后的左右翻页位置只留在卡实例组件本地。 */
    initialTargetKey?: string;
}
export declare function normalizeChalkboardMediaResourceTarget(value: unknown): ChalkboardMediaResourceTarget | null;
export declare function chalkboardMediaResourceTargetKey(target: ChalkboardMediaResourceTarget): string;
export declare function chalkboardMediaResourceTargetName(target: ChalkboardMediaResourceTarget): string;
export type ChalkboardCardContentBinding = {
    kind: 'session';
    sessionPath?: string | null;
    sessionId?: string | null;
    agentId?: string | null;
} | {
    /** Read-only projection of one child task, owned by its parent activity stream. */
    kind: 'subagent-preview';
    taskId: string;
    parentSessionId?: string | null;
    parentSessionPath?: string | null;
    childSessionId?: string | null;
    childSessionPath?: string | null;
    agentId?: string | null;
    /** Last known state, used only when the owning activity is no longer hydrated. */
    status?: 'running' | 'done' | 'failed' | 'aborted' | null;
    summary?: string | null;
    processRecordsDeleted?: boolean;
} | {
    kind: 'channels';
    channelId?: string | null;
} | {
    kind: 'preview';
    previewId: string;
    documentTarget?: ChalkboardPreviewDocumentTarget;
} | ChalkboardMediaCardBinding | {
    kind: 'plugin-surface';
    pluginId: string;
    surface: 'page' | 'widget';
} | {
    kind: 'plugin-webview';
    pluginId: string;
    cardId: string;
    channel?: 'app';
    route?: string;
} | {
    /**
     * 插件流内卡（chat 流内插件卡真身，PluginStreamCard 渲染的动态块）取出后
     * 的落地形态。与 plugin-webview 的区别：plugin-webview 引用插件 manifest
     * 里静态声明的 cardId（host 从 pluginCards 清单查 routeUrl）；这里的
     * route 是块自带的运行时路径，没有对应的静态 cardId 可查，装载时直接拼
     * `/api/plugins/${pluginId}${route}`（与 PluginStreamCard.tsx 同一条
     * usePluginSurfaceUrl 管线）。aspectRatio 是数值宽高比（w/h），不是
     * "16:9" 字符串——由取出钮从块的 aspectRatio 字符串解析后写入。
     */
    kind: 'plugin-stream-card';
    pluginId: string;
    cardType: 'iframe' | 'webview';
    route: string;
    /** Host-stamped v2 app channel. Absent on v1 cards and pre-field persisted rows. */
    channel?: 'app';
    title?: string | null;
    description?: string | null;
    aspectRatio?: number | null;
    /** Same meaning as the plugin manifest `cardForm` field; parsed by `resolvePluginCardPresentation`. */
    cardForm?: string | null;
    /** Same meaning as the plugin manifest `titlebar` field; parsed by `resolvePluginCardPresentation`. */
    titlebar?: string | null;
} | {
    kind: 'mcp-app';
    connectorId: string;
    toolName: string;
    resourceUri: string;
    invocationId?: string | null;
    toolResultRef?: string | null;
    launchInput?: unknown;
    sourceSessionPath?: string | null;
    sourceSessionId?: string | null;
    sourceAgentId?: string | null;
} | {
    kind: 'interactive-artifact';
    schemaVersion: 1;
    artifactId: string;
    cardId: string;
    sourceArtifactId?: string | null;
    sourceCardId?: string | null;
    pinnedArtifactId?: string | null;
    cardDocumentId?: string | null;
    code: string;
    title?: string | null;
    sessionId?: string | null;
    sessionPath?: string | null;
    messageId?: string | null;
    blockId?: string | null;
} | {
    kind: 'plugin-chat-surface';
    pluginId: string;
    sessionId: string;
    sessionPath?: string | null;
    unavailableReason?: string | null;
} | {
    kind: 'web-embed';
    /** Registry identity (core/web-card-registry-store.ts), never the URL. */
    webCardId: string;
    /** Current URL shown by the card — starts at the registry URL, updates
        as the embedded page navigates (per-instance state, not persisted
        back to the registry in this wave: restart reverts to the registry URL). */
    url: string;
    title?: string | null;
} | {
    /** Durable owner id for a gallery terminal card. Survives app restart
        with the layout profile; the live PTY does not. */
    kind: 'standalone-terminal';
    schemaVersion: 1;
    terminalCardId: string;
};
export declare function mintStandaloneTerminalCardId(): string;
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
export declare function pluginCardOwnerOfBinding(binding: ChalkboardCardContentBinding | null | undefined): {
    pluginId: string;
    cardId?: string;
} | null;
/** Binding identity projected into the contribution contract's `cardOwner` (`appId`). */
export declare function contributionCardOwnerOfBinding(binding: ChalkboardCardContentBinding | null | undefined): {
    appId: string;
    cardId?: string;
} | null;
export interface ChalkboardTileData {
    id: string;
    title?: string;
    preferredPlacement?: ChalkboardTilePlacementPreference;
    renderer: {
        kind: string;
        binding?: ChalkboardCardContentBinding | null;
    } & Record<string, unknown>;
}
export interface ChalkboardPinnedArtifactEntry {
    id: string;
    schemaVersion: 1;
    sourceArtifactId: string;
    sourceCardId: string;
    code: string;
    /** Durable Card Document identity. Paths remain server-owned locators. */
    cardDocumentId?: string;
    documentSourceCardId?: string;
    toolDeclarationHash?: string;
    toolGrantEpoch?: number;
    title?: string | null;
    /** 用户自定义命名（server 侧 pinned-card-registry 的 userTitle）。生成卡
        ID 唯一、名字自由，显示优先级 userTitle > 未来 LLM 生成名 > snake_case
        原名（title）。空/缺省表示未命名，回落 title。 */
    userTitle?: string | null;
    /** 来源会话（出生地）。纯 provenance：归档/删除来源会话不影响条目
        存续，消费方没有它时必须表现一致。 */
    sessionId?: string | null;
    sessionPath?: string | null;
    messageId?: string | null;
    blockId?: string | null;
    /** 模板铸卡或文件导入落地的初始运行时状态快照。只在实例化时作为
        rendererState.interactiveCardState 的种子，
        注册表本体不追踪之后的实例运行时变化——加法字段，老条目缺省即可，
        消费方没有它时必须与"空快照"表现一致。 */
    initialState?: unknown;
    /** 文件导入的来源线索（纯 provenance，不作身份使用）。缺省 = 并非文件
        导入（chat 内 pin 的 MiniApp 没有这个字段）。 */
    importedFrom?: {
        sourceCardId?: string;
    };
    /** 服务端 core/card-library.ts 材料化后的卡片库文件夹绝对路径——出现
        即表示这是一张"包卡"（网页包），非包卡（单文档 fragment）没有这个
        字段。纯只读透传（服务端权威），前端只用它判断导出走 zip 分支还是
        inline 分支，从不自己拼装或改写它。 */
    libraryPath?: string;
    createdAt: number;
    updatedAt: number;
    lastPinnedAt: number;
}
/**
 * 生成卡（pinned artifact）显示名的唯一解析序：**userTitle > title**（未来 LLM
 * 生成名接在 title 前的既定档位）。两者都空返回 null，调用方回落到 i18n 兜底
 * （'互动卡片'）。纯函数，供卡片中心磁贴、实例创建标题链、tab label 共用，
 * 避免各消费点各写一遍优先级。
 */
export declare function resolvePinnedArtifactDisplayTitle(entry: Pick<ChalkboardPinnedArtifactEntry, 'title' | 'userTitle'>): string | null;
/**
 * 网页卡（web page card）本体的前端镜像。这是 server 侧
 * `WebCardEntry`（core/web-card-registry-store.ts）的前端镜像——身份是
 * `id`（server 生成的注册表 id，创建后不变），`url` 是本体的可变属性，
 * 不是身份。归属对齐 pinned artifact 的先例：本体是 owner 级资产，只存在
 * server 端，前端字段是它的乐观镜像。
 */
export interface ChalkboardWebCardEntry {
    id: string;
    /** 用户标题；trim 后空表示未命名（显示层回落 i18n 占位，同 pinned 卡的
        userTitle 空态思路）。 */
    title: string;
    url: string;
    createdAt: number;
    updatedAt: number;
}
/**
 * 网页卡显示名解析：非空 trim 后 title 直接用，空则返回 null 交调用方回落
 * i18n 兜底（'未命名网页'）。与 resolvePinnedArtifactDisplayTitle 同形制。
 */
export declare function resolveWebCardDisplayTitle(entry: Pick<ChalkboardWebCardEntry, 'title'>): string | null;
/**
 * 插件流内卡钉出物本体的前端镜像。这是 server 侧
 * `PluginStreamCardEntry`（core/plugin-stream-card-registry-store.ts）的前端
 * 镜像——身份是 `id`（server 生成的注册表 id，创建后不变），route 是本体的
 * 可变属性，不是身份。归属对齐 web card 的先例：本体是 owner 级资产，只存在
 * server 端，前端字段是它的乐观镜像。没有 update 端点：字段来自钉出瞬间的
 * 聊天块快照，不可编辑。
 */
export interface ChalkboardPluginStreamCardEntry {
    id: string;
    pluginId: string;
    cardType: 'iframe' | 'webview';
    route: string;
    /** Host-stamped v2 app channel. Absent on v1 cards and pre-field persisted rows. */
    channel?: 'app';
    title: string;
    description?: string;
    aspectRatio?: number;
    /** Same meaning as the plugin manifest `cardForm` field; parsed by `resolvePluginCardPresentation`. */
    cardForm?: string;
    /** Same meaning as the plugin manifest `titlebar` field; parsed by `resolvePluginCardPresentation`. */
    titlebar?: string;
    createdAt: number;
    updatedAt: number;
}
/**
 * 插件流内卡钉出物显示名解析：与 resolveWebCardDisplayTitle 同形制——非空
 * trim 后 title 直接用，空则返回 null 交调用方回落 i18n 兜底。
 */
export declare function resolvePluginStreamCardDisplayTitle(entry: Pick<ChalkboardPluginStreamCardEntry, 'title'>): string | null;
/**
 * 冻结的卡实例档案条目。这是 server 侧 `CardArchiveEntry`
 * （core/card-archive-store.ts）的前端镜像子集——字段形状必须与服务端
 * 契约一致（id/cardInstanceId/definitionId/title/binding/rendererState/
 * kernelSource/renderer/restorePlacement/archivedAt/expiresAt）。`expiresAt` 仅 trash 条目携带。
 *
 * binding/kernelSource/renderer 在服务端是 unknown（core 不 import desktop
 * 类型）；前端放回时再按具体卡类型断言。这里保持宽松以镜像服务端。
 */
export interface ChalkboardCardArchiveEntry {
    id: string;
    cardInstanceId: string;
    definitionId: string;
    title?: string | null;
    binding?: ChalkboardCardContentBinding | null;
    rendererState?: Record<string, unknown>;
    kernelSource?: unknown;
    renderer?: unknown;
    restorePlacement?: ChalkboardCardRestorePlacement;
    archivedAt: number;
    /** 仅回收站条目携带；收藏无 TTL。 */
    expiresAt?: number;
}
export interface ChalkboardCardArchiveState {
    trash: ChalkboardCardArchiveEntry[];
    favorites: ChalkboardCardArchiveEntry[];
}
export type ChalkboardCardEntityDescriptionStatus = 'pending' | 'ready' | 'failed' | 'not_available';
export interface ChalkboardCardEntityEntry {
    id: string;
    schemaVersion: 1;
    sourceKind: 'artifact' | 'plugin' | 'html' | 'webview' | 'builtin' | 'resource' | 'unknown' | 'file';
    sourceKey: string;
    title?: string | null;
    description?: string | null;
    descriptionStatus: ChalkboardCardEntityDescriptionStatus;
    sourceHash?: string | null;
    createdAt: number;
    updatedAt: number;
    lastRequestedAt?: number | null;
    failedAt?: number | null;
    error?: string | null;
}
export type ChalkboardCardCreationSource = {
    kind: 'card-center';
} | {
    kind: 'session-context-menu';
    sessionPath: string;
    sessionId?: string | null;
}
/** 会话行被拖出侧边栏、在画布上松手：与右键菜单同一条平行聊天落窗管线，
 *  只是新窗坐标取松手点。单列一个变体是为了让"卡片是怎么来的"仍然可读。 */
 | {
    kind: 'session-drag-out';
    sessionPath: string;
    sessionId?: string | null;
} | {
    kind: 'mcp-tool-result';
    sessionPath?: string | null;
    sessionId?: string | null;
    agentId?: string | null;
    toolCallId?: string | null;
    invocationId?: string | null;
    toolResultRef?: string | null;
} | {
    kind: 'interactive-artifact-pin';
    sessionPath: string;
    sessionId?: string | null;
    messageId?: string | null;
    blockId?: string | null;
} | {
    kind: 'pinned-artifact-registry';
    pinnedArtifactId: string;
} | {
    kind: 'web-card-registry';
    webCardId: string;
} | {
    kind: 'plugin-stream-card-registry';
    pluginStreamCardId: string;
}
/** 聊天流插件卡取出钮的 detach 分支：不落注册表，卡实例即身份终点
 *  （同 mcp-tool-result 的"聊天块直接拆窗"先例）。 */
 | {
    kind: 'plugin-stream-card-detach';
} | {
    kind: 'preview-actions';
} | {
    kind: 'drag';
    from: 'card-center';
};
export type ChalkboardCardPlacementMode = {
    kind: 'default';
} | {
    kind: 'edge';
    edge: 'left' | 'right' | 'top' | 'bottom';
    referenceNodeId?: string;
} | {
    kind: 'slot';
    slotNodeId: string;
} | {
    kind: 'replace-empty';
};
export type ChalkboardCardPlacementTarget = {
    kind: 'home-surface';
    placement?: ChalkboardCardPlacementMode;
} | {
    kind: 'page-surface';
    pageId: string;
    placement?: ChalkboardCardPlacementMode;
} | {
    kind: 'detached';
    bounds?: ChalkboardDetachedBounds;
};
export interface ChalkboardCardCreationRequest {
    definitionId: string;
    source: ChalkboardCardCreationSource;
    binding?: ChalkboardCardContentBinding | null | 'auto';
    target?: ChalkboardCardPlacementTarget | 'auto';
    title?: string | null;
}
//# sourceMappingURL=chalkboard-card-types.d.ts.map