import type { ButtonHTMLAttributes, CSSProperties, ComponentType, HTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode, RefObject, TextareaHTMLAttributes } from 'react';
export type SettingsGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type SettingsSurfaceVariant = 'card' | 'plain';
export type SettingsRowLayout = 'inline' | 'stacked';
export type SettingsControlSize = 'sm' | 'md' | 'lg' | 'number';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'text';
export type ButtonSize = 'sm' | 'md' | 'lg';
export interface SettingsPageProps extends HTMLAttributes<HTMLDivElement> {
    /** A stable local identifier for the App page. Defaults to `app`. */
    tab?: string;
}
export interface SettingsSurfaceProps extends HTMLAttributes<HTMLDivElement> {
    variant?: SettingsSurfaceVariant;
}
export interface SettingsSectionProps {
    title?: ReactNode;
    description?: ReactNode;
    context?: ReactNode;
    variant?: 'default' | 'hero' | 'double-column' | 'list';
    surface?: SettingsSurfaceVariant;
    children: ReactNode;
    className?: string;
}
export interface SettingsRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    label: ReactNode;
    hint?: ReactNode;
    hintVariant?: 'default' | 'warn';
    control: ReactNode;
    layout?: SettingsRowLayout;
    controlSize?: SettingsControlSize;
    dependent?: boolean;
    truncateText?: boolean;
    className?: string;
}
export interface SettingsStackProps extends HTMLAttributes<HTMLDivElement> {
    gap?: SettingsGap;
    dependent?: boolean;
}
export interface InlineProps extends HTMLAttributes<HTMLDivElement> {
    gap?: SettingsGap;
    align?: 'start' | 'center' | 'end';
    justify?: 'start' | 'center' | 'between' | 'end';
    wrap?: boolean;
}
export interface GridProps extends HTMLAttributes<HTMLDivElement> {
    columns?: 1 | 2 | 3;
    gap?: SettingsGap;
}
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    iconLeft?: ReactNode;
    iconRight?: ReactNode;
}
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'iconLeft' | 'iconRight'> {
    label: string;
    children: ReactElement;
    style?: CSSProperties;
}
export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;
export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}
export interface SelectProps {
    options: SelectOption[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    ariaLabel: string;
    className?: string;
}
export interface ToggleProps {
    checked: boolean | undefined;
    onChange: (checked: boolean) => void;
    ariaLabel: string;
    title?: string;
    disabled?: boolean;
    mixed?: boolean;
    readOnly?: boolean;
    size?: 'default' | 'mini';
}
export interface NumberInputProps {
    value: number | null;
    onChange: (value: number) => void;
    unit?: string;
    unitPlacement?: 'outside' | 'inside';
    commitOnBlur?: boolean;
    min?: number;
    max?: number;
    step?: number;
    precision?: 'int' | 'float';
    fieldWidth?: 'default' | 'wide';
    disabled?: boolean;
    ariaLabel: string;
    emptyValue?: number;
}
export type SaveButtonStatus = 'idle' | 'saving' | 'saved';
export interface SaveButtonProps extends Omit<ButtonProps, 'children' | 'loading' | 'iconLeft' | 'iconRight'> {
    status: SaveButtonStatus;
    labels: Record<SaveButtonStatus, string>;
    onSavedFeedbackEnd: () => void;
}
export interface SchemaSettingsProperty {
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
    title?: string;
    description?: string;
    default?: unknown;
    enum?: readonly unknown[];
    sensitive?: boolean;
    scope?: 'global' | 'per-agent' | 'per-session';
    ui?: {
        control?: string;
        enumLabels?: readonly string[];
    };
    reloadRequired?: boolean;
    migrationVersion?: number;
}
export interface SchemaSettingsSchema {
    properties?: Record<string, SchemaSettingsProperty>;
    required?: readonly string[];
    migrationVersion?: number;
}
export interface SchemaSettingsFormLabels {
    save: string;
    saving: string;
    saved: string;
    sensitiveHint?: string;
    invalidJson?: string;
    saveFailed?: string;
}
export interface SchemaSettingsFormProps {
    schema: SchemaSettingsSchema;
    values: Record<string, unknown> | undefined;
    onSave: (values: Record<string, unknown>) => void | false | Promise<void | false>;
    onInvalidJson?: () => void;
    onSaveError?: (error: unknown) => void;
    labels: SchemaSettingsFormLabels;
    sectionTitle?: ReactNode;
    presentation?: 'legacy' | 'app';
    saving?: boolean;
}
export interface VerificationLabels {
    idle: string;
    testing: string;
    success: string;
    failure: string;
}
export interface VerificationButtonProps {
    onVerify: () => Promise<boolean>;
    resetKey?: string;
    disabled?: boolean;
    labels: VerificationLabels;
    ariaLabel?: string;
    className?: string;
}
export interface ContextMenuItem {
    id?: string;
    label?: ReactNode;
    ariaLabel?: string;
    icon?: ReactNode;
    action?: () => void;
    danger?: boolean;
    disabled?: boolean;
    checked?: boolean;
    heading?: boolean;
    divider?: boolean;
    children?: ContextMenuItem[];
}
export interface ContextMenuProps {
    items: ContextMenuItem[];
    position?: {
        x: number;
        y: number;
    };
    anchorRef?: RefObject<Element | null>;
    onClose: () => void;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    minWidth?: number;
}
export interface DropdownMenuProps {
    items: ContextMenuItem[];
    children: ReactElement<ButtonProps>;
    disabled?: boolean;
}
export interface TooltipTriggerProps {
    ref: (node: HTMLElement | null) => void;
    'aria-describedby'?: string;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onPointerDown: () => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onFocus: () => void;
    onBlur: () => void;
}
export interface TooltipProps {
    content: ReactNode;
    children: ReactNode | ((props: TooltipTriggerProps) => ReactNode);
    id?: string;
    disabled?: boolean;
    delayMs?: number;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    variant?: 'compact' | 'panel';
    anchorClassName?: string;
}
export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
    title: string;
    description?: string;
    leading?: ReactNode;
    meta?: ReactNode;
    metaPlacement?: 'title' | 'below-description';
    trailing?: ReactNode;
    onActivate?: () => void;
    activationExpanded?: boolean;
    activationDisabled?: boolean;
    muted?: boolean;
    layout?: 'default' | 'single-line';
    density?: 'default' | 'compact';
    alignColumns?: boolean;
    overflowItems?: ContextMenuItem[];
    overflowLabel?: string;
    overflowText?: string;
    overflowDisabled?: boolean;
}
export declare const SettingsPage: ComponentType<SettingsPageProps>;
export declare const SettingsSurface: ComponentType<SettingsSurfaceProps>;
export declare const SettingsSection: ComponentType<SettingsSectionProps>;
export declare const SettingsRow: ComponentType<SettingsRowProps>;
export declare const SettingRow: ComponentType<SettingsRowProps>;
export declare const SettingsStack: ComponentType<SettingsStackProps>;
export declare const Inline: ComponentType<InlineProps>;
export declare const Grid: ComponentType<GridProps>;
export declare const Button: ComponentType<ButtonProps>;
export declare const IconButton: ComponentType<IconButtonProps>;
export declare const TextInput: ComponentType<TextInputProps>;
export declare const TextArea: ComponentType<TextAreaProps>;
export declare const Select: ComponentType<SelectProps>;
export declare const Toggle: ComponentType<ToggleProps>;
export declare const Switch: ComponentType<ToggleProps>;
export declare const NumberInput: ComponentType<NumberInputProps>;
export declare const SaveButton: ComponentType<SaveButtonProps>;
export declare const VerificationButton: ComponentType<VerificationButtonProps>;
export declare const ContextMenu: ComponentType<ContextMenuProps>;
export declare const DropdownMenu: ComponentType<DropdownMenuProps>;
export declare const Tooltip: ComponentType<TooltipProps>;
export declare const ListRow: ComponentType<ListRowProps>;
