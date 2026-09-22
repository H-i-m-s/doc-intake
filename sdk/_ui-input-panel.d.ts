import { type AppInputPanelContext, type PluginUiMessage } from './_ui-protocol.js';
export type HanaInputPanelSubmitHandler = (context: AppInputPanelContext) => unknown | Promise<unknown>;
export type HanaInputPanelPresentationPatch = Partial<AppInputPanelContext['presentation']>;
export interface HanaInputPanelApi {
    getContext(): AppInputPanelContext | null;
    onContextChanged(callback: (context: AppInputPanelContext | null) => void): () => void;
    /** Collect the current answer when the user clicks the host's confirm button. */
    onSubmit(handler: HanaInputPanelSubmitHandler): () => void;
    /** Request a bounded allocation or compact/expanded state for this exact mounted panel. */
    setPresentation(patch: HanaInputPanelPresentationPatch): Promise<{
        presentation: AppInputPanelContext['presentation'];
        presentationRevision: number;
    }>;
}
/** One SDK instance owns one mounted panel binding; its transport has already checked source and origin. */
export declare function createInputPanelBridge(post: (message: PluginUiMessage, onFailure?: (error: unknown) => void) => void): {
    api: HanaInputPanelApi;
    handleMessage: (message: PluginUiMessage) => boolean;
    clear: () => void;
};
