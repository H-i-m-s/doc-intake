// src/host-message-source.ts
function resolveTargetOrigin(targetWindow, explicit) {
  if (explicit) return explicit;
  const hostOrigin = new URLSearchParams(targetWindow.location.search).get("hana-host-origin");
  if (hostOrigin) return hostOrigin;
  try {
    return new URL(targetWindow.document.referrer).origin;
  } catch {
    return "*";
  }
}
function isTrustedHostEvent(event, parentWindow, targetOrigin) {
  if (event.source !== parentWindow) return false;
  return targetOrigin === "*" || event.origin === targetOrigin;
}

// src/ui-actions.ts
var UI_ACTION_SCAN_LIMIT = 600;
var UI_ACTION_OUTLINE_LIMIT = 120;
var UI_ACTION_TEXT_CAP = 4e3;
var UI_ACTION_ADVANCED_MAX_STEPS = 20;
var UI_ACTION_ADVANCED_MAX_DELTA_PX = 4096;
var UI_ACTION_ADVANCED_MAX_SCROLL_PX = 1e4;
var ADVANCED_APP_UI_ACTIONS = /* @__PURE__ */ new Set(["scroll_element", "click_sequence", "drag_element", "press_key"]);
var SUPPORTED_UI_ACTION_KEYS = /* @__PURE__ */ new Set([
  "Enter",
  "Escape",
  "Tab",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace",
  "Delete",
  "Insert"
]);
var GENERATED_ID_PREFIX = "hana-ui-";
var GENERATED_IDS_PER_DOCUMENT = 512;
var nextGeneratedElementId = 1;
var generatedIds = /* @__PURE__ */ new WeakMap();
var generatedElements = /* @__PURE__ */ new WeakMap();
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isDocument(scope) {
  return scope.nodeType === 9;
}
function ownerDocument(scope) {
  return isDocument(scope) ? scope : scope.ownerDocument;
}
function scopeRoot(scope) {
  return isDocument(scope) ? scope.body : scope;
}
function isWithinScope(scope, element) {
  return element.isConnected && (isDocument(scope) ? element.ownerDocument === scope : scope.contains(element));
}
function isHtmlElement(element) {
  const Ctor = element.ownerDocument.defaultView?.HTMLElement;
  return Ctor ? element instanceof Ctor : element instanceof HTMLElement;
}
function isInput(element) {
  const Ctor = element.ownerDocument.defaultView?.HTMLInputElement;
  return Ctor ? element instanceof Ctor : element instanceof HTMLInputElement;
}
function isTextarea(element) {
  const Ctor = element.ownerDocument.defaultView?.HTMLTextAreaElement;
  return Ctor ? element instanceof Ctor : element instanceof HTMLTextAreaElement;
}
function isButton(element) {
  const Ctor = element.ownerDocument.defaultView?.HTMLButtonElement;
  return Ctor ? element instanceof Ctor : element instanceof HTMLButtonElement;
}
function isSelect(element) {
  const Ctor = element.ownerDocument.defaultView?.HTMLSelectElement;
  return Ctor ? element instanceof Ctor : element.tagName === "SELECT";
}
function isAnchor(element) {
  const Ctor = element.ownerDocument.defaultView?.HTMLAnchorElement;
  return Ctor ? element instanceof Ctor : element.tagName === "A";
}
function isVisibleElement(element) {
  if (!isHtmlElement(element)) return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !style || style.display !== "none" && style.visibility !== "hidden";
}
function isActionableElement(element) {
  if (!isHtmlElement(element)) return false;
  return isInput(element) || isTextarea(element) || isButton(element) || isSelect(element) || isAnchor(element) || element.hasAttribute("contenteditable") || element.hasAttribute("onclick") || ["button", "switch", "textbox", "combobox", "slider", "checkbox", "link"].includes(element.getAttribute("role") ?? "");
}
function generatedElementId(element) {
  const doc = element.ownerDocument;
  let byElement = generatedIds.get(doc);
  if (!byElement) {
    byElement = /* @__PURE__ */ new WeakMap();
    generatedIds.set(doc, byElement);
  }
  const existing = byElement.get(element);
  const known = generatedElements.get(doc);
  if (existing && known?.has(existing)) return existing;
  let id = existing;
  if (!id) {
    do {
      id = `${GENERATED_ID_PREFIX}${nextGeneratedElementId++}`;
    } while (doc.getElementById(id));
  }
  byElement.set(element, id);
  let byId = generatedElements.get(doc);
  if (!byId) {
    byId = /* @__PURE__ */ new Map();
    generatedElements.set(doc, byId);
  }
  if (byId.size >= GENERATED_IDS_PER_DOCUMENT) {
    const oldest = byId.keys().next().value;
    if (oldest) byId.delete(oldest);
  }
  byId.set(id, new WeakRef(element));
  return id;
}
function describeUiActionNode(element, advanced) {
  const html = element;
  const node = { tagName: element.tagName.toLowerCase() };
  if (typeof html.id === "string" && html.id) node.id = html.id.slice(0, 80);
  if (typeof html.className === "string" && html.className.trim()) node.className = html.className.trim().slice(0, 120);
  const text = html.textContent?.trim();
  if (text) node.text = text.slice(0, 160);
  if (isInput(element) || isTextarea(element)) {
    if (element.disabled) node.disabled = true;
    if (element.type) node.type = element.type;
  }
  if (html.id) node.elementId = html.id;
  else if (advanced && isActionableElement(element)) node.elementId = generatedElementId(element);
  return node;
}
function describeUiActionDom(scope, advanced) {
  const outline = [];
  const root = scopeRoot(scope);
  if (!root) return { outline, visibleNodeCount: 0, totalNodeCount: 0, truncated: false };
  const walker = ownerDocument(scope).createTreeWalker(root, 1);
  let current = walker.currentNode;
  let visibleNodeCount = 0;
  let totalNodeCount = 0;
  while (current && totalNodeCount < UI_ACTION_SCAN_LIMIT) {
    if (current.nodeType === 1) {
      const element = current;
      totalNodeCount += 1;
      if (isVisibleElement(element)) {
        visibleNodeCount += 1;
        if (outline.length < UI_ACTION_OUTLINE_LIMIT) outline.push(describeUiActionNode(element, advanced));
      }
    }
    current = walker.nextNode();
  }
  return { outline, visibleNodeCount, totalNodeCount, truncated: current !== null };
}
function findUiActionElement(scope, elementId, requireVisible = false) {
  if (typeof elementId !== "string" || !elementId.trim()) return null;
  const id = elementId.trim();
  const doc = ownerDocument(scope);
  const element = id.startsWith(GENERATED_ID_PREFIX) ? generatedElements.get(doc)?.get(id)?.deref() ?? null : doc.getElementById(id);
  return element && isWithinScope(scope, element) && (!requireVisible || isVisibleElement(element)) ? element : null;
}
function clickUiActionElement(element) {
  if (!isHtmlElement(element)) return { ok: false, error: "Target is not an element." };
  if (isInput(element) && (element.type === "file" || element.disabled)) return { ok: false, error: "This element cannot be clicked." };
  if (isButton(element) && element.disabled) return { ok: false, error: "This element cannot be clicked." };
  element.click();
  return { ok: true };
}
function setReactInputValue(element, value) {
  const prototype = isInput(element) ? element.ownerDocument.defaultView?.HTMLInputElement.prototype : element.ownerDocument.defaultView?.HTMLTextAreaElement.prototype;
  const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
}
function typeUiActionElement(element, text, advanced) {
  const value = typeof text === "string" ? text.slice(0, UI_ACTION_TEXT_CAP) : "";
  if (isInput(element)) {
    if (element.type === "file" || element.disabled || element.readOnly) return { ok: false, error: "This element cannot accept text." };
    if (advanced) setReactInputValue(element, `${element.value}${value}`);
    else element.value = `${element.value}${value}`;
  } else if (isTextarea(element)) {
    if (element.disabled || element.readOnly) return { ok: false, error: "This element cannot accept text." };
    if (advanced) setReactInputValue(element, `${element.value}${value}`);
    else element.value = `${element.value}${value}`;
  } else return { ok: false, error: "This element cannot accept text." };
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}
function advancedUiActionElement(scope, elementId) {
  const element = findUiActionElement(scope, elementId, true);
  return element && isHtmlElement(element) ? element : null;
}
function finiteBoundedUiActionNumber(value, limit) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}
function scrollUiActionElement(scope, payload) {
  const scrollX = payload.scrollX === void 0 ? 0 : finiteBoundedUiActionNumber(payload.scrollX, UI_ACTION_ADVANCED_MAX_SCROLL_PX);
  const scrollY = payload.scrollY === void 0 ? 0 : finiteBoundedUiActionNumber(payload.scrollY, UI_ACTION_ADVANCED_MAX_SCROLL_PX);
  if (scrollX === null || scrollY === null || scrollX === 0 && scrollY === 0) return { ok: false, code: "UI_ACTION_SCROLL_INVALID", error: "scroll_element requires bounded non-zero scroll coordinates." };
  const target = payload.elementId === void 0 ? isDocument(scope) ? scope.scrollingElement ?? scope.documentElement : scope : advancedUiActionElement(scope, payload.elementId);
  if (!target || !isHtmlElement(target)) return { ok: false, code: "UI_ACTION_ELEMENT_NOT_FOUND", error: "No visible element matches this elementId." };
  target.scrollLeft += scrollX;
  target.scrollTop += scrollY;
  target.dispatchEvent(new Event("scroll", { bubbles: false }));
  return { ok: true, result: { scrollLeft: target.scrollLeft, scrollTop: target.scrollTop } };
}
function clickSequenceIds(payload) {
  const raw = Array.isArray(payload.steps) ? payload.steps : payload.elementIds;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > UI_ACTION_ADVANCED_MAX_STEPS) return null;
  const ids = raw.map((item) => {
    if (typeof item === "string") return item.trim();
    if (!isRecord(item)) return "";
    const direct = typeof item.elementId === "string" ? item.elementId.trim() : "";
    const legacy = Array.isArray(item.elementIds) && item.elementIds.length === 1 && typeof item.elementIds[0] === "string" ? item.elementIds[0].trim() : "";
    return direct || legacy;
  });
  return ids.every(Boolean) ? ids : null;
}
function clickSequenceUiAction(scope, payload) {
  const ids = clickSequenceIds(payload);
  if (!ids) return { ok: false, code: "UI_ACTION_SEQUENCE_INVALID", error: "click_sequence requires one to twenty element IDs." };
  let completedCount = 0;
  for (const [index, id] of ids.entries()) {
    const element = advancedUiActionElement(scope, id);
    if (!element) return { ok: false, code: "UI_ACTION_ELEMENT_NOT_FOUND", error: `Sequence target ${index + 1} is unavailable.`, result: { completedCount, failedIndex: index } };
    const clicked = clickUiActionElement(element);
    if (clicked.ok === false) return { ok: false, code: "UI_ACTION_ELEMENT_NOT_OPERABLE", error: clicked.error, result: { completedCount, failedIndex: index } };
    completedCount += 1;
  }
  return { ok: true, result: { completedCount } };
}
function dispatchMouse(target, type, x, y, buttons) {
  const Ctor = target.ownerDocument.defaultView?.MouseEvent ?? MouseEvent;
  target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons }));
}
function dispatchPointer(target, type, x, y, buttons) {
  const view = target.ownerDocument.defaultView;
  const Ctor = view?.PointerEvent ?? view?.MouseEvent ?? MouseEvent;
  target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons }));
}
function dragUiActionElement(scope, payload) {
  const source = advancedUiActionElement(scope, payload.elementId);
  if (!source) return { ok: false, code: "UI_ACTION_ELEMENT_NOT_FOUND", error: "No visible source element matches this elementId." };
  const deltaX = payload.deltaX === void 0 ? 0 : finiteBoundedUiActionNumber(payload.deltaX, UI_ACTION_ADVANCED_MAX_DELTA_PX);
  const deltaY = payload.deltaY === void 0 ? 0 : finiteBoundedUiActionNumber(payload.deltaY, UI_ACTION_ADVANCED_MAX_DELTA_PX);
  if (deltaX === null || deltaY === null) return { ok: false, code: "UI_ACTION_DRAG_INVALID", error: "drag_element coordinates must be finite and bounded." };
  const target = payload.targetElementId === void 0 ? null : advancedUiActionElement(scope, payload.targetElementId);
  if (payload.targetElementId !== void 0 && !target) return { ok: false, code: "UI_ACTION_ELEMENT_NOT_FOUND", error: "No visible target element matches targetElementId." };
  if (!target && deltaX === 0 && deltaY === 0) return { ok: false, code: "UI_ACTION_DRAG_TARGET_REQUIRED", error: "drag_element requires a target element or non-zero delta." };
  const from = source.getBoundingClientRect();
  const startX = from.left + from.width / 2;
  const startY = from.top + from.height / 2;
  const to = target?.getBoundingClientRect();
  const endX = to ? to.left + to.width / 2 : startX + deltaX;
  const endY = to ? to.top + to.height / 2 : startY + deltaY;
  const destination = target ?? source;
  dispatchPointer(source, "pointerdown", startX, startY, 1);
  dispatchMouse(source, "mousedown", startX, startY, 1);
  for (const progress of [0.25, 0.5, 0.75]) {
    const x = startX + (endX - startX) * progress;
    const y = startY + (endY - startY) * progress;
    dispatchPointer(destination, "pointermove", x, y, 1);
    dispatchMouse(destination, "mousemove", x, y, 1);
  }
  dispatchPointer(destination, "pointerup", endX, endY, 0);
  dispatchMouse(destination, "mouseup", endX, endY, 0);
  return { ok: true, result: { dragged: true, endX, endY } };
}
function pressKeyUiAction(scope, payload) {
  const raw = payload.key === void 0 ? payload.keys : [payload.key];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > UI_ACTION_ADVANCED_MAX_STEPS || raw.some((key) => typeof key !== "string")) return { ok: false, code: "UI_ACTION_KEY_INVALID", error: "press_key requires supported key names or single characters." };
  const keys = raw.map((key) => key.trim());
  if (keys.some((key) => !(key.length === 1 || SUPPORTED_UI_ACTION_KEYS.has(key)))) return { ok: false, code: "UI_ACTION_KEY_INVALID", error: "press_key requires supported key names or single characters." };
  const focused = ownerDocument(scope).activeElement;
  const target = payload.elementId === void 0 ? focused && isWithinScope(scope, focused) && isHtmlElement(focused) ? focused : null : advancedUiActionElement(scope, payload.elementId);
  if (!target) return { ok: false, code: "UI_ACTION_ELEMENT_NOT_FOUND", error: "No focused visible element is available for press_key." };
  if (payload.elementId !== void 0) target.focus();
  const Ctor = target.ownerDocument.defaultView?.KeyboardEvent ?? KeyboardEvent;
  const modifiers = { ctrlKey: payload.ctrlKey === true, metaKey: payload.metaKey === true, altKey: payload.altKey === true, shiftKey: payload.shiftKey === true };
  for (const key of keys) {
    target.dispatchEvent(new Ctor("keydown", { bubbles: true, cancelable: true, key, ...modifiers }));
    target.dispatchEvent(new Ctor("keyup", { bubbles: true, cancelable: true, key, ...modifiers }));
  }
  return { ok: true, result: { pressedKeys: keys } };
}
function performHostUiAction(scope, payload, advancedAppSurface = false) {
  const action = isRecord(payload) && typeof payload.action === "string" ? payload.action : "";
  if (action === "describe_dom") return { ok: true, result: describeUiActionDom(scope, advancedAppSurface) };
  if (action === "read_state") return { ok: true, result: { state: {} } };
  if (action === "click_element") {
    const element = findUiActionElement(scope, isRecord(payload) ? payload.elementId : null, advancedAppSurface);
    if (!element) return { ok: false, code: "UI_ACTION_ELEMENT_NOT_FOUND", error: "No element matches this elementId." };
    const clicked = clickUiActionElement(element);
    return clicked.ok === true ? { ok: true, result: { clicked: true } } : { ok: false, code: "UI_ACTION_ELEMENT_NOT_OPERABLE", error: clicked.error };
  }
  if (action === "type_text") {
    const element = findUiActionElement(scope, isRecord(payload) ? payload.elementId : null, advancedAppSurface);
    if (!element) return { ok: false, code: "UI_ACTION_ELEMENT_NOT_FOUND", error: "No element matches this elementId." };
    const typed = typeUiActionElement(element, isRecord(payload) ? payload.text : "", advancedAppSurface);
    return typed.ok === true ? { ok: true, result: { typed: true } } : { ok: false, code: "UI_ACTION_ELEMENT_NOT_OPERABLE", error: typed.error };
  }
  if (ADVANCED_APP_UI_ACTIONS.has(action) && !advancedAppSurface) return { ok: false, code: "UI_ACTION_UNSUPPORTED_FOR_APP_CARD", error: `App cards do not support ${action}.` };
  if (!isRecord(payload)) return { ok: false, code: "UI_ACTION_UNKNOWN_ACTION", error: `Unknown UI action: ${action || "(missing)"}.` };
  if (action === "scroll_element") return scrollUiActionElement(scope, payload);
  if (action === "click_sequence") return clickSequenceUiAction(scope, payload);
  if (action === "drag_element") return dragUiActionElement(scope, payload);
  if (action === "press_key") return pressKeyUiAction(scope, payload);
  return { ok: false, code: "UI_ACTION_UNKNOWN_ACTION", error: `Unknown UI action: ${action || "(missing)"}.` };
}

