/**
 * chalkboard-layout/chalkboard-builtin-ids.ts — generated from shared/chalkboard-layout/chalkboard-builtin-ids.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import { CHALKBOARD_CHANNELS_PAGE_ID, CHALKBOARD_CHAT_PAGE_ID } from '../chalkboard-layout.js';
export { CHALKBOARD_CHANNELS_PAGE_ID, CHALKBOARD_CHAT_PAGE_ID };
export const CHALKBOARD_HOME_CHAT_LEAF_ID = 'wb-home-chat-leaf';
export const CHALKBOARD_HOME_CHAT_GROUP_ID = 'wb-home-chat-group';
export const CHALKBOARD_HOME_CHAT_TILE_ID = 'wb-home-chat-tile';
export const CHALKBOARD_PREVIEW_LEAF_ID = 'wb-home-preview-leaf';
export const CHALKBOARD_PREVIEW_GROUP_ID = 'wb-home-preview-group';
export const CHALKBOARD_PREVIEW_TILE_ID = 'wb-home-preview-tile';
export const CHALKBOARD_PREVIEW_SPLIT_ID = 'wb-home-preview-split';
export const CHALKBOARD_WORKSPACE_LEAF_ID = 'wb-home-workspace-leaf';
export const CHALKBOARD_WORKSPACE_GROUP_ID = 'wb-home-workspace-group';
export const CHALKBOARD_WORKSPACE_SPLIT_ID = 'wb-home-workspace-split';
export const CHALKBOARD_TILE_SESSION_FILES = 'wb-tile-session-files';
export const CHALKBOARD_TILE_WORKSPACE_DESK = 'wb-tile-workspace-desk';
export const CHALKBOARD_TILE_WORKSPACE_TODO = 'wb-tile-workspace-todo';
export const CHALKBOARD_TILE_WORKSPACE_CORE = 'wb-tile-workspace-core';
/** 子对话成员只在工作台内部流里渲染，没有独立卡形态；这个 id 是它在读模型
    里的身份，不是一个可挂载的卡定义。 */
export const CHALKBOARD_TILE_WORKSPACE_SUB_CONVERSATIONS = 'wb-tile-workspace-sub-conversations';
export const CHALKBOARD_TILE_WORKSPACE_WORKFLOW = 'wb-tile-workspace-workflow';
export const CHALKBOARD_TILE_WORKSPACE_ACTIVITY = 'wb-tile-workspace-activity';
export const CHALKBOARD_TILE_WORKSPACE_STATUS = 'wb-tile-workspace-status';
export const CHALKBOARD_CHAT_MIN_PX = 400;
export const CHALKBOARD_CHANNELS_STACK_MIN_PX = 240;
export const CHALKBOARD_CHANNELS_STACK_DEFAULT_PX = 300;
export const CHALKBOARD_PREVIEW_MIN_PX = 320;
export const CHALKBOARD_PREVIEW_DEFAULT_PX = 400;
export const CHALKBOARD_WORKSPACE_MIN_PX = 290;
export const CHALKBOARD_WORKSPACE_DEFAULT_PX = 280;
export const CHALKBOARD_PARALLEL_CHAT_MIN_PX = 360;
export const CHALKBOARD_PARALLEL_CHAT_DEFAULT_PX = 440;
export const CHALKBOARD_PARALLEL_CHAT_DETACHED_DEFAULT_BOUNDS = {
    x: 120,
    y: 120,
    width: 560,
    height: 720,
};
export const CHALKBOARD_PARALLEL_PREVIEW_DETACHED_DEFAULT_BOUNDS = {
    x: 140,
    y: 120,
    width: 620,
    height: 760,
};
export const CHALKBOARD_TERMINAL_MIN_PX = 320;
export const CHALKBOARD_TERMINAL_DEFAULT_PX = 520;
/** 子进程卡：子对话 + 后台进程（子助手 / workflow / 助手起的后台命令）的一等桌面卡。
    从聊天卡面板菜单自己开、自己关，不随后台动静自动生灭；不进卡片中心。 */
export const CHALKBOARD_SUB_PROCESSES_RENDERER_KIND = 'sub-processes';
export const CHALKBOARD_SUB_PROCESSES_MIN_PX = 240;
export const CHALKBOARD_SUB_PROCESSES_DEFAULT_PX = 300;
/** A detached, read-only transcript for one bound subagent activity. */
export const CHALKBOARD_SUBAGENT_PREVIEW_RENDERER_KIND = 'subagent-preview';
export const CHALKBOARD_SUBAGENT_PREVIEW_MIN_PX = 360;
export const CHALKBOARD_SUBAGENT_PREVIEW_DEFAULT_PX = 520;
export const CHALKBOARD_SUBAGENT_PREVIEW_DETACHED_DEFAULT_BOUNDS = {
    x: 140,
    y: 120,
    width: 560,
    height: 720,
};
export const CHALKBOARD_PARALLEL_CHAT_RENDERER_KIND = 'parallel-chat';
export const CHALKBOARD_PARALLEL_PREVIEW_RENDERER_KIND = 'parallel-preview';
export const CHALKBOARD_INTERACTIVE_ARTIFACT_RENDERER_KIND = 'interactive-artifact';
export const CHALKBOARD_TERMINAL_RENDERER_KIND = 'terminal-card';
/** 画廊可多开的独立终端卡：进程归卡片所有，不跟随聊天会话。 */
export const CHALKBOARD_STANDALONE_TERMINAL_RENDERER_KIND = 'standalone-terminal-card';
export const CHALKBOARD_PLUGIN_SURFACE_RENDERER_KIND = 'plugin-surface-card';
export const CHALKBOARD_PLUGIN_WEBVIEW_RENDERER_KIND = 'plugin-webview-card';
export const CHALKBOARD_PLUGIN_CHAT_SURFACE_RENDERER_KIND = 'plugin-chat-surface-card';
export const CHALKBOARD_MCP_APP_RENDERER_KIND = 'mcp-app-card';
export const CHALKBOARD_WEB_PAGE_RENDERER_KIND = 'web-page-card';
/** 插件流内卡钉出物落到黑板后的卡型（binding.kind 同名，同 interactive-artifact
    先例：一对一单一用途的渲染器不必另起一个字符串）。 */
