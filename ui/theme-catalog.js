// ui/theme-catalog.js — 内置主题清单（可选示例数据，不参与任何自动逻辑）
//
// 宿主没有「列出所有主题」的接口（见 theme-bridge.js 文件头）。这份清单是照着
// 本机安装目录里 themes/*.css 的表头注释抄下来的快照，给需要「主题选择器」的
// 界面当种子用：id 拿去调 theme-bridge 的 paletteOf(id) 读真实色板，
// name 直接显示，bg / accent 可以先画色块，不必等样式表加载。
//
// 怎么用：
//   import { THEME_CATALOG, THEME_IDS } from "./theme-catalog.js";
//   const list = await bridge.listThemes({ ids: THEME_IDS });   // 拿到带 active 标记的列表
//   const palette = await bridge.paletteOf("coral");            // 拿到完整色板
//
// 三点要注意：
//   1. 这是**快照**，不是实时清单。新装的主题（比如衣橱装进来的皮肤）不会自动出现，
//      要重新照着 themes/*.css 抄一遍，或者等宿主补一个列举接口。
//   2. 只有真正带 `Hana Theme:` 表头的才算主题。同一个目录里还有
//      code-page-fonts / content-contrast / continuous-corners /
//      new-warm-paper-fonts 四个文件，它们是字体包、墨色档位和圆角支持，
//      不是主题，收录进来会在下拉里多出四个点不动的项，所以没有。
//   3. bg / accent 是从样式表里抄的值，够画色块；要和页面完全一致的最终颜色，
//      仍以 paletteOf 读出来的为准（它读的是同一张表，只是经过宿主解析）。

/** @type {{id: string, name: string, description: string, appearance: "light"|"dark", bg: string, accent: string}[]} */
export const THEME_CATALOG = [
  {
    id: "absolutely",
    name: "Absolutely",
    description: "暖奶油底 + 哑光赤陶 accent",
    appearance: "light",
    bg: "#F4F3EE",
    accent: "#B5846E",
  },
  {
    id: "contemplation",
    name: "沉思（Contemplation）",
    description: "Ming 灰蓝系，雨天窗外的安静感",
    appearance: "light",
    bg: "#F3F5F7",
    accent: "#7E99A8",
  },
  {
    id: "coral",
    name: "珊瑚（Coral）",
    description: "从参考图提取：和纸白、墨蓝、珊瑚朱、古金与灰青",
    appearance: "light",
    bg: "#FDF6EC",
    accent: "#1A3049",
  },
  {
    id: "deep-think",
    name: "Deep Think",
    description: "DeepSeek 配色致敬 — 干净白底 + 克制的蓝紫点缀",
    appearance: "light",
    bg: "#FCFCFD",
    accent: "#636AE8",
  },
  {
    id: "delve",
    name: "Delve",
    description: "ChatGPT 配色致敬 — 冷调纯白 + 纯黑高对比",
    appearance: "light",
    bg: "#FFFFFF",
    accent: "#1A1A1A",
  },
  {
    id: "grass-aroma",
    name: "草香（Grass Aroma）",
    description: "Butter 青草绿系，清晨露水的透亮感",
    appearance: "light",
    bg: "#F5F8F3",
    accent: "#5BA88C",
  },
  {
    id: "high-contrast",
    name: "素白（High Contrast）",
    description: "基于暖纸主题，降低暖黄、提高对比度",
    appearance: "light",
    bg: "#FAF8F7",
    accent: "#3A6B85",
  },
  {
    id: "midnight",
    name: "青夜",
    description: "深青蓝 + 暖玫瑰，柔和暗色",
    appearance: "dark",
    bg: "#3B4A54",
    accent: "#C99AAF",
  },
  {
    id: "midnight-contrast",
    name: "青夜·高对比",
    description: "更深的青蓝底 + 高可读文字层级",
    appearance: "dark",
    bg: "#26343D",
    accent: "#E6B1C4",
  },
  {
    id: "new-warm-paper",
    name: "新暖纸",
    description: "纸本世界 + 5 档墨色 + 印章青蓝 + 极方圆角 + 0.5px hairline",
    appearance: "light",
    bg: "#F5EFE4",
    accent: "#537D96",
  },
  {
    id: "warm-paper",
    name: "Warm Paper（暖纸）",
    description: "默认主题 — 延续「Hana 的手抄本」视觉语言",
    appearance: "light",
    bg: "#F8F4ED",
    accent: "#537D96",
  },
];

/** 所有 id，按清单顺序。 */
export const THEME_IDS = THEME_CATALOG.map((item) => item.id);

/** 按 id 取一条；没有就返回 null，不要凭空造一个。 */
export function catalogEntry(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  return THEME_CATALOG.find((item) => item.id === key) || null;
}

/** 按明暗分组，选择器要分两栏时直接用。 */
export function catalogByAppearance() {
  return {
    light: THEME_CATALOG.filter((item) => item.appearance === "light"),
    dark: THEME_CATALOG.filter((item) => item.appearance === "dark"),
  };
}
