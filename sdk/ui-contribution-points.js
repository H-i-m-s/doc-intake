/**
 * ui-contribution-points.ts — generated from shared/ui-contribution-points.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
/**
 * shared/ui-contribution-points.ts — the vocabulary a v2 plugin's UI
 * contributions are written in, shared between the manifest reader
 * (`server/composition/plugins/plugin-loader-v2.ts`), the registration table
 * (`server/composition/plugins/ui-contributions.ts`) and, eventually, the
 * renderer that mounts what a plugin contributed.
 *
 * Slot ids are named as constants rather than typed as a free-form string so a
 * contributor and a consumer are reading the same literal rather than two
 * strings that happen to match today. Context-menu seats live in
 * `UI_SLOT_DIRECTORY` the same way: a plugin may only sit in a seat this table
 * opens, it cannot invent a location.
 */
// ---------------------------------------------------------------------------
// Slot ids
// ---------------------------------------------------------------------------
/** A row of actions attached to a chat message. */
export const UI_SLOT_MESSAGE_ACTIONS = "hana/chat.message.actions";
/** Chrome attached to a card's own frame. */
export const UI_SLOT_CARD_CHROME = "hana/card.chrome";
/** 会话列表·会话条目右键。 */
export const UI_SLOT_SESSION_CONTEXT_MENU = "hana/session.contextMenu";
/** 聊天区选中文字右键。 */
export const UI_SLOT_CHAT_SELECTION_CONTEXT_MENU = "hana/chat.selection.contextMenu";
/** 黑板卡（卡中心条目）右键。 */
export const UI_SLOT_CARD_CONTEXT_MENU = "hana/card.contextMenu";
/** Global keyboard dispatcher for a v2 app's declared keybindings. */
export const UI_SLOT_KEYBINDINGS = "hana/commands.keybindings";
export const UI_SLOT_INPUT_CONTROLS = "hana/input.controls";
/** Host-rendered launch entries for Apps that provide a Developer Space. */
export const UI_SLOT_HOME_ACTIONS = "hana/home.actions";
export const UI_SLOT_DIRECTORY = [
    {
        id: UI_SLOT_MESSAGE_ACTIONS,
        render: "host-primitive",
        access: "plugin",
        implementedAt: "desktop/src/react/contributions/use-contributed-message-actions.ts（AssistantMessage.tsx / "
            + "UserMessage.tsx 两处接入，渲染进 MessageFooterActions.tsx 的通用操作行）",
    },
    {
        id: UI_SLOT_CARD_CHROME,
        render: "host-primitive",
        access: "plugin",
        implementedAt: "desktop/src/react/chalkboard/card-action-registry.tsx 的 useContributedCardChrome + "
            + "plugin-chrome-action.tsx 的 PluginChromeActionButton",
    },
    {
        id: "hana/input.attention",
        render: "host-primitive",
        access: "plugin",
        implementedAt: "desktop/src/react/components/InputArea.tsx 的 .input-stack：input/SessionConfirmationPrompt.tsx"
            + "（ask 弹层）+ input/PluginBannerStrip.tsx（banner）",
    },
    {
        id: "hana/chat.stream.card",
        render: "iframe",
        access: "plugin",
        implementedAt: "desktop/src/react/components/chat/PluginStreamCard.tsx（BLOCK_RENDERERS['plugin_card']，流内"
            + "真身渲染；契约=工具返回值 details.card，不经本 registry）",
    },
    {
        id: "hana/settings.page",
        render: "host-primitive",
        access: "plugin",
        implementedAt: "server/composition/plugins/settings-contributions.ts（v2 contributes.settings schema 表单或 ui 自定义页面）",
    },
    {
        id: "hana/fp.full",
        render: "iframe",
        access: "closed",
        implementedAt: "v2 整页卡 fpFullPanel + functionPanel.route（认证 App UI）或 embedUrl（loopback iframe），不经 contributes.ui 座位",
    },
    {
        id: "hana/cardcenter.entry",
        render: "react",
        access: "builtin",
        implementedAt: "08-18 裁定的卡片中心同级一方位",
    },
    {
        id: "hana/sidebar.fp",
        render: "react",
        access: "closed",
        implementedAt: "ChatSidebar 的 afterXxxSlot React 插口",
    },
    {
        id: "hana/sidebar.notice",
        render: "react",
        access: "closed",
        implementedAt: "SidebarNoticeSlot",
    },
    {
        id: UI_SLOT_HOME_ACTIONS,
        render: "host-primitive",
        access: "builtin",
        implementedAt: "components/app/AppHomeActionButtons.tsx",
    },
    {
        id: UI_SLOT_INPUT_CONTROLS,
        render: "host-primitive",
        access: "plugin",
        implementedAt: "InputControlBar.tsx / InputStatusItems.tsx：contributes.ui.inputStatus 与按 sessionId 的动态覆盖",
    },
    {
        id: "hana/commands.slash",
        render: "host-primitive",
        access: "plugin",
        implementedAt: "插件斜杠命令 → /api/commands → SlashCommandMenu（既有机制，登记备案）；v2 应用经 ctx.commands.register 写入同一个 SlashCommandRegistry，走同一条 dispatcher/菜单链路",
    },
    {
        id: UI_SLOT_KEYBINDINGS,
        render: "host-primitive",
        access: "plugin",
        implementedAt: "desktop/src/react/contributions/contributed-keybindings.ts 的 useContributedKeybindings："
            + "全局键盘分发器，声明式，执行走 ui-actions 链",
    },
    {
        id: "hana/channel.topbar",
        render: "react",
        access: "closed",
        implementedAt: "ChannelTabBar.tsx 嵌插件页",
    },
    {
        id: "hana/chat.block-renderers",
        render: "react",
        access: "builtin",
        implementedAt: "AssistantMessage.tsx 的 BLOCK_RENDERERS 表",
    },
    // ---- context-menu seats. Host renders ContextMenuItem; plugins have no UI
    // of their own in the menu. UI wiring is a later batch; ids are stable.
    {
        // 会话列表·会话条目右键。上下文契约：sessionPath + sessionId + title；messageId 恒 null。
        id: UI_SLOT_SESSION_CONTEXT_MENU,
        render: "context-menu",
        access: "plugin",
        implementedAt: "目录具名；右键菜单 UI 接线在后续批次",
    },
    {
        // 聊天区选中文字右键。上下文契约：sessionPath + selectionText；不提供 messageId（选区可跨消息，message 级身份先天不成立）。invoke 通道上 selectionText 须经选区面贡献登记、16KB UTF-8 上限、C0 剥离，以及权限账本 `app/session.read-selection` 首用授权后才并入工具 context。
        id: UI_SLOT_CHAT_SELECTION_CONTEXT_MENU,
        render: "context-menu",
        access: "plugin",
        implementedAt: "目录具名；右键菜单 UI 接线在后续批次",
    },
    {
        // 黑板卡（卡中心条目）右键。上下文契约：当前交付 sessionPath（messageId 恒 null）；owner appId 仅用于显示过滤；cardId 待通道扩展。
        id: UI_SLOT_CARD_CONTEXT_MENU,
        render: "context-menu",
        access: "plugin",
        implementedAt: "目录具名；右键菜单 UI 接线在后续批次",
    },
    {
        // 消息内链接右键（Markdown 正文/工具行/折叠行共用）。上下文契约草案：{href, origin}。
        id: "hana/chat.link.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 黑板页签右键。上下文契约草案：{pageId}。
        id: "hana/chalkboard.page.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 频道列表条目右键。上下文契约草案：{channelId}。
        id: "hana/channels.list.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 频道页签右键。上下文契约草案：{tabId}。
        id: "hana/channels.tab.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 工作区文件右键。上下文契约草案：{fileRef}。路径外流敏感，开放前需授权设计。
        id: "hana/workspace.files.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 工作区子会话右键。上下文契约草案：{subSessionId}。
        id: "hana/workspace.subconversation.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 插件页签右键。上下文契约草案：{appId, tabId}。
        id: "hana/plugin.tab.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 书桌目录树节点右键。上下文契约草案：{nodePath}。路径外流敏感，开放前需授权设计。
        id: "hana/desk.tree.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 书桌技能条目右键。上下文契约草案：{skillId}。
        id: "hana/desk.skills.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 预览编辑器右键。上下文契约草案：{filePath, selection}。路径外流敏感，开放前需授权设计。
        id: "hana/preview.editor.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
    {
        // 会话浏览器条目右键。上下文契约草案：{sessionPath}。
        id: "hana/session.browser.contextMenu",
        render: "context-menu",
        access: "closed",
        implementedAt: "预留占位；后批开放不改 id",
    },
];
//# sourceMappingURL=ui-contribution-points.js.map