// ../plugin-protocol/dist/index.js
var PLUGIN_UI_PROTOCOL = "hana.plugin.ui";
var PLUGIN_UI_PROTOCOL_VERSION = 1;
var APP_SURFACE_SESSION_HEADER = "X-Hana-App-Surface-Session";
var APP_SURFACE_SESSION_QUERY = "appSurfaceSession";
var APP_INPUT_PANEL_MESSAGE = {
  CONTEXT: "hana.input-panel.context",
  SUBMIT: "hana.input-panel.submit",
  PRESENTATION: "hana.input-panel.presentation"
};
var APP_INPUT_PANEL_DATA_MAX_BYTES = 64 * 1024;
var PLUGIN_UI_ERROR_CODE = {
  BAD_MESSAGE: "BAD_MESSAGE",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  UNKNOWN_TYPE: "UNKNOWN_TYPE",
  CAPABILITY_DENIED: "CAPABILITY_DENIED",
  SLOT_DENIED: "SLOT_DENIED",
  TIMEOUT: "TIMEOUT",
  HOST_ERROR: "HOST_ERROR"
};
var PLUGIN_UI_CAPABILITY = {
  TOAST_SHOW: "toast.show",
  EXTERNAL_OPEN: "external.open",
  SESSION_FILE_OPEN: "sessionFile.open",
  RESOURCE_OPEN: "resource.open",
  RESOURCE_PICK: "resource.pick",
  RESOURCE_SAVE_FILE: "resource.saveFile",
  RESOURCE_REQUEST_ACCESS: "resource.requestAccess",
  UI_RESIZE: "ui.resize",
  CLIPBOARD_WRITE_TEXT: "clipboard.writeText",
  // 实例态（卡实例私有的草稿纸，随 Client Layout Profile 持久化，只在 card slot 生效）
  STATE_GET: "hana.state.get",
  STATE_SET: "hana.state.set",
  // 应用态（插件级 KV，pluginId 命名空间，经宿主 owner 凭证代调 server 存储）。
  // v1 插件专属的冻结兼容层能力，与上面的 v2 卡实例态 hana.state 并存，互不影响。
  STORAGE_GET: "hana.storage.get",
  STORAGE_GET_ALL: "hana.storage.getAll",
  STORAGE_SET: "hana.storage.set",
  STORAGE_DELETE: "hana.storage.delete",
  // 功能面板：插件把要显示的内容推给宿主，宿主用内置原语画（只在 card slot
  // 生效，面板是主卡的一块投影，不是第二个插件实例）
  PANEL_SET: "hana.panel.set",
  // 回传：把一次用户操作送进会话并唤醒 agent。只在 card slot 生效；
  // 手势由 SDK 注入层采集，作者不可自报。进模型走既有起回合授权。
  EMIT: "hana.emit",
  // 安静日志：写入独立活动仓，不唤醒 agent。只在 card slot 生效。
  TRACK: "hana.track",
  // 宿主驱动：看卡 / 点卡。只由宿主发 request，不是作者向宿主申请的能力。
  UI_ACTION: "hana.ui.action"
};
var PLUGIN_UI_HOST_EVENT = {
  THEME_CHANGED: "hana.theme.changed",
  SURFACE_RUNTIME_CHANGED: "hana.surface.runtime.changed",
  SURFACE_ENVELOPE_CHANGED: "hana.surface.envelope.changed",
  // 应用态变更广播：宿主消费 server 的 plugin-storage-changed 后，向同 pluginId 的
  // 所有已挂载插件卡 iframe 推送（不带值，只带 keys；订阅方自行重拉）
  STORAGE_CHANGED: "hana.storage.changed",
  // 用户在功能面板里点了什么：宿主把事件送回贡献这块面板的那张卡
  PANEL_EVENT: "hana.panel.event",
  // 到了声明的刷新节奏：宿主叫插件重推一次内容（面板不可见时不发）
  PANEL_REFRESH: "hana.panel.refresh"
};
var PLUGIN_CARD_STATE_MAX_BYTES = 64 * 1024;
var APP_STORAGE_CAPABILITY = {
  GET: "hana.app.storage.get",
  GET_ALL: "hana.app.storage.getAll",
  SET: "hana.app.storage.set",
  DELETE: "hana.app.storage.delete",
  KEYS: "hana.app.storage.keys"
};
var APP_STORAGE_HOST_EVENT = {
  CHANGED: "hana.app.storage.changed"
};
var APP_CARD_CAPABILITY = { OPEN: "hana.cards.open" };
var APP_SESSION_CAPABILITY = {
  GET_ACTIVE: "hana.sessions.get-active",
  SUBSCRIBE: "hana.sessions.subscribe-active",
  UNSUBSCRIBE: "hana.sessions.unsubscribe-active",
  FOCUS: "hana.sessions.focus"
};
var APP_SESSION_HOST_EVENT = {
  ACTIVE_CHANGED: "hana.sessions.active-changed",
  ERROR: "hana.sessions.error"
};
var APP_SURFACE_CAPABILITY = {
  SET_INTERACTIVE_REGIONS: "hana.surface.set-interactive-regions"
};
function parseAppSurfaceInteractiveRegions(value) {
  if (!isObject(value) || Object.keys(value).length !== 1 || !Array.isArray(value.regions)) {
    return { ok: false, error: "hana.surface.setInteractiveRegions requires exactly one regions array." };
  }
  if (value.regions.length > 64)
    return { ok: false, error: "hana.surface.setInteractiveRegions accepts at most 64 regions." };
  const regions = [];
  for (const region of value.regions) {
    if (!isObject(region) || Object.keys(region).length !== 4)
      return { ok: false, error: "Each interactive region must contain exactly x, y, width, and height." };
    const { x, y, width, height } = region;
    if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height))
      return { ok: false, error: "Interactive region coordinates must be finite numbers." };
    if (width <= 0 || height <= 0 || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(width) > 1e6 || Math.abs(height) > 1e6)
      return { ok: false, error: "Interactive region bounds are invalid." };
    regions.push({ x, y, width, height });
  }
  return { ok: true, value: { regions } };
}
var APP_SURFACE_HOST_EVENT = {
  CONTEXT: "hana.surface.context"
};
var MESSAGE_KINDS = /* @__PURE__ */ new Set([
  "event",
  "request",
  "response",
  "error"
]);
function isObject(value) {
  return typeof value === "object" && value !== null;
}
function badMessage(message) {
  return {
    ok: false,
    error: {
      code: PLUGIN_UI_ERROR_CODE.BAD_MESSAGE,
      message
    }
  };
}
function parsePluginUiMessage(value) {
  if (!isObject(value)) {
    return badMessage("Plugin UI messages must be objects.");
  }
  if (value.protocol !== PLUGIN_UI_PROTOCOL) {
    return badMessage("Plugin UI message protocol is missing or invalid.");
  }
  if (value.version !== PLUGIN_UI_PROTOCOL_VERSION) {
    return {
      ok: false,
      error: {
        code: PLUGIN_UI_ERROR_CODE.UNSUPPORTED_VERSION,
        message: `Unsupported Plugin UI protocol version: ${String(value.version)}.`
      }
    };
  }
  if (typeof value.kind !== "string" || !MESSAGE_KINDS.has(value.kind)) {
    return badMessage("Plugin UI message kind is missing or invalid.");
  }
  if (typeof value.type !== "string" || value.type.trim() === "") {
    return badMessage("Plugin UI message type must be a non-empty string.");
  }
  const kind = value.kind;
  if (kind !== "event" && (typeof value.id !== "string" || value.id.trim() === "")) {
    return badMessage(`Plugin UI ${kind} messages must include a non-empty id.`);
  }
  if (kind === "error") {
    if (!isObject(value.error)) {
      return badMessage("Plugin UI error messages must include an error object.");
    }
    if (typeof value.error.code !== "string" || value.error.code.trim() === "") {
      return badMessage("Plugin UI error code must be a non-empty string.");
    }
    if (typeof value.error.message !== "string" || value.error.message.trim() === "") {
      return badMessage("Plugin UI error message must be a non-empty string.");
    }
  }
  return {
    ok: true,
    value
  };
}
var PLUGIN_MANIFEST_TOP_LEVEL_FIELDS = [
  "manifestVersion",
  "id",
  "name",
  "version",
  "description",
  "minAppVersion",
  "trust",
  "hidden",
  "activationEvents",
  "capabilities",
  "sensitiveCapabilities",
  "permissions",
  "network",
  "formFactors",
  "ui",
  "contributes",
  "dev"
];
var PLUGIN_MANIFEST_CONTRIBUTES_KEYS = [
  "cards",
  "agentTypes",
  "configuration",
  "settingsTab",
  "page",
  "widget"
];
var PLUGIN_V2_MANIFEST_CONTRIBUTES_KEYS = [
  "settings",
  "ui",
  "cards",
  "agentTypes",
  "messageRenderers",
  "providers",
  "nativeProviders",
  "previewers",
  "cliFlags",
  "homeActions"
];
var PLUGIN_MANIFEST_TRUST_LEVELS = ["restricted", "full-access"];
var PLUGIN_MANIFEST_ACTIVATION_EVENT_NAMES = [
  "onStartup",
  "onPageOpen",
  "onWidgetOpen",
  "onToolCall",
  "onBusRequest"
];
var TOP_LEVEL_FIELD_SET = new Set(PLUGIN_MANIFEST_TOP_LEVEL_FIELDS);
var CONTRIBUTES_KEY_SET = new Set(PLUGIN_MANIFEST_CONTRIBUTES_KEYS);
var V2_CONTRIBUTES_KEY_SET = new Set(PLUGIN_V2_MANIFEST_CONTRIBUTES_KEYS);
var TRUST_LEVEL_SET = new Set(PLUGIN_MANIFEST_TRUST_LEVELS);
var ACTIVATION_EVENT_EXACT_SET = /* @__PURE__ */ new Set([
  "*",
  ...PLUGIN_MANIFEST_ACTIVATION_EVENT_NAMES
]);
var UI_HOST_CAPABILITY_VALUES = Object.values(PLUGIN_UI_CAPABILITY);
var UI_HOST_CAPABILITY_SET = new Set(UI_HOST_CAPABILITY_VALUES);

