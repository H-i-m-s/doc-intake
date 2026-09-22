/**
 * app-contract/workspace.ts — generated from shared/app-contract/workspace.ts
 * by `node scripts/sync-app-sdk.mjs`. Do not edit by hand; edit the source
 * and re-run the sync script instead.
 */
import type { CanvasCard, CanvasLayoutSnapshot } from './canvas.js';
export type AppWorkspacePanelMode = 'session-list' | 'standard' | 'full';
export type AppWorkspaceMenuCommand = 'card-center' | 'function-panel' | 'agent-settings' | 'chat' | 'new-chat' | 'preview';
/** Menu entries are supplied by the owning App; undeclared actions cannot be invoked. */
export interface AppWorkspaceMenuItem {
    readonly id: string;
    readonly label: string;
    readonly command?: AppWorkspaceMenuCommand;
    readonly disabled?: boolean;
    readonly checked?: boolean;
    readonly danger?: boolean;
}
export interface AppWorkspaceConfiguration {
    readonly title: string;
    readonly subtitle?: string;
    /** Replaces the workspace Agent identity with an App-supplied panel heading. */
    readonly functionPanelTitle?: string;
    readonly menu: readonly AppWorkspaceMenuItem[];
}
export interface AppWorkspaceLayoutSnapshot extends Omit<CanvasLayoutSnapshot, 'cards'> {
    /** A detached card opened independently can have no return page. */
    readonly cards: Readonly<Record<string, Omit<CanvasCard, 'pageId'> & {
        readonly pageId: string | null;
    }>>;
}
export interface AppWorkspaceSnapshot {
    readonly layout: AppWorkspaceLayoutSnapshot;
    readonly functionPanel: {
        readonly collapsed: boolean;
        readonly mode: AppWorkspacePanelMode;
    };
    readonly activeSessionId: string | null;
    /** Workspace-local default for the next conversation and sessionless actions. */
    readonly selectedAgentId?: string;
    readonly cardSources: Readonly<Record<string, {
        readonly kind: string;
        readonly appId?: string;
        readonly definitionId: string;
        readonly lifecycle?: 'active' | 'closing';
    }>>;
}
/** Bounded operations on a single App-owned workspace, never on the main workspace. */
export type AppWorkspaceCommand = {
    readonly action: 'workspace.inspect';
} | {
    readonly action: 'workspace.configure';
    readonly configuration: AppWorkspaceConfiguration;
} | {
    readonly action: 'agent.select';
    readonly agentId: string;
} | {
    readonly action: 'agent.settings.open';
} | {
    readonly action: 'agent.settings.close';
} | {
    readonly action: 'page.create';
    readonly title?: string;
    readonly id?: string;
} | {
    readonly action: 'page.select';
    readonly pageId: string;
} | {
    readonly action: 'page.rename';
    readonly pageId: string;
    readonly title: string;
} | {
    readonly action: 'page.reorder';
    readonly pageIds: readonly string[];
} | {
    readonly action: 'page.remove';
    readonly pageId: string;
} | {
    readonly action: 'card.open';
    readonly pageId: string;
    readonly appId: string;
    readonly definitionId: string;
    readonly slot?: 'card' | 'settings';
} | {
    readonly action: 'card.take-out';
    readonly pageId: string;
    readonly source: {
        readonly kind: 'builtin' | 'pinned' | 'web';
        readonly id: string;
    };
} | {
    readonly action: 'card.close';
    readonly cardId: string;
} | {
    readonly action: 'card.move';
    readonly cardId: string;
    readonly pageId: string;
    readonly beforeCardId?: string;
} | {
    readonly action: 'card.detach';
    readonly cardId: string;
} | {
    readonly action: 'card.attach';
    readonly cardId: string;
    readonly pageId: string;
} | {
    readonly action: 'card.resize';
    readonly cardId: string;
    readonly width: number;
    readonly height: number;
} | {
    readonly action: 'card.state';
    readonly cardId: string;
    readonly state: Readonly<Record<string, unknown>> | null;
} | {
    readonly action: 'card.rename';
    readonly cardId: string;
    readonly title: string;
} | {
    readonly action: 'card.inspect';
    readonly cardId: string;
} | {
    readonly action: 'card.interact';
    readonly cardId: string;
    readonly operation: Readonly<Record<string, unknown>>;
} | {
    readonly action: 'host.open';
    readonly slot: 'chat' | 'preview';
    readonly sessionId?: string;
    readonly sourcePath?: string;
    readonly newChat?: boolean;
    readonly agentId?: string;
} | {
    readonly action: 'host.close';
    readonly slot: 'chat' | 'preview';
} | {
    readonly action: 'ui.invoke';
    readonly appId: string;
    readonly kind: 'home-action' | 'card-chrome' | 'slot-action';
    readonly id: string;
} | {
    readonly action: 'slot.open';
    readonly cardId: string;
    readonly appId: string;
    readonly definitionId: string;
} | {
    readonly action: 'slot.inspect';
    readonly cardId: string;
    readonly appId: string;
    readonly definitionId: string;
} | {
    readonly action: 'slot.interact';
    readonly cardId: string;
    readonly appId: string;
    readonly definitionId: string;
    readonly operation: Readonly<Record<string, unknown>>;
} | {
    readonly action: 'card-center.toggle';
    readonly open: boolean;
} | {
    readonly action: 'function-panel.set';
    readonly collapsed?: boolean;
    readonly mode?: AppWorkspacePanelMode;
};
export interface AppWorkspaceResult {
    readonly result: Readonly<Record<string, unknown>>;
    readonly snapshot: AppWorkspaceSnapshot;
}
//# sourceMappingURL=workspace.d.ts.map