export const CHALKBOARD_PLUGIN_STREAM_CARD_RENDERER_KIND = 'plugin-stream-card';
export const CHALKBOARD_PLUGIN_SURFACE_MIN_PX = 320;
export const CHALKBOARD_PLUGIN_SURFACE_DEFAULT_PX = 440;
export const CHALKBOARD_PLUGIN_STREAM_CARD_MIN_PX = 320;
export const CHALKBOARD_PLUGIN_STREAM_CARD_DEFAULT_PX = 440;
export const CHALKBOARD_INTERACTIVE_ARTIFACT_MIN_PX = 320;
export const CHALKBOARD_INTERACTIVE_ARTIFACT_DEFAULT_PX = 480;
/**
 * 生成卡拆成独立窗口时的出生尺寸。宽度就是这张卡自己的默认宽（画布上是多宽，
 * 拆出来也是多宽），高度沿用拆窗的通用值——窗口的高度没有卡型可依。
 * 位置字段与其它两族同形，实际取用只读 width / height。
 */
export const CHALKBOARD_INTERACTIVE_ARTIFACT_DETACHED_DEFAULT_BOUNDS = {
    x: 120,
    y: 120,
    width: CHALKBOARD_INTERACTIVE_ARTIFACT_DEFAULT_PX,
    height: 720,
};
export const CHALKBOARD_CARD_CHANNELS_PAGE = 'channels';
export const CHALKBOARD_FP_CHANNELS_LIST = 'channels-list-pane';
export const CHALKBOARD_TILE_CHANNEL_CHAT = 'wb-tile-channel-chat';
export const CHALKBOARD_TILE_CHANNEL_STACK = 'wb-tile-channel-stack';
export const CHALKBOARD_CHANNELS_CHAT_LEAF_ID = 'wb-channels-chat-leaf';
export const CHALKBOARD_CHANNELS_CHAT_GROUP_ID = 'wb-channels-chat-group';
export const CHALKBOARD_CHANNELS_STACK_LEAF_ID = 'wb-channels-stack-leaf';
export const CHALKBOARD_CHANNELS_STACK_GROUP_ID = 'wb-channels-stack-group';
export const CHALKBOARD_CHANNELS_DEFAULT_SPLIT_ID = 'wb-channels-default-split';
export function pageCanvasId(pageId) {
    if (typeof pageId !== 'string' || !pageId) {
        throw new Error('chalkboard canvas: pageId must be a non-empty string');
    }
    return `page:${pageId}`;
}
export function pageIdFromChalkboardCanvasId(canvasId) {
    return canvasId.startsWith('page:') ? canvasId.slice('page:'.length) : null;
}
export const CHALKBOARD_TILE_CANVAS = {
    [CHALKBOARD_TILE_CHANNEL_CHAT]: pageCanvasId(CHALKBOARD_CHANNELS_PAGE_ID),
    [CHALKBOARD_TILE_CHANNEL_STACK]: pageCanvasId(CHALKBOARD_CHANNELS_PAGE_ID),
};
export const CHALKBOARD_TILE_DEFAULT_WIDTH_PX = {
    [CHALKBOARD_PREVIEW_TILE_ID]: CHALKBOARD_PREVIEW_DEFAULT_PX,
    [CHALKBOARD_TILE_SESSION_FILES]: CHALKBOARD_WORKSPACE_DEFAULT_PX,
    [CHALKBOARD_TILE_WORKSPACE_DESK]: CHALKBOARD_WORKSPACE_DEFAULT_PX,
    [CHALKBOARD_TILE_WORKSPACE_TODO]: CHALKBOARD_WORKSPACE_DEFAULT_PX,
    [CHALKBOARD_TILE_WORKSPACE_CORE]: CHALKBOARD_WORKSPACE_DEFAULT_PX,
    [CHALKBOARD_TILE_WORKSPACE_WORKFLOW]: CHALKBOARD_WORKSPACE_DEFAULT_PX,
    [CHALKBOARD_TILE_WORKSPACE_ACTIVITY]: CHALKBOARD_WORKSPACE_DEFAULT_PX,
    [CHALKBOARD_TILE_WORKSPACE_STATUS]: CHALKBOARD_WORKSPACE_DEFAULT_PX,
    [CHALKBOARD_TILE_CHANNEL_STACK]: CHALKBOARD_CHANNELS_STACK_DEFAULT_PX,
    [CHALKBOARD_TERMINAL_RENDERER_KIND]: CHALKBOARD_TERMINAL_DEFAULT_PX,
    [CHALKBOARD_STANDALONE_TERMINAL_RENDERER_KIND]: CHALKBOARD_TERMINAL_DEFAULT_PX,
    [CHALKBOARD_SUB_PROCESSES_RENDERER_KIND]: CHALKBOARD_SUB_PROCESSES_DEFAULT_PX,
};
export const CHALKBOARD_GENERIC_DEFAULT_WIDTH_PX = 240;
//# sourceMappingURL=chalkboard-builtin-ids.js.map