// src/input-panel.ts
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function copyJson(value) {
  const ancestors = /* @__PURE__ */ new Set();
  const copy = (current, depth) => {
    if (depth > 32) throw new Error("Input panel JSON exceeds the maximum depth of 32.");
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number" && Number.isFinite(current)) return current;
    if (typeof current !== "object" || current === null) throw new Error("Input panel values must be valid JSON.");
    if (ancestors.has(current)) throw new Error("Input panel values must not contain cycles.");
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      throw new Error("Input panel values must contain only JSON objects and arrays.");
    }
    if (Object.getOwnPropertySymbols(current).length > 0) throw new Error("Input panel JSON must not contain symbol keys.");
    ancestors.add(current);
    let result;
    if (Array.isArray(current)) {
      const array = [];
      for (let index = 0; index < current.length; index++) {
        if (!Object.prototype.hasOwnProperty.call(current, index)) throw new Error("Input panel JSON must not contain sparse arrays.");
        array.push(copy(current[index], depth + 1));
      }
      result = array;
    } else {
      const object = /* @__PURE__ */ Object.create(null);
      for (const key of Object.keys(current)) object[key] = copy(current[key], depth + 1);
      result = object;
    }
    ancestors.delete(current);
    return result;
  };
  const serialized = JSON.stringify(copy(value, 0));
  if (new TextEncoder().encode(serialized).byteLength > APP_INPUT_PANEL_DATA_MAX_BYTES) {
    throw new Error(`Input panel JSON exceeds ${APP_INPUT_PANEL_DATA_MAX_BYTES} bytes.`);
  }
  return JSON.parse(serialized);
}
function readContext(value) {
  if (!record(value)) throw new Error("Input panel context must be an object.");
  for (const key of ["appId", "sessionId", "panelId", "instanceId"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) throw new Error(`Input panel context is missing ${key}.`);
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new Error("Input panel revision is invalid.");
  const presentationRevision = value.presentationRevision === void 0 ? 0 : value.presentationRevision;
  if (!Number.isSafeInteger(presentationRevision) || Number(presentationRevision) < 0) throw new Error("Input panel presentation revision is invalid.");
  if (value.confirmId !== null && (typeof value.confirmId !== "string" || !value.confirmId.trim())) {
    throw new Error("Input panel confirmation identity is invalid.");
  }
  if (!["pending", "confirmed", "rejected", "timeout", "aborted", "active"].includes(String(value.status))) {
    throw new Error("Input panel status is invalid.");
  }
  if (typeof value.retained !== "boolean" || typeof value.title !== "string" || typeof value.message !== "string") {
    throw new Error("Input panel context is missing its presentation fields.");
  }
  const rawPresentation = value.presentation === void 0 ? { height: null, collapsedHeight: 32, expanded: true } : value.presentation;
  if (!record(rawPresentation) || Object.keys(rawPresentation).some((key) => key !== "height" && key !== "collapsedHeight" && key !== "expanded") || rawPresentation.height !== null && (typeof rawPresentation.height !== "number" || !Number.isFinite(rawPresentation.height) || rawPresentation.height < 24 || rawPresentation.height > 4096) || typeof rawPresentation.collapsedHeight !== "number" || !Number.isFinite(rawPresentation.collapsedHeight) || rawPresentation.collapsedHeight < 24 || rawPresentation.collapsedHeight > 4096 || typeof rawPresentation.expanded !== "boolean") {
    throw new Error("Input panel presentation is invalid.");
  }
  return {
    appId: value.appId,
    sessionId: value.sessionId,
    panelId: value.panelId,
    instanceId: value.instanceId,
    revision: value.revision,
    presentationRevision,
    confirmId: value.confirmId,
    status: value.status,
    retained: value.retained,
    title: value.title,
    message: value.message,
    data: copyJson(value.data ?? null),
    requestedSchema: copyJson(value.requestedSchema ?? null),
    presentation: { height: rawPresentation.height, collapsedHeight: rawPresentation.collapsedHeight, expanded: rawPresentation.expanded }
  };
}
function copyContext(context) {
  return { ...context, data: copyJson(context.data), requestedSchema: copyJson(context.requestedSchema), presentation: { ...context.presentation } };
}
function readPresentationPatch(value) {
  if (!record(value) || Object.keys(value).some((key) => key !== "height" && key !== "collapsedHeight" && key !== "expanded")) {
    throw new TypeError("hana.inputPanel.setPresentation requires height, collapsedHeight, or expanded.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(value).length || Object.values(Object.getOwnPropertyDescriptors(value)).some((descriptor) => !descriptor.enumerable || !("value" in descriptor))) {
    throw new TypeError("Input panel presentation must be a plain JSON object with data fields.");
  }
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(value, "height")) {
    if (value.height !== null && (typeof value.height !== "number" || !Number.isFinite(value.height) || value.height < 24 || value.height > 4096)) throw new TypeError("Input panel height must be null or 24\u20134096.");
    patch.height = value.height;
  }
  if (Object.prototype.hasOwnProperty.call(value, "collapsedHeight")) {
    if (typeof value.collapsedHeight !== "number" || !Number.isFinite(value.collapsedHeight) || value.collapsedHeight < 24 || value.collapsedHeight > 4096) throw new TypeError("Input panel collapsedHeight must be 24\u20134096.");
    patch.collapsedHeight = value.collapsedHeight;
  }
  if (Object.prototype.hasOwnProperty.call(value, "expanded")) {
    if (typeof value.expanded !== "boolean") throw new TypeError("Input panel expanded must be boolean.");
    patch.expanded = value.expanded;
  }
  if (!Object.keys(patch).length) throw new TypeError("hana.inputPanel.setPresentation requires at least one field.");
  return patch;
}
function readPresentationResponse(value, context) {
  if (!record(value) || !record(value.presentation) || !Number.isSafeInteger(value.presentationRevision)) throw new Error("The input panel presentation response is invalid.");
  const parsed = readContext({ ...context, presentation: value.presentation, presentationRevision: value.presentationRevision });
  return { presentation: parsed.presentation, presentationRevision: parsed.presentationRevision };
}
function createInputPanelBridge(post) {
  let context = null;
  let generation = 0;
  let submitHandler = null;
  let presentationSequence = 0;
  const presentationPending = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of listeners) listener(context ? copyContext(context) : null);
  };
  const clear = () => {
    context = null;
    generation++;
    for (const pending of presentationPending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("The input panel binding was replaced."));
    }
    presentationPending.clear();
    notify();
  };
  const rejectPresentationPending = (message) => {
    for (const pending of presentationPending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    presentationPending.clear();
  };
  const fail = (message, code, error) => post({
    protocol: PLUGIN_UI_PROTOCOL,
    version: PLUGIN_UI_PROTOCOL_VERSION,
    id: message.id,
    kind: "error",
    type: message.type,
    error: { code, message: error }
  });
  function handleMessage(message) {
    if (message.kind === "event" && message.type === APP_INPUT_PANEL_MESSAGE.CONTEXT) {
      if (message.payload === null) clear();
      else {
        let next;
        try {
          next = readContext(message.payload);
        } catch (error) {
          clear();
          console.warn("[hana] invalid input panel context:", error);
          return true;
        }
        const sameBinding = context?.panelId === next.panelId && context.appId === next.appId && context.sessionId === next.sessionId && context.confirmId === next.confirmId && context.status === next.status && context.instanceId === next.instanceId && context.revision === next.revision;
        if (sameBinding && context && next.presentationRevision < context.presentationRevision) return true;
        if (!sameBinding) rejectPresentationPending("The input panel binding was replaced.");
        context = next;
        if (!sameBinding) generation++;
        notify();
      }
      return true;
    }
    if ((message.kind === "response" || message.kind === "error") && message.type === APP_INPUT_PANEL_MESSAGE.PRESENTATION && message.id) {
      const pending = presentationPending.get(message.id);
      if (!pending) return false;
      presentationPending.delete(message.id);
      clearTimeout(pending.timeout);
      if (pending.generation !== generation) {
        pending.reject(new Error("The input panel binding was replaced."));
      } else if (message.kind === "error") pending.reject(new Error(message.error?.message || "The input panel presentation could not be updated."));
      else {
        try {
          const result = readPresentationResponse(message.payload, context);
          if (context && result.presentationRevision >= context.presentationRevision) {
            context = { ...context, ...result };
            notify();
          }
          pending.resolve(result);
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error("The input panel presentation response is invalid."));
        }
      }
      return true;
    }
    if (message.kind !== "request" || message.type !== APP_INPUT_PANEL_MESSAGE.SUBMIT) return false;
    if (!message.id) return true;
    const request = message.payload;
    const bound = context;
    if (!record(request) || !bound || bound.status !== "pending" || !bound.confirmId || request.panelId !== bound.panelId || request.instanceId !== bound.instanceId || request.revision !== bound.revision) {
      fail(message, "INPUT_PANEL_STALE", "This request does not match the active input panel question.");
      return true;
    }
    const handler = submitHandler;
    if (!handler && bound.requestedSchema !== null) {
      fail(message, "INPUT_PANEL_SUBMIT_UNHANDLED", "Register hana.inputPanel.onSubmit to provide this question\u2019s answer.");
      return true;
    }
    const requestedGeneration = generation;
    const identity = {
      panelId: bound.panelId,
      instanceId: bound.instanceId,
      revision: bound.revision
    };
    void Promise.resolve().then(() => handler ? handler(copyContext(bound)) : null).then((value) => {
      if (generation !== requestedGeneration) {
        fail(message, "INPUT_PANEL_STALE", "The input panel changed before its answer was ready.");
        return;
      }
      post({
        protocol: PLUGIN_UI_PROTOCOL,
        version: PLUGIN_UI_PROTOCOL_VERSION,
        id: message.id,
        kind: "response",
        type: message.type,
        payload: { ...identity, value: copyJson(value) }
      });
    }).catch((error) => {
      fail(message, "INPUT_PANEL_SUBMIT_FAILED", error instanceof Error ? error.message : "The input panel could not provide an answer.");
    });
    return true;
  }
  const api = {
    getContext: () => context ? copyContext(context) : null,
    onContextChanged(callback) {
      listeners.add(callback);
      callback(context ? copyContext(context) : null);
      return () => {
        listeners.delete(callback);
      };
    },
    onSubmit(handler) {
      if (typeof handler !== "function") throw new TypeError("hana.inputPanel.onSubmit requires a function.");
      submitHandler = handler;
      return () => {
        if (submitHandler === handler) submitHandler = null;
      };
    },
    async setPresentation(patch) {
      const bound = context;
      const normalized = readPresentationPatch(patch);
      if (!bound) throw new Error("The input panel is not ready.");
      const requestedGeneration = generation;
      const id = `input-panel-presentation:${bound.panelId}:${bound.instanceId}:${Date.now().toString(36)}:${++presentationSequence}`;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          presentationPending.delete(id);
          reject(new Error("The input panel presentation request timed out."));
        }, 1e4);
        presentationPending.set(id, { generation: requestedGeneration, resolve, reject, timeout });
        const failDelivery = (error) => {
          const pending = presentationPending.get(id);
          if (!pending) return;
          presentationPending.delete(id);
          clearTimeout(pending.timeout);
          pending.reject(error instanceof Error ? error : new Error("The input panel presentation request could not be delivered."));
        };
        try {
          post({
            protocol: PLUGIN_UI_PROTOCOL,
            version: PLUGIN_UI_PROTOCOL_VERSION,
            id,
            kind: "request",
            type: APP_INPUT_PANEL_MESSAGE.PRESENTATION,
            payload: { panelId: bound.panelId, instanceId: bound.instanceId, revision: bound.revision, presentationRevision: bound.presentationRevision, presentation: normalized }
          }, failDelivery);
        } catch (error) {
          failDelivery(error);
        }
        if (generation !== requestedGeneration) {
          const pending = presentationPending.get(id);
          if (pending) {
            presentationPending.delete(id);
            clearTimeout(pending.timeout);
            pending.reject(new Error("The input panel binding was replaced."));
          }
        }
      });
    }
  };
  return { api, handleMessage, clear };
}

