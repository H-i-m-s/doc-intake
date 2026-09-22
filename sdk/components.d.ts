import type { ComponentType, ForwardRefExoticComponent, ReactElement, RefAttributes } from "react";
import type * as App from "./_app-types.js";
import type * as Settings from "./_settings-types.js";
import type { AppSurfaceHandle, AppHostSurfaceHandle, HanaPanelProps } from "./app-contract/surfaces.js";

export type { AppSurfaceHandle, AppHostSurfaceHandle, HanaPanelProps } from "./app-contract/surfaces.js";
export interface HostSurfaceProps { surface: AppHostSurfaceHandle; visible?: boolean; covered?: boolean; className?: string; onError?(error: Error): void; }
export type AppSurfaceHostRequest = "hana.app-surface.mount" | "hana.app-surface.action" | "hana.app-surface.native";
export interface AppSurfaceHost { request<T = unknown>(type: AppSurfaceHostRequest, payload: unknown): Promise<T>; }
export interface AppSurfaceProps {
  surface: AppSurfaceHandle; visible?: boolean; state?: Record<string, unknown> | null;
  onStateChange?(state: Record<string, unknown> | null): void | Promise<void>;
  onOpenCard?(definitionId: string): Promise<{ cardInstanceId: string }>;
  settingsLabels?: { save: string; saving: string; saved: string; sensitiveHint?: string; invalidJson?: string; saveFailed?: string };
  onPanel?(panel: HanaPanelProps): void; onError?(error: Error): void;
  className?: string; host?: AppSurfaceHost;
}
export interface AppPanelEvent { sectionId: string; itemId?: string; kind: "select" | "action" | "toggle"; checked?: boolean; activation?: { kind: "emit" | "focus-card" }; }
export interface AppPanelProps { panel: HanaPanelProps; onEvent(event: AppPanelEvent): void; }
export interface CardInteractiveRegionLayerProps { surfaceId?: string; cardInstanceId?: string; }

export type {
  ButtonProps, ButtonSize, ButtonVariant, ContextMenuItem, ContextMenuProps,
  DropdownMenuProps, GridProps, IconButtonProps, InlineProps, ListRowProps,
  NumberInputProps, SaveButtonProps, SaveButtonStatus, SelectOption, SelectProps,
  SchemaSettingsFormLabels, SchemaSettingsFormProps, SchemaSettingsProperty, SchemaSettingsSchema,
  SettingsControlSize, SettingsGap, SettingsPageProps, SettingsRowLayout,
  SettingsRowProps, SettingsSectionProps, SettingsStackProps, SettingsSurfaceProps,
  SettingsSurfaceVariant, TextAreaProps, TextInputProps, ToggleProps, TooltipProps,
  TooltipTriggerProps, VerificationButtonProps, VerificationLabels,
} from "./_settings-types.js";
export type InstalledExtensionEntryProps = Settings.ListRowProps;
export type {
  AnimatedListItemProps, AnimatedListProps, AppMotionProviderProps,
  ChromeActionButtonProps, ExtensionDetailIdentity, ExtensionDetailViewProps, ExtensionPageFrameProps, ExtensionPageHeaderProps, ExtensionItemIconProps,
  FunctionPanelContentFrameProps, FunctionPanelPane, FunctionPanelShellProps, FunctionPanelOverlayTriggerRect, WorkspaceTitlebarProps,
  InstalledExtensionsGroup, InstalledExtensionsViewProps,
  PageNavigatorActionPort, PageNavigatorDragState, PageNavigatorDropState, PageNavigatorDropStateAdapter, PageNavigatorPage, PageNavigatorProps,
  AppUiProviderProps, CollapseProps, FadeInProps, MotionPreset, SearchInputProps,
  SlideInProps, SystemChromeActionsProps, TabItem, TabsProps,
} from "./_app-types.js";

