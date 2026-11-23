import path from "node:path";

// PDF 后端降级链留空时的自动档：先云端 MinerU，再 SoMark（OXR），再 PaddleOCR，
// 然后自建的本地 MinerU，最后本地。
// 自建后端填了地址才生效，未填的由 Python 侧在选链时剔除；OXR 没填 Token 同样会被剔除。
export const DEFAULT_PDF_BACKEND_CHAIN = [
  "mineru",
  "oxr",
  "paddleocr",
  "mineru-local",
  "local",
];

// 公式兜底链的默认值：只有本地转换器（OMML + MathType）。两个小模型要用户装了才
// 会出现在链上，所以默认不列它们。local 永远是前置条件，永远在首位。
export const DEFAULT_FORMULA_CHAIN = ["local"];

function stringify(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArrayValue(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    // v2 设置 schema 没有 array + items.enum，降级链以字符串存储。
    // 分隔符兼容 v1 的 ; , 换行，另接受 > 便于书写 "mineru>paddleocr>local"。
    return value
      .split(/[;,>\n]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return null;
}

function normalizePath(value) {
  if (!value) return "";
  return path.normalize(value);
}

export function arrayValue(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[;\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return fallback;
}

export function arrayObjectValue(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.filter(
      (v) => v && typeof v === "object" && (v.accessKey || v.secretKey)
    );
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[;\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const parts = item.split(":");
        if (parts.length >= 2) {
          return { accessKey: parts[0].trim(), secretKey: parts.slice(1).join(":").trim() };
        }
        return { accessKey: item, secretKey: "" };
      });
  }
  return fallback;
}

export const parseCredentials = arrayObjectValue;
export const parseTokens = arrayValue;

export function getSettings(ctx) {
  const get = (key) => {
    try {
      const v = ctx?.config?.get?.(key);
      return v !== undefined ? v : undefined;
    } catch {
      return undefined;
    }
  };

  // 公式兜底小模型的权重放在插件数据目录下（与 jobs.json / mineru-service 同一层）。
  // 目录只能来自宿主给的 dataDir：自己猜路径，宿主换存储布局后会静默读不到权重。
  const dataDir = typeof ctx?.dataDir === "string" ? ctx.dataDir : "";

  return {
    pythonPath: normalizePath(stringify(get("pythonPath"))),
    defaultBackend: stringify(get("defaultBackend")) || "auto",
    mineruCredentials: arrayObjectValue(get("mineruCredentials"), []),
    mineruModelVersion: stringify(get("mineruModelVersion")) || "vlm",
    mineruEnableOCR: get("mineruEnableOCR") ?? true,
    mineruEnableFormula: get("mineruEnableFormula") ?? true,
    mineruEnableTable: get("mineruEnableTable") ?? true,
    paddleTokens: arrayValue(get("paddleTokens"), []),
    oxrTokens: arrayValue(get("oxrTokens"), []),
    // 自建服务的地址与档位；空串 = 没配，对应后端不出现在实际链路里。
    mineruLocalEndpoint: stringify(get("mineruLocalEndpoint")),
    mineruLocalApiKey: stringify(get("mineruLocalApiKey")),
    mineruLocalTier: stringify(get("mineruLocalTier")),
    // 自管实例（插件自己拉起的那个）：启动器路径、监听端口、空闲卸载秒数、自动拉起开关。
    // 数值不在这里做范围校验，越界的值由 lib/mineru-service.js 归一（它才是用法的主场）。
    mineruKitPath: normalizePath(stringify(get("mineruKitPath"))),
    mineruLocalPort: get("mineruLocalPort") ?? 8010,
    mineruLocalIdleSeconds: get("mineruLocalIdleSeconds") ?? 300,
    mineruLocalAutoStart: get("mineruLocalAutoStart") ?? true,
    paddleUseDocOrientationClassify: get("paddleUseDocOrientationClassify") ?? false,
    paddleUseDocUnwarping: get("paddleUseDocUnwarping") ?? true,
    paddleUseChartRecognition: get("paddleUseChartRecognition") ?? true,
    paddleUseSealRecognition: get("paddleUseSealRecognition") ?? false,
    paddleUseTableRecognition: get("paddleUseTableRecognition") ?? true,
    paddleUseFormulaRecognition: get("paddleUseFormulaRecognition") ?? true,
    splitImageThreshold: get("splitImageThreshold") ?? 1.2,
    splitImageTolerance: get("splitImageTolerance") ?? 15,
    splitImageBlankRatio: get("splitImageBlankRatio") ?? 0.98,
    splitImageMinBlank: get("splitImageMinBlank") ?? 5,
    maxConcurrent: get("maxConcurrent") ?? 4,
    maxConcurrentLocal: get("maxConcurrentLocal") ?? 8,
    legacyConversionProvider: stringify(get("legacyConversionProvider")) || "auto",
    libreOfficePath: normalizePath(stringify(get("libreOfficePath"))),
    legacyConversionConcurrency: get("legacyConversionConcurrency") ?? 1,
    legacyConversionTimeoutMs: get("legacyConversionTimeoutMs") ?? 180000,
    maxRetries: get("maxRetries") ?? 3,
    retryBaseDelayMs: get("retryBaseDelayMs") ?? 1000,
    maxRemoteImagesPerHtml: get("maxRemoteImagesPerHtml") ?? 100,
    // 留空 = 自动档（mineru>oxr>paddleocr>mineru-local>local）。返回副本，避免调用方就地修改污染常量。
    pdfBackendChain:
      normalizeArrayValue(get("pdfBackendChain")) || [...DEFAULT_PDF_BACKEND_CHAIN],
    // 图片链留空时由 Python 回落 oxr > paddleocr > mineru > mineru-local。
    imageBackendChain: normalizeArrayValue(get("imageBackendChain")) || [],
    // 公式兜底链：有序后端 id。local 是前置条件（已经跑过了才轮到这里），
    // Python 侧会把它剔掉，只按顺序试装了的小模型。
    formulaChain: normalizeArrayValue(get("formulaChain")) || [...DEFAULT_FORMULA_CHAIN],
    // 权重目录（绝对路径）。空串 = 宿主没给 dataDir，那一层会把链上后端全部当未装。
    formulaModelDir: dataDir ? path.join(dataDir, "models") : "",
    defaultLanguage: stringify(get("defaultLanguage")) || "zh",
    // includeMedia 优先(新名)，旧 includeImages 作为 fallback 兼容老配置
    includeMedia: get("includeMedia") ?? get("includeImages") ?? true,
    barcodeScan: get("barcodeScan") ?? true,
    mineruFlashMaxMB: get("mineruFlashMaxMB") ?? 10,
    mineruFlashMaxPages: get("mineruFlashMaxPages") ?? 20,
    mineruPrecisionMaxMB: get("mineruPrecisionMaxMB") ?? 200,
    mineruPrecisionMaxPages: get("mineruPrecisionMaxPages") ?? 200,
    autoSplitLargePDF: get("autoSplitLargePDF") ?? true,
    splitChunkPages: get("splitChunkPages") ?? 180,
    keyRetryOnFailure: get("keyRetryOnFailure") ?? true,
    notifyKeyFailure: get("notifyKeyFailure") ?? true,
    autoSave: get("autoSave") ?? false,
    // savePath 原样透传，留空就是空。默认位置由 Python 侧在真正要写的那一刻决定。
    // 不在这里补默认值的原因：App 的 JS 进程跑在 Node Permission Model 下，只能读安装
    // 目录 / app-data / 宿主 locales，而「系统文档目录在不在」的判断要触碰这些根之外的
    // 路径，在 JS 里会直接抛 ERR_ACCESS_DENIED（注意：是抛异常，不是返回 false），
    // 于是每次读设置都会炸，哪怕这次调用根本不落盘。
    savePath: stringify(get("savePath")),
    saveJson: get("saveJson") ?? false,
    // 自动清理：开关 + 保留时长（数值与单位分开存）。
    // 默认关：它会删文件，不能因为升级就自己开始动别人的目录。
    // 数值非法一律当归零处理，调用侧会因此跳过清理，不会退化成「立刻删光」。
    cleanupEnabled: get("cleanupEnabled") === true,
    cleanupKeepValue: Number(get("cleanupKeepValue")) > 0 ? Number(get("cleanupKeepValue")) : 7,
    cleanupKeepUnit: ["minute", "hour", "day"].includes(stringify(get("cleanupKeepUnit")))
      ? stringify(get("cleanupKeepUnit"))
      : "day",
    // 兼容旧版单块大小配置；新配置优先。
    inlineBlockBytes: get("inlineBlockBytes") ?? get("maxInlineReturnBytes") ?? 28 * 1024,
    inlineBlockCount: get("inlineBlockCount") ?? 4,
    mediaPathReturnLimit: get("mediaPathReturnLimit") ?? 20,
    logLevel: stringify(get("logLevel")) || "INFO",
    logFile: stringify(get("logFile")),
    htmlExtractMetadata: get("htmlExtractMetadata") ?? true,
    htmlExtractLinks: get("htmlExtractLinks") ?? true,
    htmlExtractImages: get("htmlExtractImages") ?? true,
    htmlExtractCodeBlocks: get("htmlExtractCodeBlocks") ?? true,
    htmlHeadingStyle: stringify(get("htmlHeadingStyle")) || "ATX",
    // Excel 表格统一上限：适用于 .xls、.xlsx、.xlsm。
    xlsxMaxRows: get("xlsxMaxRows") ?? 100,
    xlsxMaxCols: get("xlsxMaxCols") ?? 50,
    // 纯文本按哪个编码解。auto 交给 Python 侧的 txt_extractor 自己判；
    // 其余值只做透传，认不认得出是哪个编码由 Python 那边用 codecs.lookup 决定。
    };
}