// src/index.ts
var HanaPluginError = class extends Error {
  name = "HanaPluginError";
  code;
  details;
  constructor(error) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
  }
};
var fallbackIdSeq = 0;
var DEFAULT_PLUGIN_MAX_FRAME_RATE = 60;
var MAX_PLUGIN_MAX_FRAME_RATE = 240;
function defaultIdFactory() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackIdSeq += 1;
  return `hana-plugin-${Date.now()}-${fallbackIdSeq}`;
}
function getBrowserWindow() {
  if (typeof window === "undefined") {
    throw new Error("@hana/plugin-sdk requires a browser iframe window.");
  }
  return window;
}
var HANA_THEME_STYLE_ATTR = "data-hana-theme-style";
async function applyHostThemeStylesheet(doc, cssUrl) {
  const response = await fetch(cssUrl, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`hana theme stylesheet request failed with ${response.status}`);
  }
  const css = await response.text();
  const head = doc.head ?? doc.documentElement;
  if (!head) throw new Error("hana theme stylesheet has nowhere to attach");
  let element = doc.querySelector(`style[${HANA_THEME_STYLE_ATTR}]`);
  if (!element) {
    element = doc.createElement("style");
    element.setAttribute(HANA_THEME_STYLE_ATTR, "");
  }
  element.textContent = css;
  head.appendChild(element);
}
function isThemePalettes(value) {
  if (typeof value !== "object" || value === null) return false;
  const palettes = value;
  return ["light", "dark"].every((scheme) => {
    const palette = palettes[scheme];
    return typeof palette === "object" && palette !== null && typeof palette.theme === "string" && typeof palette.cssUrl === "string";
  });
}
function readInitialTheme(targetWindow) {
  const params = new URLSearchParams(targetWindow.location.search);
  const rawAppearance = params.get("hana-theme-appearance");
  const lightTheme = params.get("hana-palette-light-theme");
  const lightCssUrl = params.get("hana-palette-light-css");
  const darkTheme = params.get("hana-palette-dark-theme");
  const darkCssUrl = params.get("hana-palette-dark-css");
  return {
    theme: params.get("hana-theme") ?? void 0,
    cssUrl: params.get("hana-css") ?? void 0,
    appearance: rawAppearance === "light" || rawAppearance === "dark" ? rawAppearance : void 0,
    palettes: lightTheme && lightCssUrl && darkTheme && darkCssUrl ? { light: { theme: lightTheme, cssUrl: lightCssUrl }, dark: { theme: darkTheme, cssUrl: darkCssUrl } } : void 0
  };
}
function normalizeFrameRate(value, fallback = DEFAULT_PLUGIN_MAX_FRAME_RATE) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(MAX_PLUGIN_MAX_FRAME_RATE, Math.round(value)));
}
function createRuntimeSnapshot({
  visible,
  maxFrameRate,
  slot,
  reason
}) {
  const normalizedMaxFrameRate = visible ? normalizeFrameRate(maxFrameRate) : 0;
  const active = visible && normalizedMaxFrameRate > 0;
  return {
    visible,
    active,
    maxFrameRate: active ? normalizedMaxFrameRate : 0,
    motion: active ? "full" : "paused",
    ...slot === "page" || slot === "widget" || slot === "card" || slot === "settings" || slot === "function-panel" || slot === "slot" ? { slot } : {},
    ...reason ? { reason } : {}
  };
}
function readInitialRuntimeSnapshot(targetWindow) {
  const params = new URLSearchParams(targetWindow.location.search);
  const rawVisible = params.get("hana-visible");
  const visible = rawVisible === "0" || rawVisible === "false" ? false : true;
  const rawFrameRate = params.get("hana-max-fps");
  const parsedFrameRate = rawFrameRate === null ? NaN : Number(rawFrameRate);
  const maxFrameRate = Number.isFinite(parsedFrameRate) ? parsedFrameRate : DEFAULT_PLUGIN_MAX_FRAME_RATE;
  return createRuntimeSnapshot({
    visible,
    maxFrameRate,
    reason: "initial"
  });
}
function normalizeRuntimeSnapshotPayload(payload, current) {
  if (typeof payload !== "object" || payload === null) return null;
  const record2 = payload;
  const visible = typeof record2.visible === "boolean" ? record2.visible : current.visible;
  const requestedFrameRate = normalizeFrameRate(
    record2.maxFrameRate,
    current.maxFrameRate > 0 ? current.maxFrameRate : DEFAULT_PLUGIN_MAX_FRAME_RATE
  );
  const active = typeof record2.active === "boolean" ? record2.active && visible && requestedFrameRate > 0 : visible && requestedFrameRate > 0;
  const rawMotion = record2.motion;
  const motion = rawMotion === "full" || rawMotion === "reduced" || rawMotion === "paused" ? rawMotion : active ? "full" : "paused";
  const slot = typeof record2.slot === "string" ? record2.slot : current.slot;
  const reason = typeof record2.reason === "string" ? record2.reason : current.reason;
  return {
    visible,
    active,
    maxFrameRate: active ? requestedFrameRate : 0,
    motion: active ? motion : "paused",
    ...slot === "page" || slot === "widget" || slot === "card" || slot === "settings" || slot === "function-panel" || slot === "slot" ? { slot } : {},
    ...reason ? { reason } : {}
  };
}
function normalizeLegacyVisibilityPayload(payload, current) {
  if (typeof payload !== "object" || payload === null) return null;
  const visible = payload.visible;
  if (typeof visible !== "boolean") return null;
  return createRuntimeSnapshot({
    visible,
    maxFrameRate: visible && current.maxFrameRate > 0 ? current.maxFrameRate : DEFAULT_PLUGIN_MAX_FRAME_RATE,
    slot: current.slot,
    reason: "legacy-visibility"
  });
}
function areRuntimeSnapshotsEqual(a, b) {
  return a.visible === b.visible && a.active === b.active && a.maxFrameRate === b.maxFrameRate && a.motion === b.motion && a.slot === b.slot && a.reason === b.reason;
}
function copyEnvelope(envelope) {
  return {
    width: { ...envelope.width },
    height: { ...envelope.height }
  };
}
function normalizeEnvelopeAxis(value) {
  if (typeof value !== "object" || value === null) return null;
  const record2 = value;
  if (record2.mode === "fixed") {
    if (typeof record2.value !== "number" || !Number.isFinite(record2.value)) return null;
    return { mode: "fixed", value: Math.round(record2.value) };
  }
  if (record2.mode === "flexible") {
    if (typeof record2.max !== "number" || !Number.isFinite(record2.max)) return null;
    return { mode: "flexible", max: Math.round(record2.max) };
  }
  if (record2.mode === "unbounded") {
    return { mode: "unbounded" };
  }
  return null;
}
function normalizeEnvelopePayload(payload) {
  if (typeof payload !== "object" || payload === null) return null;
  const record2 = payload;
  const width = normalizeEnvelopeAxis(record2.width);
  const height = normalizeEnvelopeAxis(record2.height);
  if (!width || !height) return null;
  return { width, height };
}
function optionalSurfaceSessionId(value) {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return void 0;
}
function normalizeSurfaceContextPayload(payload) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record2 = payload;
  const appId = typeof record2.appId === "string" && record2.appId.trim() ? record2.appId.trim() : null;
  const slot = record2.slot;
  const cardInstanceId = record2.cardInstanceId;
  if (!appId || slot !== "card" && slot !== "function-panel" && slot !== "settings" && slot !== "slot" && slot !== "input-panel") return null;
  const embeddedSessionId = optionalSurfaceSessionId(record2.embeddedSessionId);
  const originSessionId = optionalSurfaceSessionId(record2.originSessionId);
  const contextMetadata = {};
  if (embeddedSessionId !== void 0) contextMetadata.embeddedSessionId = embeddedSessionId;
  if (originSessionId !== void 0) contextMetadata.originSessionId = originSessionId;
  if (slot === "settings" || slot === "input-panel") return cardInstanceId === null ? { appId, slot, cardInstanceId: null, ...contextMetadata } : null;
  if (typeof cardInstanceId === "string" && cardInstanceId.trim()) {
    return { appId, slot, cardInstanceId: cardInstanceId.trim(), ...contextMetadata };
  }
  if (slot !== "card" || cardInstanceId !== null || typeof record2.embeddedSessionId !== "string" || !record2.embeddedSessionId.trim()) {
    return null;
  }
  return { appId, slot, cardInstanceId: null, ...contextMetadata };
}
function normalizeActiveSession(payload) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record2 = payload;
  const sessionId = typeof record2.sessionId === "string" && record2.sessionId.trim() ? record2.sessionId : null;
  const sessionPath = typeof record2.sessionPath === "string" && record2.sessionPath ? record2.sessionPath : null;
  if (!sessionId || !sessionPath) return null;
  if (record2.title !== null && typeof record2.title !== "string") return null;
  if (record2.agentId !== null && typeof record2.agentId !== "string") return null;
  return {
    sessionId,
    sessionPath,
    title: record2.title,
    agentId: record2.agentId
  };
}
function normalizeActiveSessionChanged(payload) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record2 = payload;
  const previous = record2.previous === null ? null : normalizeActiveSession(record2.previous);
  const current = record2.current === null ? null : normalizeActiveSession(record2.current);
  if (record2.previous !== null && previous === null || record2.current !== null && current === null) return null;
  if (typeof record2.timestamp !== "number" || !Number.isFinite(record2.timestamp)) return null;
  return { previous, current, timestamp: record2.timestamp };
}
function normalizeSessionEventError(payload) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record2 = payload;
  if (typeof record2.code !== "string" || !record2.code.trim()) return null;
  if (typeof record2.message !== "string" || !record2.message.trim()) return null;
  return new HanaPluginError({ code: record2.code, message: record2.message });
}
function externalOpenPayload(input) {
  return typeof input === "string" ? { url: input } : input;
}
function clipboardWriteTextPayload(input) {
  return typeof input === "string" ? { text: input } : input;
}
function readAppIdFromIframeRoute(targetWindow) {
  const match = /^\/api\/apps\/([^/]+)\/ui(?:\/|$)/.exec(targetWindow.location.pathname || "");
  if (!match) {
    throw new Error("App asset/API URL helper requires an iframe route under /api/apps/:appId/ui/.");
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new Error("App asset/API URL helper could not decode the current app id.");
  }
}
function hasConfirmedAdvancedAppSurface(targetWindow, surfaceContext) {
  if (!surfaceContext || !["card", "function-panel", "settings", "slot"].includes(surfaceContext.slot)) return false;
  try {
    return readAppIdFromIframeRoute(targetWindow) === surfaceContext.appId;
  } catch {
    return false;
  }
}
function normalizeAssetPath(input) {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("Invalid plugin asset path.");
  }
  if (input.includes("\\") || input.includes("\0") || /^[a-z][a-z0-9+.-]*:/i.test(input)) {
    throw new Error("Invalid plugin asset path.");
  }
  const stripped = input.replace(/^\/+/, "");
  if (!stripped || stripped.startsWith("./")) {
    throw new Error("Invalid plugin asset path.");
  }
  const segments = stripped.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    throw new Error("Invalid plugin asset path.");
  }
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}
function readAssetBase(targetWindow) {
  return new URLSearchParams(targetWindow.location.search).get("hana-asset-base") || null;
}
function pluginAssetUrl(targetWindow, input) {
  const assetPath = normalizeAssetPath(input);
  const assetBase = readAssetBase(targetWindow);
  if (!assetBase) {
    throw new Error(
      "hana.assets.url() requires the host-issued hana-asset-base query parameter: this page was not opened by the host with an asset base; hana.assets.url() only works inside a Hana app surface."
    );
  }
  const url = new URL(assetBase);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${assetPath}`;
  return url.toString();
}
function readSurfaceSession(targetWindow) {
  return new URLSearchParams(targetWindow.location.search).get(APP_SURFACE_SESSION_QUERY) || null;
}
function normalizePluginApiPath(input) {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("Invalid plugin API path.");
  }
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("\\") || trimmed.includes("\0") || trimmed.includes("#") || trimmed.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new Error("Invalid plugin API path.");
  }
  const stripped = trimmed.replace(/^\/+/, "");
  if (!stripped || stripped.startsWith("./") || stripped === "api/apps" || stripped.startsWith("api/apps/")) {
    throw new Error("Invalid plugin API path. Use a route path relative to the current plugin.");
  }
  const queryIndex = stripped.indexOf("?");
  const rawPath = queryIndex >= 0 ? stripped.slice(0, queryIndex) : stripped;
  if (!rawPath) {
    throw new Error("Invalid plugin API path.");
  }
  const segments = rawPath.split("/");
  for (const segment of segments) {
    if (!segment) throw new Error("Invalid plugin API path.");
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error("Invalid plugin API path.");
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw new Error("Invalid plugin API path.");
    }
  }
  const parsed = new URL(`http://hana.local/${stripped}`);
  const safePath = segments.map((segment) => encodeURIComponent(decodeURIComponent(segment))).join("/");
  return `${safePath}${parsed.search}`;
}
function pluginApiUrl(targetWindow, input, authenticateRuntime = false) {
  const appId = readAppIdFromIframeRoute(targetWindow);
  let apiPath = normalizePluginApiPath(input);
  if (authenticateRuntime && apiPath.startsWith("_runtime/")) {
    const session = readSurfaceSession(targetWindow);
    if (!session) throw new Error("hana.api.url for a managed service requires appSurfaceSession in the iframe URL.");
    const match = /^(_runtime\/[^/?]+)\/(.+)$/.exec(apiPath);
    if (!match || match[2].startsWith("_surface/")) throw new Error("Invalid managed service API path.");
    apiPath = `${match[1]}/_surface/${encodeURIComponent(session)}/${match[2]}`;
  }
  return `${targetWindow.location.origin}/api/apps/${encodeURIComponent(appId)}/routes/${apiPath}`;
}
function pluginApiFetch(targetWindow, input, init, documentBindingId) {
  const surfaceSession = readSurfaceSession(targetWindow);
  if (!surfaceSession) {
    throw new Error("hana.api.fetch requires appSurfaceSession in the iframe URL.");
  }
  const fetchImpl = targetWindow.fetch?.bind(targetWindow) ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    throw new Error("hana.api.fetch requires window.fetch.");
  }
  const requestInit = init ?? {};
  const headers = new Headers(requestInit.headers);
  headers.set(APP_SURFACE_SESSION_HEADER, surfaceSession);
  if (documentBindingId) headers.set("X-Hana-Document-Binding", documentBindingId);
  return fetchImpl(pluginApiUrl(targetWindow, input), {
    ...requestInit,
    headers
  });
}
function readUserGesture(targetWindow) {
  try {
    const nav = targetWindow.navigator;
    if (nav.userActivation && typeof nav.userActivation.isActive === "boolean") {
      return nav.userActivation.isActive === true;
    }
  } catch {
  }
  try {
    const current = targetWindow.event;
    return !!(current && current.isTrusted);
  } catch {
  }
  return false;
}
function appStorageScopesMatch(subscriberScope, eventScope) {
  if (typeof eventScope !== "object" || eventScope === null) return false;
  const es = eventScope;
  if (subscriberScope.kind === "global") return es.kind === "global";
  return es.kind === "agent" && es.agentId === subscriberScope.agentId;
}
function createHanaPluginSdk(options = {}) {
  const targetWindow = options.targetWindow ?? getBrowserWindow();
  const parentWindow = options.parentWindow ?? targetWindow.parent;
  const targetOrigin = resolveTargetOrigin(targetWindow, options.targetOrigin);
  const requestTimeoutMs = options.requestTimeoutMs ?? 1e4;
  const idFactory = options.idFactory ?? defaultIdFactory;
  const inputPanelBridge = createInputPanelBridge(post);
  const themeFollowEnabled = options.followHostTheme !== false;
  let themeSnapshot = readInitialTheme(targetWindow);
  let runtimeSnapshot = readInitialRuntimeSnapshot(targetWindow);
  let envelopeSnapshot = null;
  let surfaceContext = null;
  const themeSubscribers = /* @__PURE__ */ new Set();
  const envelopeSubscribers = /* @__PURE__ */ new Set();
  const lifecycleSubscribers = /* @__PURE__ */ new Set();
  const surfaceContextSubscribers = /* @__PURE__ */ new Set();
  const storageChangedSubscribers = /* @__PURE__ */ new Set();
  const appStorageChangedSubscribers = /* @__PURE__ */ new Set();
  const panelEventSubscribers = /* @__PURE__ */ new Set();
  const panelRefreshSubscribers = /* @__PURE__ */ new Set();
  const activeSessionSubscribers = /* @__PURE__ */ new Set();
  let documentBindingId = null;
  let documentRequestHandler = null;
  let documentViewRequestHandler = null;
  let readyWasCalled = false;
  let readyPayload;
  let activeSessionRemoteSubscribed = false;
  let activeSessionSubscriptionBlocked = false;
  let activeSessionPageHidden = false;
  let activeSessionLifecycleQueue = Promise.resolve();
  const animationCallbacks = /* @__PURE__ */ new Map();
  let nextAnimationHandle = 1;
  let animationPumpCancel = null;
  let lastAnimationFrameTime = null;
  function followHostTheme(cssUrl) {
    if (!themeFollowEnabled || !cssUrl) return;
    const doc = targetWindow.document;
    if (!doc) return;
    void applyHostThemeStylesheet(doc, cssUrl).catch((error) => {
      if (options.onThemeError) {
        options.onThemeError(error);
        return;
      }
      console.error("[hana] failed to follow host theme", error);
    });
  }
  function post(message, onFailure) {
    if (options.messageTransport) {
      const sent = options.messageTransport.postMessage(message);
      if (sent) void sent.catch(onFailure ?? ((error) => console.error("[hana] host message delivery failed", error)));
    } else parentWindow.postMessage(message, targetOrigin);
  }
  function subscribeHost(listener) {
    if (options.messageTransport) return options.messageTransport.onMessage(listener);
    const receive = (event) => {
      if (isTrustedHostEvent(event, parentWindow, targetOrigin)) listener(event.data);
    };
    targetWindow.addEventListener("message", receive);
    return () => targetWindow.removeEventListener("message", receive);
  }
  function postEvent(type, payload) {
    const message = {
      protocol: PLUGIN_UI_PROTOCOL,
      version: PLUGIN_UI_PROTOCOL_VERSION,
      kind: "event",
      type
    };
    if (payload !== void 0) message.payload = payload;
    post(message);
  }
  function postReady(payload) {
    postEvent("hana.ready", payload);
  }
  function reportActiveSessionError(error) {
    const normalized = error instanceof HanaPluginError ? error : new HanaPluginError({
      code: "HOST_ERROR",
      message: error instanceof Error ? error.message : "Active session subscription failed."
    });
    let handled = false;
    for (const subscriber of activeSessionSubscribers) {
      if (!subscriber.onError) continue;
      handled = true;
      try {
        subscriber.onError(normalized);
      } catch (callbackError) {
        console.error("[hana] active session error callback failed", callbackError);
      }
    }
    if (!handled) console.error("[hana] active session subscription failed", normalized);
  }
  function wantsActiveSessionSubscription() {
    return activeSessionSubscribers.size > 0 && !activeSessionPageHidden && !activeSessionSubscriptionBlocked;
  }
  function scheduleActiveSessionLifecycle() {
    activeSessionLifecycleQueue = activeSessionLifecycleQueue.catch(() => void 0).then(async () => {
      while (activeSessionRemoteSubscribed !== wantsActiveSessionSubscription()) {
        if (wantsActiveSessionSubscription()) {
          try {
            await prepareSessionRequest();
            const result = await request(APP_SESSION_CAPABILITY.SUBSCRIBE);
            if (result.subscribed !== true) {
              activeSessionRemoteSubscribed = false;
              if (!activeSessionSubscriptionBlocked) {
                reportActiveSessionError(new HanaPluginError({
                  code: "HOST_ERROR",
                  message: "The host did not establish the active session subscription."
                }));
              }
              return;
            }
            activeSessionRemoteSubscribed = true;
          } catch (error) {
            activeSessionRemoteSubscribed = false;
            reportActiveSessionError(error);
            return;
          }
          continue;
        }
        try {
          await prepareSessionRequest();
          await request(APP_SESSION_CAPABILITY.UNSUBSCRIBE);
        } catch (error) {
          reportActiveSessionError(error);
        }
        activeSessionRemoteSubscribed = false;
      }
    });
  }
  function waitForDocumentLoad(timeoutMs) {
    const readyState = targetWindow.document?.readyState;
    if (readyState !== "loading" && readyState !== "interactive") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        targetWindow.clearTimeout(timeout);
        targetWindow.removeEventListener("load", onLoad);
        targetWindow.removeEventListener("pagehide", onPageHide);
      };
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onPageHide = () => {
        cleanup();
        reject(new HanaPluginError({
          code: "SURFACE_UNAVAILABLE",
          message: "The App surface unloaded before interactive regions could be registered."
        }));
      };
      const timeout = targetWindow.setTimeout(() => {
        cleanup();
        reject(new HanaPluginError({
          code: "TIMEOUT",
          message: "The App document did not finish loading before interactive regions could be registered."
        }));
      }, timeoutMs);
      targetWindow.addEventListener("load", onLoad);
      targetWindow.addEventListener("pagehide", onPageHide);
    });
  }
  function prepareSessionRequest(timeoutMs) {
    return waitForDocumentLoad(timeoutMs ?? requestTimeoutMs).then(() => {
      postReady(readyPayload);
    });
  }
  function requestNativeAnimationFrame(callback) {
    const requestFrame = targetWindow.requestAnimationFrame?.bind(targetWindow);
    const cancelFrame = targetWindow.cancelAnimationFrame?.bind(targetWindow);
    if (requestFrame && cancelFrame) {
      const handle = requestFrame(callback);
      return () => cancelFrame(handle);
    }
    const timeout = targetWindow.setTimeout(() => {
      const now = targetWindow.performance?.now?.() ?? Date.now();
      callback(now);
    }, Math.max(1, Math.round(1e3 / Math.max(runtimeSnapshot.maxFrameRate, DEFAULT_PLUGIN_MAX_FRAME_RATE))));
    return () => targetWindow.clearTimeout(timeout);
  }
  function cancelAnimationPump() {
    if (!animationPumpCancel) return;
    animationPumpCancel();
    animationPumpCancel = null;
  }
  function scheduleAnimationPump() {
    if (animationPumpCancel || animationCallbacks.size === 0) return;
    if (!runtimeSnapshot.active || runtimeSnapshot.maxFrameRate <= 0) return;
    animationPumpCancel = requestNativeAnimationFrame((time) => {
      animationPumpCancel = null;
      if (!runtimeSnapshot.active || runtimeSnapshot.maxFrameRate <= 0) return;
      const frameInterval = 1e3 / runtimeSnapshot.maxFrameRate;
      if (lastAnimationFrameTime !== null && time >= lastAnimationFrameTime && time - lastAnimationFrameTime < frameInterval) {
        scheduleAnimationPump();
        return;
      }
      lastAnimationFrameTime = time;
      const callbacks = Array.from(animationCallbacks.entries());
      for (const [handle, callback] of callbacks) {
        if (!animationCallbacks.delete(handle)) continue;
        try {
          callback(time);
        } catch (err) {
          targetWindow.setTimeout(() => {
            throw err;
          }, 0);
        }
      }
      scheduleAnimationPump();
    });
  }
  function setRuntimeSnapshot(next) {
    if (areRuntimeSnapshotsEqual(runtimeSnapshot, next)) return;
    runtimeSnapshot = next;
    for (const callback of lifecycleSubscribers) callback({ ...runtimeSnapshot });
    if (!runtimeSnapshot.active || runtimeSnapshot.maxFrameRate <= 0) {
      cancelAnimationPump();
      return;
    }
    scheduleAnimationPump();
  }
  function onHostMessage(data) {
    if (typeof data === "object" && data !== null && data.protocol === void 0 && data.type === "visibility-changed") {
      const next = normalizeLegacyVisibilityPayload(
        data.payload,
        runtimeSnapshot
      );
      if (next) setRuntimeSnapshot(next);
      return;
    }
    const parsed = parsePluginUiMessage(data);
    if (!parsed.ok) return;
    const message = parsed.value;
    if (inputPanelBridge.handleMessage(message)) {
      if (message.type === APP_INPUT_PANEL_MESSAGE.CONTEXT && message.payload === null && readyWasCalled) postReady(readyPayload);
      return;
    }
    if (message.kind === "request" && message.type === "hana.document.view-request") {
      const record2 = typeof message.payload === "object" && message.payload !== null ? message.payload : null;
      const requestId = record2 && typeof record2.requestId === "string" ? record2.requestId : "";
      const documentId = record2 && typeof record2.documentId === "string" ? record2.documentId : "";
      const viewId = record2 && typeof record2.viewId === "string" ? record2.viewId : "";
      const revision = record2?.revision;
      const method = record2 && typeof record2.method === "string" ? record2.method.trim() : "";
      if (!requestId || !documentId || !viewId || !method || method.length > 128 || !Number.isSafeInteger(revision) || Number(revision) < 0) {
        post({
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: message.id,
          kind: "error",
          type: message.type,
          error: { code: "DOCUMENT_VIEW_REQUEST_INVALID", message: "Invalid document view request." }
        });
        return;
      }
      if (!documentViewRequestHandler) {
        post({
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: message.id,
          kind: "error",
          type: message.type,
          error: { code: "DOCUMENT_VIEW_REQUEST_UNHANDLED", message: "The document view cannot handle this request." }
        });
        return;
      }
      const payload = record2?.payload;
      const handler = documentViewRequestHandler;
      void Promise.resolve().then(() => handler({
        requestId,
        documentId,
        viewId,
        revision,
        method,
        ...Object.prototype.hasOwnProperty.call(record2, "payload") ? { payload } : {}
      })).then((result) => {
        post({ protocol: PLUGIN_UI_PROTOCOL, version: PLUGIN_UI_PROTOCOL_VERSION, id: message.id, kind: "response", type: message.type, payload: result });
      }, (error) => {
        post({
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: message.id,
          kind: "error",
          type: message.type,
          error: { code: "DOCUMENT_VIEW_REQUEST_FAILED", message: error instanceof Error ? error.message : "Document view request failed." }
        });
      });
      return;
    }
    if (message.kind === "request" && message.type === "hana.document.request") {
      const payload = message.payload;
      const record2 = typeof payload === "object" && payload !== null ? payload : null;
      const requestId = record2 && typeof record2.requestId === "string" ? record2.requestId : "";
      const kind = record2?.kind;
      const revision = record2?.revision;
      if (!requestId || !["save", "prepareClose", "revert", "undo", "redo"].includes(String(kind)) || !Number.isSafeInteger(revision)) {
        post({
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: message.id,
          kind: "error",
          type: message.type,
          error: { code: "DOCUMENT_REQUEST_INVALID", message: "Invalid document request." }
        });
        return;
      }
      if (!documentRequestHandler) {
        post({
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: message.id,
          kind: "error",
          type: message.type,
          error: { code: "DOCUMENT_REQUEST_UNHANDLED", message: "The document editor cannot handle this request." }
        });
        return;
      }
      const request2 = {
        requestId,
        kind,
        revision
      };
      void Promise.resolve(documentRequestHandler(request2)).then((result) => {
        post({ protocol: PLUGIN_UI_PROTOCOL, version: PLUGIN_UI_PROTOCOL_VERSION, id: message.id, kind: "response", type: message.type, payload: result });
      }, (error) => {
        post({
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: message.id,
          kind: "error",
          type: message.type,
          error: { code: "DOCUMENT_REQUEST_FAILED", message: error instanceof Error ? error.message : "Document request failed." }
        });
      });
      return;
    }
    if (message.kind === "request" && message.type === PLUGIN_UI_CAPABILITY.UI_ACTION) {
      const doc = targetWindow.document;
      const outcome = doc ? performHostUiAction(doc, message.payload, hasConfirmedAdvancedAppSurface(targetWindow, surfaceContext)) : { ok: false, code: "UI_ACTION_DOCUMENT_UNAVAILABLE", error: "No document is available." };
      if (outcome.ok === true) {
        post({
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: message.id,
          kind: "response",
          type: PLUGIN_UI_CAPABILITY.UI_ACTION,
          payload: outcome.result
        });
      } else {
        post({
          protocol: PLUGIN_UI_PROTOCOL,
          version: PLUGIN_UI_PROTOCOL_VERSION,
          id: message.id,
          kind: "error",
          type: PLUGIN_UI_CAPABILITY.UI_ACTION,
          error: { code: outcome.code, message: outcome.error, ...outcome.result ? { details: outcome.result } : {} }
        });
      }
      return;
    }
    if (message.kind !== "event") return;
    if (message.type === "hana.document.binding") {
      const payload = message.payload;
      const access = typeof payload === "object" && payload !== null ? payload.access : null;
      documentBindingId = typeof access?.bindingId === "string" && access.bindingId ? access.bindingId : null;
      return;
    }
    if (message.type === PLUGIN_UI_HOST_EVENT.THEME_CHANGED) {
      if (typeof message.payload !== "object" || message.payload === null) return;
      const payload = message.payload;
      const nextTheme = typeof payload.theme === "string" ? payload.theme : themeSnapshot.theme;
      const changedTheme = typeof payload.theme === "string" && payload.theme !== themeSnapshot.theme;
      themeSnapshot = {
        theme: nextTheme,
        cssUrl: typeof payload.cssUrl === "string" ? payload.cssUrl : themeSnapshot.cssUrl,
        appearance: payload.appearance === "light" || payload.appearance === "dark" ? payload.appearance : changedTheme ? void 0 : themeSnapshot.appearance,
        palettes: isThemePalettes(payload.palettes) ? payload.palettes : changedTheme ? void 0 : themeSnapshot.palettes
      };
      for (const callback of themeSubscribers) callback({ ...themeSnapshot });
      followHostTheme(themeSnapshot.cssUrl);
      return;
    }
    if (message.type === PLUGIN_UI_HOST_EVENT.SURFACE_ENVELOPE_CHANGED) {
      const next = normalizeEnvelopePayload(message.payload);
      if (!next) return;
      envelopeSnapshot = next;
      for (const callback of envelopeSubscribers) callback(copyEnvelope(envelopeSnapshot));
      return;
    }
    if (message.type === PLUGIN_UI_HOST_EVENT.SURFACE_RUNTIME_CHANGED) {
      const next = normalizeRuntimeSnapshotPayload(message.payload, runtimeSnapshot);
      if (next) setRuntimeSnapshot(next);
      return;
    }
    if (message.type === APP_SURFACE_HOST_EVENT.CONTEXT) {
      const next = message.payload === null ? null : normalizeSurfaceContextPayload(message.payload);
      if (message.payload !== null && next === null) return;
      const changed = next?.appId !== surfaceContext?.appId || next?.slot !== surfaceContext?.slot || next?.cardInstanceId !== surfaceContext?.cardInstanceId || next?.embeddedSessionId !== surfaceContext?.embeddedSessionId || next?.originSessionId !== surfaceContext?.originSessionId;
      surfaceContext = next;
      if (changed) {
        for (const callback of surfaceContextSubscribers) callback(surfaceContext ? { ...surfaceContext } : null);
      }
      return;
    }
    if (message.type === APP_SESSION_HOST_EVENT.ACTIVE_CHANGED) {
      if (activeSessionSubscriptionBlocked) return;
      const change = normalizeActiveSessionChanged(message.payload);
      if (!change) return;
      for (const subscriber of activeSessionSubscribers) subscriber.callback(change);
      return;
    }
    if (message.type === APP_SESSION_HOST_EVENT.ERROR) {
      const error = normalizeSessionEventError(message.payload);
      if (!error) return;
      activeSessionRemoteSubscribed = false;
      activeSessionSubscriptionBlocked = true;
      reportActiveSessionError(error);
      scheduleActiveSessionLifecycle();
      return;
    }
    if (message.type === PLUGIN_UI_HOST_EVENT.STORAGE_CHANGED) {
      if (typeof message.payload !== "object" || message.payload === null) return;
      const rawKeys = message.payload.keys;
      const keys = Array.isArray(rawKeys) ? rawKeys.filter((k) => typeof k === "string") : [];
      for (const callback of storageChangedSubscribers) callback(keys.slice());
      return;
    }
    if (message.type === APP_STORAGE_HOST_EVENT.CHANGED) {
      if (typeof message.payload !== "object" || message.payload === null) return;
      const payload = message.payload;
      const rawKeys = payload.keys;
      const keys = Array.isArray(rawKeys) ? rawKeys.filter((k) => typeof k === "string") : [];
      for (const entry of appStorageChangedSubscribers) {
        if (appStorageScopesMatch(entry.scope, payload.scope)) entry.callback(keys.slice());
      }
      return;
    }
    if (message.type === PLUGIN_UI_HOST_EVENT.PANEL_EVENT) {
      if (typeof message.payload !== "object" || message.payload === null) return;
      const payload = message.payload;
      const sectionId = typeof payload.sectionId === "string" ? payload.sectionId : null;
      const kind = payload.kind;
      if (!sectionId || kind !== "select" && kind !== "action" && kind !== "toggle") return;
      const event = {
        sectionId,
        kind,
        ...typeof payload.itemId === "string" ? { itemId: payload.itemId } : {},
        ...typeof payload.checked === "boolean" ? { checked: payload.checked } : {}
      };
      for (const callback of panelEventSubscribers) callback(event);
      return;
    }
    if (message.type === PLUGIN_UI_HOST_EVENT.PANEL_REFRESH) {
      for (const callback of panelRefreshSubscribers) callback();
    }
  }
  subscribeHost(onHostMessage);
  targetWindow.addEventListener("pagehide", () => {
    inputPanelBridge.clear();
    activeSessionPageHidden = true;
    scheduleActiveSessionLifecycle();
  });
  targetWindow.addEventListener("pageshow", () => {
    if (!activeSessionPageHidden) return;
    activeSessionPageHidden = false;
    scheduleActiveSessionLifecycle();
  });
  function request(type, payload, requestOptions = {}) {
    const id = idFactory();
    const timeoutMs = requestOptions.timeoutMs ?? requestTimeoutMs;
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {
      };
      const cleanup = () => {
        unsubscribe();
        targetWindow.clearTimeout(timeout);
      };
      const onMessage = (data) => {
        const parsed = parsePluginUiMessage(data);
        if (!parsed.ok) return;
        const message2 = parsed.value;
        if (message2.id !== id || message2.type !== type) return;
        if (message2.kind === "response") {
          cleanup();
          resolve(message2.payload);
        }
        if (message2.kind === "error" && message2.error) {
          cleanup();
          reject(new HanaPluginError(message2.error));
        }
      };
      const timeout = targetWindow.setTimeout(() => {
        cleanup();
        reject(new HanaPluginError({
          code: "TIMEOUT",
          message: `Plugin host request timed out: ${type}.`
        }));
      }, timeoutMs);
      const message = {
        protocol: PLUGIN_UI_PROTOCOL,
        version: PLUGIN_UI_PROTOCOL_VERSION,
        id,
        kind: "request",
        type
      };
      if (payload !== void 0) message.payload = payload;
      try {
        unsubscribe = subscribeHost(onMessage);
        post(message, (error) => {
          cleanup();
          reject(error);
        });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
  function makeAppStorageScope(scope) {
    return {
      get(key, options2) {
        return request(APP_STORAGE_CAPABILITY.GET, { scope, key }, options2);
      },
      getAll(options2) {
        return request(APP_STORAGE_CAPABILITY.GET_ALL, { scope }, options2);
      },
      set(key, value, options2) {
        return request(APP_STORAGE_CAPABILITY.SET, { scope, key, value }, options2);
      },
      delete(key, options2) {
        return request(APP_STORAGE_CAPABILITY.DELETE, { scope, key }, options2);
      },
      keys(options2) {
        return request(APP_STORAGE_CAPABILITY.KEYS, { scope }, options2);
      },
      onChanged(callback) {
        if (scope.kind === "agent" && !scope.agentId) {
          throw new Error(
            "hana.storage.agent() with no agentId cannot subscribe with onChanged \u2014 a subscription outlives any single request, so pass an explicit agentId to subscribe to a stable scope."
          );
        }
        const entry = { scope, callback };
        appStorageChangedSubscribers.add(entry);
        return () => {
          appStorageChangedSubscribers.delete(entry);
        };
      }
    };
  }
  return {
    ready(payload) {
      readyWasCalled = true;
      readyPayload = payload;
      postReady(payload);
    },
    inputPanel: inputPanelBridge.api,
    assets: {
      url(assetPath) {
        return pluginAssetUrl(targetWindow, assetPath);
      }
    },
    api: {
      url(apiPath) {
        return pluginApiUrl(targetWindow, apiPath, true);
      },
      fetch(apiPath, init) {
        return pluginApiFetch(targetWindow, apiPath, init, documentBindingId);
      }
    },
    ui: {
      resize(size) {
        postEvent(PLUGIN_UI_CAPABILITY.UI_RESIZE, size);
      }
    },
    theme: {
      getSnapshot() {
        return { ...themeSnapshot };
      },
      subscribe(callback) {
        themeSubscribers.add(callback);
        callback({ ...themeSnapshot });
        return () => {
          themeSubscribers.delete(callback);
        };
      }
    },
    envelope: {
      getSnapshot() {
        return envelopeSnapshot ? copyEnvelope(envelopeSnapshot) : null;
      },
      subscribe(callback) {
        envelopeSubscribers.add(callback);
        callback(envelopeSnapshot ? copyEnvelope(envelopeSnapshot) : null);
        return () => {
          envelopeSubscribers.delete(callback);
        };
      }
    },
    lifecycle: {
      getSnapshot() {
        return { ...runtimeSnapshot };
      },
      subscribe(callback) {
        lifecycleSubscribers.add(callback);
        callback({ ...runtimeSnapshot });
        return () => {
          lifecycleSubscribers.delete(callback);
        };
      }
    },
    cards: {
      open(cardId) {
        if (typeof cardId !== "string" || !cardId.trim()) {
          return Promise.reject(new TypeError("hana.cards.open requires a non-empty declared card ID."));
        }
        return request(APP_CARD_CAPABILITY.OPEN, { cardId: cardId.trim() });
      }
    },
    surface: {
      getContext() {
        return surfaceContext ? { ...surfaceContext } : null;
      },
      onContextChanged(callback) {
        surfaceContextSubscribers.add(callback);
        callback(surfaceContext ? { ...surfaceContext } : null);
        return () => {
          surfaceContextSubscribers.delete(callback);
        };
      },
      setInteractiveRegions(regions, options2) {
        const parsed = parseAppSurfaceInteractiveRegions({ regions });
        if (parsed.ok === false) return Promise.reject(new TypeError(parsed.error));
        if (!readyWasCalled) {
          return request(APP_SURFACE_CAPABILITY.SET_INTERACTIVE_REGIONS, parsed.value, options2);
        }
        return waitForDocumentLoad(options2?.timeoutMs ?? requestTimeoutMs).then(() => {
          postReady(readyPayload);
          return request(APP_SURFACE_CAPABILITY.SET_INTERACTIVE_REGIONS, parsed.value, options2);
        });
      }
    },
    sessions: {
      getActive(options2) {
        return prepareSessionRequest(options2?.timeoutMs).then(() => request(APP_SESSION_CAPABILITY.GET_ACTIVE, void 0, options2));
      },
      focus(input, options2) {
        if (!input || typeof input.sessionId !== "string" || !input.sessionId.trim()) {
          return Promise.reject(new TypeError("hana.sessions.focus requires a non-empty sessionId."));
        }
        return prepareSessionRequest(options2?.timeoutMs).then(() => request(
          APP_SESSION_CAPABILITY.FOCUS,
          { sessionId: input.sessionId.trim() },
          options2
        ));
      },
      onActiveChanged(callback, onError) {
        const subscriber = { callback, onError };
        activeSessionSubscriptionBlocked = false;
        activeSessionSubscribers.add(subscriber);
        scheduleActiveSessionLifecycle();
        return () => {
          if (!activeSessionSubscribers.delete(subscriber)) return;
          scheduleActiveSessionLifecycle();
        };
      }
    },
    performance: {
      requestAnimationFrame(callback) {
        const handle = nextAnimationHandle;
        nextAnimationHandle += 1;
        animationCallbacks.set(handle, callback);
        scheduleAnimationPump();
        return handle;
      },
      cancelAnimationFrame(handle) {
        animationCallbacks.delete(handle);
        if (animationCallbacks.size === 0) cancelAnimationPump();
      }
    },
    host: {
      request
    },
    toast: {
      show(input, options2) {
        return request(PLUGIN_UI_CAPABILITY.TOAST_SHOW, input, options2);
      }
    },
    external: {
      open(input, options2) {
        return request(PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN, externalOpenPayload(input), options2);
      }
    },
    clipboard: {
      writeText(input, options2) {
        return request(
          PLUGIN_UI_CAPABILITY.CLIPBOARD_WRITE_TEXT,
          clipboardWriteTextPayload(input),
          options2
        );
      }
    },
    resources: {
      open(input, options2) {
        return request(PLUGIN_UI_CAPABILITY.RESOURCE_OPEN, input, options2);
      },
      pick(input = {}, options2) {
        return request(PLUGIN_UI_CAPABILITY.RESOURCE_PICK, input, options2);
      },
      saveFile(input, options2) {
        return request(PLUGIN_UI_CAPABILITY.RESOURCE_SAVE_FILE, input, options2);
      },
      requestAccess(input, options2) {
        return request(
          PLUGIN_UI_CAPABILITY.RESOURCE_REQUEST_ACCESS,
          input,
          options2
        );
      }
    },
    document: {
      getContext(options2) {
        return request("hana.document.get-context", void 0, options2);
      },
      read(options2) {
        return request("hana.document.read", void 0, options2);
      },
      reportStatus(status, options2) {
        return request("hana.document.report-status", status, options2);
      },
      open(input, options2) {
        return request("hana.document.open", input, options2);
      },
      rebind(input, options2) {
        return request("hana.document.rebind", input, options2);
      },
      openDrop(event, options2) {
        if (event.defaultPrevented) return Promise.resolve(null);
        const dragId = event.dataTransfer?.getData("application/x-hana-file-drag") || "";
        if (dragId) return request("hana.document.open-drop", { dragId }, options2);
        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length !== 1) return Promise.resolve(null);
        return request("hana.document.open-drop", { file: files[0] }, options2);
      },
      onRequest(handler) {
        documentRequestHandler = handler;
        return () => {
          if (documentRequestHandler === handler) documentRequestHandler = null;
        };
      },
      onViewRequest(handler) {
        documentViewRequestHandler = handler;
        return () => {
          if (documentViewRequestHandler === handler) documentViewRequestHandler = null;
        };
      }
    },
    state: {
      get(key, options2) {
        const payload = typeof key === "string" && key ? { key } : {};
        return request(PLUGIN_UI_CAPABILITY.STATE_GET, payload, options2);
      },
      set(keyOrState, value, options2) {
        const payload = typeof keyOrState === "string" ? { key: keyOrState, value } : { state: keyOrState };
        return request(PLUGIN_UI_CAPABILITY.STATE_SET, payload, options2);
      }
    },
    storage: {
      get(key, options2) {
        return request(PLUGIN_UI_CAPABILITY.STORAGE_GET, { key }, options2);
      },
      getAll(options2) {
        return request(PLUGIN_UI_CAPABILITY.STORAGE_GET_ALL, {}, options2);
      },
      set(key, value, options2) {
        return request(PLUGIN_UI_CAPABILITY.STORAGE_SET, { key, value }, options2);
      },
      delete(key, options2) {
        return request(PLUGIN_UI_CAPABILITY.STORAGE_DELETE, { key }, options2);
      },
      onChanged(callback) {
        storageChangedSubscribers.add(callback);
        return () => {
          storageChangedSubscribers.delete(callback);
        };
      },
      global: makeAppStorageScope({ kind: "global" }),
      agent(agentId) {
        return makeAppStorageScope({ kind: "agent", agentId });
      }
    },
    emit(name, payload, to, options2) {
      const wire = {
        name,
        userGesture: readUserGesture(targetWindow)
      };
      if (arguments.length >= 2) wire.payload = payload;
      if (typeof to === "string" && to.trim()) wire.to = to.trim();
      return request(PLUGIN_UI_CAPABILITY.EMIT, wire, options2);
    },
    track(name, payload, options2) {
      const wire = { name };
      if (arguments.length >= 2) wire.payload = payload;
      return request(PLUGIN_UI_CAPABILITY.TRACK, wire, options2);
    },
    panel: {
      set(props, options2) {
        return request(PLUGIN_UI_CAPABILITY.PANEL_SET, props, options2);
      },
      onEvent(callback) {
        panelEventSubscribers.add(callback);
        return () => {
          panelEventSubscribers.delete(callback);
        };
      },
      onRefresh(callback) {
        panelRefreshSubscribers.add(callback);
        return () => {
          panelRefreshSubscribers.delete(callback);
        };
      }
    }
  };
}
var singleton = null;
function getSingleton() {
  singleton ??= createHanaPluginSdk();
  return singleton;
}
var hana = {
  ready(payload) {
    return getSingleton().ready(payload);
  },
  inputPanel: {
    getContext() {
      return getSingleton().inputPanel.getContext();
    },
    onContextChanged(callback) {
      return getSingleton().inputPanel.onContextChanged(callback);
    },
    onSubmit(handler) {
      return getSingleton().inputPanel.onSubmit(handler);
    },
    setPresentation(patch) {
      return getSingleton().inputPanel.setPresentation(patch);
    }
  },
  assets: {
    url(assetPath) {
      return getSingleton().assets.url(assetPath);
    }
  },
  api: {
    url(apiPath) {
      return getSingleton().api.url(apiPath);
    },
    fetch(apiPath, init) {
      return getSingleton().api.fetch(apiPath, init);
    }
  },
  ui: {
    resize(size) {
      return getSingleton().ui.resize(size);
    }
  },
  theme: {
    getSnapshot() {
      return getSingleton().theme.getSnapshot();
    },
    subscribe(callback) {
      return getSingleton().theme.subscribe(callback);
    }
  },
  envelope: {
    getSnapshot() {
      return getSingleton().envelope.getSnapshot();
    },
    subscribe(callback) {
      return getSingleton().envelope.subscribe(callback);
    }
  },
  lifecycle: {
    getSnapshot() {
      return getSingleton().lifecycle.getSnapshot();
    },
    subscribe(callback) {
      return getSingleton().lifecycle.subscribe(callback);
    }
  },
  cards: {
    open(cardId) {
      return getSingleton().cards.open(cardId);
    }
  },
  surface: {
    getContext() {
      return getSingleton().surface.getContext();
    },
    onContextChanged(callback) {
      return getSingleton().surface.onContextChanged(callback);
    },
    setInteractiveRegions(regions, options) {
      return getSingleton().surface.setInteractiveRegions(regions, options);
    }
  },
  sessions: {
    getActive(options) {
      return getSingleton().sessions.getActive(options);
    },
    focus(input, options) {
      return getSingleton().sessions.focus(input, options);
    },
    onActiveChanged(callback, onError) {
      return getSingleton().sessions.onActiveChanged(callback, onError);
    }
  },
  performance: {
    requestAnimationFrame(callback) {
      return getSingleton().performance.requestAnimationFrame(callback);
    },
    cancelAnimationFrame(handle) {
      return getSingleton().performance.cancelAnimationFrame(handle);
    }
  },
  host: {
    request(type, payload, options) {
      return getSingleton().host.request(type, payload, options);
    }
  },
  toast: {
    show(input, options) {
      return getSingleton().toast.show(input, options);
    }
  },
  external: {
    open(input, options) {
      return getSingleton().external.open(input, options);
    }
  },
  clipboard: {
    writeText(input, options) {
      return getSingleton().clipboard.writeText(input, options);
    }
  },
  resources: {
    open(input, options) {
      return getSingleton().resources.open(input, options);
    },
    pick(input, options) {
      return getSingleton().resources.pick(input, options);
    },
    saveFile(input, options) {
      return getSingleton().resources.saveFile(input, options);
    },
    requestAccess(input, options) {
      return getSingleton().resources.requestAccess(input, options);
    }
  },
  document: {
    getContext(options) {
      return getSingleton().document.getContext(options);
    },
    read(options) {
      return getSingleton().document.read(options);
    },
    reportStatus(status, options) {
      return getSingleton().document.reportStatus(status, options);
    },
    open(input, options) {
      return getSingleton().document.open(input, options);
    },
    rebind(input, options) {
      return getSingleton().document.rebind(input, options);
    },
    openDrop(event, options) {
      return getSingleton().document.openDrop(event, options);
    },
    onRequest(handler) {
      return getSingleton().document.onRequest(handler);
    },
    onViewRequest(handler) {
      return getSingleton().document.onViewRequest(handler);
    }
  },
  state: {
    get(key, options) {
      return getSingleton().state.get(key, options);
    },
    set(keyOrState, value, options) {
      return getSingleton().state.set(keyOrState, value, options);
    }
  },
  storage: {
    get(key, options) {
      return getSingleton().storage.get(key, options);
    },
    getAll(options) {
      return getSingleton().storage.getAll(options);
    },
    set(key, value, options) {
      return getSingleton().storage.set(key, value, options);
    },
    delete(key, options) {
      return getSingleton().storage.delete(key, options);
    },
    onChanged(callback) {
      return getSingleton().storage.onChanged(callback);
    },
    get global() {
      return getSingleton().storage.global;
    },
    agent(agentId) {
      return getSingleton().storage.agent(agentId);
    }
  },
  emit(name, payload, to, options) {
    return getSingleton().emit(name, payload, to, options);
  },
  track(name, payload, options) {
    return getSingleton().track(name, payload, options);
  },
  panel: {
    set(props, options) {
      return getSingleton().panel.set(props, options);
    },
    onEvent(callback) {
      return getSingleton().panel.onEvent(callback);
    },
    onRefresh(callback) {
      return getSingleton().panel.onRefresh(callback);
    }
  }
};

