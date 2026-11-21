import type { ComponentType, ReactElement, ReactNode } from "react";
import type { AppUiControlMap, AppUiControlName, AppUiControlProps, AppUiIconName, AppUiMountErrorCode } from "./_app-types.js";

export type { AppUiControlMap, AppUiControlName, AppUiControlProps, AppUiIconName, AppUiMountErrorCode };

export declare const HANA_APP_UI_SCOPE_ATTRIBUTE: "data-hana-app-ui";
export declare const APP_UI_CONTROLS: { readonly [K in AppUiControlName]: ComponentType<AppUiControlMap[K]> };
export declare class AppUiMountError extends Error { readonly code: AppUiMountErrorCode; }
export interface AppUiHandle<K extends AppUiControlName = AppUiControlName> {
  readonly control: K;
  readonly element: Element;
  update(props: AppUiControlProps<K>): void;
  destroy(): void;
}
export declare function mountAppUi<K extends AppUiControlName>(element: Element, control: K, props: AppUiControlProps<K>): AppUiHandle<K>;
export declare function appUi<K extends AppUiControlName>(control: K, props: AppUiControlProps<K>): ReactElement<AppUiControlProps<K>>;
export declare function appUiIcon(name: AppUiIconName, props?: Record<string, unknown>): ReactElement;
export declare function AppUiControl<K extends AppUiControlName>(props: { control: K; props?: AppUiControlProps<K> }): ReactNode;