export declare const SettingsPage: ComponentType<Settings.SettingsPageProps>;
export declare const ExtensionPageFrame: ComponentType<App.ExtensionPageFrameProps>;
export declare const ExtensionPageHeader: ComponentType<App.ExtensionPageHeaderProps>;
export declare const ExtensionItemIcon: ComponentType<App.ExtensionItemIconProps>;
export declare const SettingsSurface: ComponentType<Settings.SettingsSurfaceProps>;
export declare const SettingsSection: ComponentType<Settings.SettingsSectionProps>;
export declare const SettingsRow: ComponentType<Settings.SettingsRowProps>;
export declare const SettingRow: ComponentType<Settings.SettingsRowProps>;
export declare const SettingsStack: ComponentType<Settings.SettingsStackProps>;
export declare const Inline: ComponentType<Settings.InlineProps>;
export declare const Grid: ComponentType<Settings.GridProps>;
export declare const Button: ForwardRefExoticComponent<Settings.ButtonProps & RefAttributes<HTMLButtonElement>>;
export declare const IconButton: ForwardRefExoticComponent<Settings.IconButtonProps & RefAttributes<HTMLButtonElement>>;
export declare const TextInput: ForwardRefExoticComponent<Settings.TextInputProps & RefAttributes<HTMLInputElement>>;
export declare const TextArea: ForwardRefExoticComponent<Settings.TextAreaProps & RefAttributes<HTMLTextAreaElement>>;
export declare const Select: ComponentType<Settings.SelectProps>;
export declare const Toggle: ComponentType<Settings.ToggleProps>;
export declare const Switch: ComponentType<Settings.ToggleProps>;
export declare const NumberInput: ComponentType<Settings.NumberInputProps>;
export declare const SaveButton: ComponentType<Settings.SaveButtonProps>;
export declare const VerificationButton: ComponentType<Settings.VerificationButtonProps>;
export declare const ContextMenu: ComponentType<Settings.ContextMenuProps>;
export declare const DropdownMenu: ComponentType<Settings.DropdownMenuProps>;
export declare const Tooltip: ComponentType<Settings.TooltipProps>;
export declare const ListRow: ComponentType<Settings.ListRowProps>;
export declare const SchemaSettingsForm: ComponentType<Settings.SchemaSettingsFormProps>;
export declare const AppSurface: ComponentType<AppSurfaceProps>;
export declare const HostSurface: ComponentType<HostSurfaceProps>;
export declare const AppPanel: ComponentType<AppPanelProps>;
export declare const CardInteractiveRegionLayer: ComponentType<CardInteractiveRegionLayerProps>;
export declare function performAppSurfaceAction(surfaceId: string, operation: Record<string, unknown>): Promise<unknown>;
export declare function emitAppSurfacePanelEvent(surfaceId: string, event: AppPanelEvent): void;
export declare function AppUiProvider(props: App.AppUiProviderProps): ReactElement;
export declare function AppMotionProvider(props: App.AppMotionProviderProps): ReactElement;
export declare function SearchInput(props: App.SearchInputProps): ReactElement;
export declare function Tabs<T extends string = string>(props: App.TabsProps<T>): ReactElement;
export declare const FadeIn: ForwardRefExoticComponent<App.FadeInProps & RefAttributes<HTMLDivElement>>;
export declare const Collapse: ComponentType<App.CollapseProps>;
export declare const SlideIn: ForwardRefExoticComponent<App.SlideInProps & RefAttributes<HTMLDivElement>>;
export declare const AnimatedList: ComponentType<App.AnimatedListProps>;
export declare const AnimatedListItem: ForwardRefExoticComponent<App.AnimatedListItemProps & RefAttributes<HTMLDivElement>>;
export declare function InstalledExtensionsView<T, Category extends string = string>(props: App.InstalledExtensionsViewProps<T, Category>): ReactElement;
export declare function InstalledExtensionEntry(props: Settings.ListRowProps): ReactElement;
export declare function ExtensionDetailView(props: App.ExtensionDetailViewProps): ReactElement;
export declare const ChromeActionButton: ForwardRefExoticComponent<App.ChromeActionButtonProps & RefAttributes<HTMLButtonElement>>;
export declare const SystemChromeActions: ComponentType<App.SystemChromeActionsProps>;
export declare function FunctionPanelContentFrame(props: App.FunctionPanelContentFrameProps): ReactElement;
export declare function FunctionPanelShell(props: App.FunctionPanelShellProps): ReactElement;
export declare function WorkspaceTitlebar(props: App.WorkspaceTitlebarProps): ReactElement;
export declare function FunctionPanelPaneStackView(props: { panes: readonly App.FunctionPanelPane[] }): ReactElement;
export declare const PageNavigator: ComponentType<App.PageNavigatorProps>;