// src/app-entry.ts
function nativeBridge(targetWindow) {
  return targetWindow.hanaAppWindow;
}
function requireNativeBridge(targetWindow) {
  const bridge = nativeBridge(targetWindow);
  if (!bridge) throw Object.assign(new Error("This App surface is not an App-owned native window."), { code: "APP_WINDOW_UNAVAILABLE" });
  return bridge;
}
function appWindowUi(getWindow) {
  const bridge = typeof window !== "undefined" ? nativeBridge(getWindow()) : void 0;
  bridge?.onDocumentAction?.((operation) => {
    const result = performHostUiAction(getWindow().document, operation, true);
    if (result.ok === false) throw Object.assign(new Error(result.error), { code: result.code });
    return result.result;
  });
  return {
    getContext: () => requireNativeBridge(getWindow()).getContext(),
    getDroppedResources: (files) => {
      const native = requireNativeBridge(getWindow());
      if (!native.getDroppedResources) return Promise.reject(Object.assign(new Error("Update Hana to import dropped local resources."), { code: "APP_SDK_HOST_UNSUPPORTED" }));
      return native.getDroppedResources([...files]);
    },
    request: (message) => requireNativeBridge(getWindow()).request(message),
    onRequest: (handler) => requireNativeBridge(getWindow()).onRequest(handler),
    onContextChanged: (listener) => requireNativeBridge(getWindow()).onContextChanged(listener),
    onInspect: (handler) => {
      const native = requireNativeBridge(getWindow());
      if (!native.onInspect) throw Object.assign(new Error("Update Hana to register App window inspection."), { code: "APP_SDK_HOST_UNSUPPORTED" });
      return native.onInspect(handler);
    },
    registerInspectionSurface: (surface, handler) => {
      const native = requireNativeBridge(getWindow());
      if (!native.registerInspectionSurface) throw Object.assign(new Error("Update Hana to register App inspection surfaces."), { code: "APP_SDK_HOST_UNSUPPORTED" });
      return native.registerInspectionSurface(surface, handler);
    },
    control: (action) => requireNativeBridge(getWindow()).control(action),
    close: () => requireNativeBridge(getWindow()).close()
  };
}
var APP_UI_HOST_REQUEST_TYPES = /* @__PURE__ */ new Set([
  "hana.app-surface.mount",
  "hana.app-surface.action",
  "hana.app-surface.native",
  PLUGIN_UI_CAPABILITY.TOAST_SHOW,
  PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN,
  PLUGIN_UI_CAPABILITY.CLIPBOARD_WRITE_TEXT,
  PLUGIN_UI_CAPABILITY.RESOURCE_OPEN,
  PLUGIN_UI_CAPABILITY.RESOURCE_PICK,
  PLUGIN_UI_CAPABILITY.RESOURCE_SAVE_FILE,
  PLUGIN_UI_CAPABILITY.RESOURCE_REQUEST_ACCESS,
  PLUGIN_UI_CAPABILITY.STATE_GET,
  PLUGIN_UI_CAPABILITY.STATE_SET,
  PLUGIN_UI_CAPABILITY.PANEL_SET,
  PLUGIN_UI_CAPABILITY.EMIT,
  PLUGIN_UI_CAPABILITY.TRACK,
  ...Object.values(APP_STORAGE_CAPABILITY),
  ...Object.values(APP_CARD_CAPABILITY),
  APP_SURFACE_CAPABILITY.SET_INTERACTIVE_REGIONS,
  "hana.document.get-context",
  "hana.document.read",
  "hana.document.report-status",
  "hana.document.open",
  "hana.document.rebind",
  "hana.document.open-drop"
]);
function browserWindow() {
  if (typeof window === "undefined") throw new Error("@hana/app-sdk/ui requires a browser App iframe.");
  return window;
}
function assertAppUiSurface(targetWindow) {
  const pathname = targetWindow.location?.pathname ?? "";
  if (!/^\/api\/apps\/[^/]+\/ui(?:\/|$)/.test(pathname)) {
    throw new Error("@hana/app-sdk/ui requires an App iframe route under /api/apps/:appId/ui/.");
  }
}
function assertAllowedHostRequest(type) {
  if (!APP_UI_HOST_REQUEST_TYPES.has(type)) {
    throw new Error(`@hana/app-sdk/ui does not expose host request type: ${type}`);
  }
}
function appStorage(getSdk) {
  return {
    get global() {
      return getSdk().storage.global;
    },
    agent(agentId) {
      return getSdk().storage.agent(agentId);
    }
  };
}
function appUiSdk(getSdk, getWindow = browserWindow, options = {}) {
  return {
    window: appWindowUi(getWindow),
    surfaces: {
      onEvent(surfaceId, listener) {
        if (typeof surfaceId !== "string" || !surfaceId.trim() || surfaceId.length > 256 || typeof listener !== "function") {
          throw new TypeError("surfaces.onEvent requires a surface id and a listener.");
        }
        return requireNativeBridge(getWindow()).onMessage((value) => {
          const parsed = parsePluginUiMessage(value);
          if (!parsed.ok || parsed.value.kind !== "event" || parsed.value.type !== "hana.app-surface.event") return;
          const event = parsed.value.payload;
          if (!event || typeof event !== "object" || Array.isArray(event)) return;
          const notification = event;
          if (notification.surfaceId !== surfaceId || typeof notification.type !== "string" || !notification.type.trim()) return;
          listener({ surfaceId, type: notification.type, ...notification.payload === void 0 ? {} : { payload: notification.payload } });
        });
      }
    },
    appEvents: {
      on(type, listener) {
        if (typeof type !== "string" || !type.trim() || type.length > 128 || typeof listener !== "function") throw new TypeError("appEvents.on requires an event name and a listener.");
        const target = getWindow();
        assertAppUiSurface(target);
        const appId = decodeURIComponent(new URL(target.location.href).pathname.match(/^\/api\/apps\/([^/]+)\/ui(?:\/|$)/)[1]);
        const receive = (value) => {
          const parsed = parsePluginUiMessage(value);
          if (!parsed.ok || parsed.value.kind !== "event" || parsed.value.type !== "hana.app.event") return;
          const event = parsed.value.payload;
          if (event?.source !== `app:${appId}` || event.type !== type || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return;
          listener(event.payload);
        };
        const transport = options.messageTransport ?? nativeBridge(target);
        if (transport) return transport.onMessage(receive);
        const parent = options.parentWindow ?? target.parent;
        const origin = resolveTargetOrigin(target, options.targetOrigin);
        const onMessage = (event) => {
          if (isTrustedHostEvent(event, parent, origin)) receive(event.data);
        };
        target.addEventListener("message", onMessage);
        return () => target.removeEventListener("message", onMessage);
      }
    },
    instances: {
      onChanged(listener) {
        return requireNativeBridge(getWindow()).onMessage((message) => {
          if (!message || typeof message !== "object") return;
          const event = message;
          if (event.protocol !== PLUGIN_UI_PROTOCOL || event.version !== PLUGIN_UI_PROTOCOL_VERSION || event.kind !== "event" || event.type !== "hana.app-instance.changed") return;
          const payload = event.payload;
          if (payload && typeof payload.instanceId === "string" && typeof payload.revision === "number" && Number.isSafeInteger(payload.revision) && typeof payload.state === "string") {
            listener({ instanceId: payload.instanceId, revision: payload.revision, state: payload.state });
          }
        });
      }
    },
    environments: {
      onChanged(listener) {
        if (typeof listener !== "function") throw new TypeError("environments.onChanged requires a listener.");
        return requireNativeBridge(getWindow()).onMessage((message) => {
          const parsed = parsePluginUiMessage(message);
          if (!parsed.ok || parsed.value.kind !== "event" || parsed.value.type !== "hana.app-environment.changed") return;
          const payload = parsed.value.payload;
          if (payload && typeof payload.environmentId === "string" && typeof payload.revision === "number" && Number.isSafeInteger(payload.revision) && typeof payload.state === "string") {
            listener({ environmentId: payload.environmentId, revision: payload.revision, state: payload.state });
          }
        });
      }
    },
    ready(payload) {
      return getSdk().ready(payload);
    },
    inputPanel: {
      getContext() {
        return getSdk().inputPanel.getContext();
      },
      onContextChanged(callback) {
        return getSdk().inputPanel.onContextChanged(callback);
      },
      onSubmit(handler) {
        return getSdk().inputPanel.onSubmit(handler);
      },
      setPresentation(patch) {
        return getSdk().inputPanel.setPresentation(patch);
      }
    },
    assets: { url(path) {
      return getSdk().assets.url(path);
    } },
    api: {
      url(path) {
        return getSdk().api.url(path);
      },
      fetch(path, init) {
        return getSdk().api.fetch(path, init);
      }
    },
    ui: { resize(size) {
      return getSdk().ui.resize(size);
    } },
    theme: {
      getSnapshot() {
        return getSdk().theme.getSnapshot();
      },
      subscribe(callback) {
        return getSdk().theme.subscribe(callback);
      }
    },
    envelope: {
      getSnapshot() {
        return getSdk().envelope.getSnapshot();
      },
      subscribe(callback) {
        return getSdk().envelope.subscribe(callback);
      }
    },
    lifecycle: {
      getSnapshot() {
        return getSdk().lifecycle.getSnapshot();
      },
      subscribe(callback) {
        return getSdk().lifecycle.subscribe(callback);
      }
    },
    cards: { open(cardId) {
      return getSdk().cards.open(cardId);
    } },
    surface: {
      setInteractiveRegions(regions, options2) {
        return getSdk().surface.setInteractiveRegions(regions, options2);
      },
      getContext() {
        return getSdk().surface.getContext();
      },
      onContextChanged(callback) {
        return getSdk().surface.onContextChanged(callback);
      }
    },
    sessions: {
      getActive(options2) {
        return getSdk().sessions.getActive(options2);
      },
      focus(input, options2) {
        return getSdk().sessions.focus(input, options2);
      },
      onActiveChanged(callback, onError) {
        return getSdk().sessions.onActiveChanged(callback, onError);
      }
    },
    performance: {
      requestAnimationFrame(callback) {
        return getSdk().performance.requestAnimationFrame(callback);
      },
      cancelAnimationFrame(handle) {
        return getSdk().performance.cancelAnimationFrame(handle);
      }
    },
    host: {
      request(type, payload, options2) {
        assertAllowedHostRequest(type);
        return getSdk().host.request(type, payload, options2);
      }
    },
    toast: { show(input, options2) {
      return getSdk().toast.show(input, options2);
    } },
    external: { open(input, options2) {
      return getSdk().external.open(input, options2);
    } },
    clipboard: { writeText(input, options2) {
      return getSdk().clipboard.writeText(input, options2);
    } },
    resources: {
      open(input, options2) {
        return getSdk().resources.open(input, options2);
      },
      pick(input, options2) {
        return getSdk().resources.pick(input, options2);
      },
      saveFile(input, options2) {
        return getSdk().resources.saveFile(input, options2);
      },
      requestAccess(input, options2) {
        return getSdk().resources.requestAccess(input, options2);
      }
    },
    document: {
      getContext(options2) {
        return getSdk().document.getContext(options2);
      },
      read(options2) {
        return getSdk().document.read(options2);
      },
      reportStatus(status, options2) {
        return getSdk().document.reportStatus(status, options2);
      },
      open(input, options2) {
        return getSdk().document.open(input, options2);
      },
      rebind(input, options2) {
        return getSdk().document.rebind(input, options2);
      },
      openDrop(event, options2) {
        return getSdk().document.openDrop(event, options2);
      },
      onRequest(handler) {
        return getSdk().document.onRequest(handler);
      },
      onViewRequest(handler) {
        return getSdk().document.onViewRequest(handler);
      }
    },
    state: {
      get(key, options2) {
        return getSdk().state.get(key, options2);
      },
      set(keyOrState, value, options2) {
        return getSdk().state.set(keyOrState, value, options2);
      }
    },
    storage: appStorage(getSdk),
    emit(name, payload, to, options2) {
      return getSdk().emit(name, payload, to, options2);
    },
    track(name, payload, options2) {
      return getSdk().track(name, payload, options2);
    },
    panel: {
      set(props, options2) {
        return getSdk().panel.set(props, options2);
      },
      onEvent(callback) {
        return getSdk().panel.onEvent(callback);
      },
      onRefresh(callback) {
        return getSdk().panel.onRefresh(callback);
      }
    }
  };
}
function createHanaAppUiSdk(options = {}) {
  const targetWindow = options.targetWindow ?? browserWindow();
  assertAppUiSurface(targetWindow);
  const bridge = nativeBridge(targetWindow);
  const sdk = createHanaPluginSdk({ ...options, ...bridge && !options.messageTransport ? { messageTransport: bridge } : {} });
  return appUiSdk(() => sdk, () => targetWindow, options);
}
var nativeSdk;
var hana2 = appUiSdk(() => {
  const targetWindow = browserWindow();
  assertAppUiSurface(targetWindow);
  const bridge = nativeBridge(targetWindow);
  if (bridge) return nativeSdk ??= createHanaPluginSdk({ targetWindow, messageTransport: bridge });
  return hana;
});
export {
  createHanaAppUiSdk,
  hana2 as hana
};
