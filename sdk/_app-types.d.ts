import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import type { ContextMenuItem } from "./_settings-types.js";
import type { ButtonProps, BusyStateProps, CheckboxProps, ContextMenuProps, DropdownMenuProps, EmptyStateProps, ErrorStateProps, GridProps, IconButtonProps, InlineProps, ListRowProps, NumberInputProps, SaveButtonProps, SelectProps, SettingsRowProps, SettingsSectionProps, SettingsStackProps, TextAreaProps, TextInputProps, ToggleProps, TooltipProps, VerificationButtonProps } from "./_settings-types.js";
export interface AppUiProviderProps {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
}
export interface ExtensionPageFrameProps extends HTMLAttributes<HTMLDivElement> {
    header?: ReactNode;
    footer?: ReactNode;
    bodyRef?: Ref<HTMLDivElement>;
    bodyClassName?: string;
}
export interface ExtensionPageHeaderProps {
    title: ReactNode;
    leading?: ReactNode;
    actions?: ReactNode;
    centered?: boolean;
    className?: string;
    actionsClassName?: string;
}
export interface ExtensionItemIconProps {
    name: string;
    icon?: string;
    size?: 'navigation' | 'small' | 'normal' | 'large';
}
export interface PageNavigatorPage {
    id: string;
    title?: string;
    shape: string;
    /**
     * Resolved page navigation icon URL, or absent to keep the shape icon. The
     * host wrapper resolves it from the page's unique whole-page primary card
     * (`manifest.cards[].pageIcon`) against the connection the published App
     * catalogue came from; the navigator itself stays presentation-only and never
     * reads a store or catalogue.
     */
    iconSrc?: string | null;
    /**
     * Opaque identity of the icon's source generation (the App's runtime). A
     * change lets the same path be retried once; an unchanged bad source is not.
     * Not a credential and never written to the document or the DOM.
     */
    iconSourceRevision?: string | null;
}
export interface PageNavigatorActionPort {
    selectPage: (pageId: string) => void;
    addPage: () => string | void;
    renamePage: (pageId: string, title?: string) => void;
    removePage: (pageId: string) => void;
    reorderPages: (fromIndex: number, toIndex: number) => void;
}
export interface PageNavigatorDropState {
    hover: boolean;
    forbidden: boolean;
}
export type PageNavigatorDropStateAdapter = (props: {
    pageId: string;
    children: (state: PageNavigatorDropState) => ReactNode;
}) => ReactNode;
export interface PageNavigatorDragState {
    active: boolean;
    expanded: boolean;
    pageStates?: Readonly<Record<string, PageNavigatorDropState | undefined>>;
    createState?: PageNavigatorDropState;
    PageDropState?: PageNavigatorDropStateAdapter;
    CreateDropState?: PageNavigatorDropStateAdapter;
    onDropGeometryChanged?: () => void;
}
export interface PageNavigatorProps {
    pages: readonly PageNavigatorPage[];
    activePageId: string;
    availableWidthPx: number;
    actions: PageNavigatorActionPort;
    placement?: 'sidebar' | 'titlebar';
    dragState?: PageNavigatorDragState;
    canRemovePage?: (page: PageNavigatorPage) => boolean;
    pageLabel?: (page: PageNavigatorPage, t: (key: string) => string) => string;
    confirmRemovePage?: (page: PageNavigatorPage) => boolean | Promise<boolean>;
    isConfirmationOpen?: () => boolean;
    t?: (key: string) => string;
}
export interface SearchInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    /** Accessible name for the search field. */
    ariaLabel: string;
    /** Accessible name for the clear control when the field has a value. */
    clearAriaLabel: string;
    className?: string;
    autoFocus?: boolean;
}
export interface TabItem<T extends string = string> {
    value: T;
    label: ReactNode;
    disabled?: boolean;
}
export interface TabsProps<T extends string = string> {
    items: readonly TabItem<T>[];
    value: T;
    onChange: (value: T) => void;
    ariaLabel: string;
    className?: string;
    variant?: 'segmented' | 'pills' | 'line';
}
export type MotionPreset = 'paper' | 'paperGentle' | 'paperSnap';
export interface AppMotionProviderProps {
    children: ReactNode;
}
export interface FadeInProps {
    children: ReactNode;
    preset?: MotionPreset;
    delay?: number;
    y?: number;
    className?: string;
    style?: CSSProperties;
}
export interface CollapseProps {
    open: boolean;
    children: ReactNode;
    preset?: MotionPreset;
    className?: string;
    style?: CSSProperties;
}
export interface SlideInProps {
    children: ReactNode;
    from?: 'left' | 'right' | 'top' | 'bottom';
    preset?: MotionPreset;
    distance?: number;
    className?: string;
    style?: CSSProperties;
}
export interface AnimatedListProps {
    children: ReactNode;
    layoutId?: string;
    className?: string;
    style?: CSSProperties;
}
/** Motion implementation types stay internal to the bundle. */
export interface AnimatedListItemProps {
    children: ReactNode;
    preset?: MotionPreset;
    className?: string;
    style?: CSSProperties;
}
export interface InstalledExtensionsGroup<T> {
    id: string;
    title: ReactNode;
    items: readonly T[];
    compact?: boolean;
    className?: string;
    entriesClassName?: string;
}
export interface InstalledExtensionsViewProps<T, Category extends string = string> {
    query: string;
    onQueryChange: (query: string) => void;
    searchPlaceholder: string;
    searchAriaLabel: string;
    clearSearchAriaLabel: string;
    categories?: readonly {
        value: Category;
        label: string;
        count?: number;
        disabled?: boolean;
    }[];
    category?: Category;
    onCategoryChange?: (category: Category) => void;
    categoriesAriaLabel?: string;
    toolbarClassName?: string;
    searchContainerClassName?: string;
    searchClassName?: string;
    categoriesClassName?: string;
    toolbar?: ReactNode;
    status?: ReactNode;
    auxiliary?: ReactNode;
    loading?: boolean;
    loadingContent?: ReactNode;
    isEmpty?: boolean;
    emptyDescription?: ReactNode;
    groups?: readonly InstalledExtensionsGroup<T>[];
    renderEntry?: (item: T, group: InstalledExtensionsGroup<T>) => ReactNode;
    renderGroup?: (group: InstalledExtensionsGroup<T>) => ReactNode;
    children?: ReactNode;
    className?: string;
}
export interface ExtensionDetailIdentity {
    name: ReactNode;
    id?: ReactNode;
    version?: ReactNode;
    icon?: ReactNode;
}
export interface ExtensionDetailViewProps {
    identity: ExtensionDetailIdentity;
    leading?: ReactNode;
    badges?: ReactNode;
    actions?: ReactNode;
    description?: ReactNode;
    metadata?: ReactNode;
    children?: ReactNode;
    className?: string;
    headerClassName?: string;
    descriptionClassName?: string;
}
export interface ChromeActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> {
    label: string;
    icon: ReactNode;
    pressed?: boolean;
    disabled?: boolean;
    title?: string;
    tone?: 'accent';
    actionId?: string;
    className?: string;
    onClick?: () => void;
    htmlAttributes?: ButtonHTMLAttributes<HTMLButtonElement>;
}
export interface SystemChromeActionsProps {
    minimizeLabel: string;
    fullScreenLabel: string;
    closeLabel: string;
    onMinimize?: () => void;
    onToggleFullScreen?: () => void;
    onClose?: () => void;
    isFullScreen?: boolean;
    className?: string;
}
export interface WorkspaceTitlebarProps extends SystemChromeActionsProps {
    title: string;
    subtitle?: string;
    navigation?: ReactNode;
    menuItems: ContextMenuItem[];
    menuLabel: string;
}
export interface FunctionPanelPane {
    id: string;
    title: ReactNode;
    content: ReactNode;
}
export interface FunctionPanelContentFrameProps {
    width?: number;
    fullPanel?: boolean;
    identity?: ReactNode;
    navigation?: ReactNode;
    system?: ReactNode;
    body: ReactNode;
    footer?: ReactNode;
    className?: string;
}
export interface FunctionPanelOverlayTriggerRect {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}
export interface FunctionPanelShellProps {
    width: number;
    collapsed: boolean;
    overlayVisible: boolean;
    onWidthChange(width: number): void;
    onOverlayVisibleChange(visible: boolean): void;
    onWidthTransitioning(transitioning: boolean): void;
    renderContent(width: number): ReactNode;
    getOverlayTriggerRect(): FunctionPanelOverlayTriggerRect | null;
}
/** The icon set the HTML entry can render without a bundler or React install. */
export declare const APP_UI_ICON_NAMES: readonly ["chevron", "check", "loading", "failure"];
export type AppUiIconName = (typeof APP_UI_ICON_NAMES)[number];
export interface AppUiControlMap {
    Button: ButtonProps;
    IconButton: IconButtonProps;
    TextInput: TextInputProps;
    TextArea: TextAreaProps;
    Checkbox: CheckboxProps;
    Select: SelectProps;
    Toggle: ToggleProps;
    NumberInput: NumberInputProps;
    SettingsRow: SettingsRowProps;
    SettingsSection: SettingsSectionProps;
    SettingsStack: SettingsStackProps;
    Inline: InlineProps;
    Grid: GridProps;
    SaveButton: SaveButtonProps;
    VerificationButton: VerificationButtonProps;
    ContextMenu: ContextMenuProps;
    DropdownMenu: DropdownMenuProps;
    Tooltip: TooltipProps;
    ListRow: ListRowProps;
    Tabs: TabsProps;
    EmptyState: EmptyStateProps;
    Busy: BusyStateProps;
    ErrorState: ErrorStateProps;
}
export type AppUiControlName = keyof AppUiControlMap;
/** Props of one named control. Typed per control, never a free-form object. */
export type AppUiControlProps<K extends AppUiControlName> = AppUiControlMap[K];
/** Explicit, actionable failures from the App UI mount API. */
export type AppUiMountErrorCode = 'APP_UI_CONTROL_UNKNOWN' | 'APP_UI_ELEMENT_INVALID' | 'APP_UI_SCOPE_ROOT_INVALID' | 'APP_UI_SCOPE_REQUIRED' | 'APP_UI_NODE_OCCUPIED' | 'APP_UI_HANDLE_DESTROYED' | 'APP_UI_DOCUMENT_CHANGED';
