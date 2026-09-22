import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import type { ContextMenuItem } from "./_settings-types.js";
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
