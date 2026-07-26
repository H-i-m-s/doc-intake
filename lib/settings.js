import path from "node:path";

function stringify(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArrayValue(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[;,\n]/)
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

  
  
  return {
    pythonPath: normalizePath(stringify(get("pythonPath"))),
    defaultBackend: stringify(get("defaultBackend")) || "auto",
    mineruCredentials: arrayObjectValue(get("mineruCredentials"), []),
    mineruModelVersion: stringify(get("mineruModelVersion")) || "vlm",
    mineruEnableOCR: get("mineruEnableOCR") ?? true,
    mineruEnableFormula: get("mineruEnableFormula") ?? true,
    mineruEnableTable: get("mineruEnableTable") ?? true,
    paddleTokens: arrayValue(get("paddleTokens"), []),
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
    maxRetries: get("maxRetries") ?? 3,
    retryBaseDelayMs: get("retryBaseDelayMs") ?? 1000,
    maxRemoteImagesPerHtml: get("maxRemoteImagesPerHtml") ?? 100,
    pdfBackendChain: normalizeArrayValue(get("pdfBackendChain")) || ["local"],
    defaultLanguage: stringify(get("defaultLanguage")) || "zh",
    // includeMedia 优先(新名)，旧 includeImages 作为 fallback 兼容老配置
    includeMedia: get("includeMedia") ?? get("includeImages") ?? true,
    mineruFlashMaxMB: get("mineruFlashMaxMB") ?? 10,
    mineruFlashMaxPages: get("mineruFlashMaxPages") ?? 20,
    mineruPrecisionMaxMB: get("mineruPrecisionMaxMB") ?? 200,
    mineruPrecisionMaxPages: get("mineruPrecisionMaxPages") ?? 200,
    autoSplitLargePDF: get("autoSplitLargePDF") ?? true,
    splitChunkPages: get("splitChunkPages") ?? 180,
    keyRetryOnFailure: get("keyRetryOnFailure") ?? true,
    notifyKeyFailure: get("notifyKeyFailure") ?? true,
    autoSave: get("autoSave") ?? false,
    savePath: stringify(get("savePath")) || "D:\\Agent",
    saveJson: get("saveJson") ?? false,
    // 兼容旧版单块大小配置；新配置优先。
    inlineBlockBytes: get("inlineBlockBytes") ?? get("maxInlineReturnBytes") ?? 28 * 1024,
    inlineBlockCount: get("inlineBlockCount") ?? 4,
    logLevel: stringify(get("logLevel")) || "INFO",
    logFile: stringify(get("logFile")),
    htmlExtractMetadata: get("htmlExtractMetadata") ?? true,
    htmlExtractLinks: get("htmlExtractLinks") ?? true,
    htmlExtractImages: get("htmlExtractImages") ?? true,
    htmlExtractCodeBlocks: get("htmlExtractCodeBlocks") ?? true,
    htmlHeadingStyle: stringify(get("htmlHeadingStyle")) || "ATX",
    xlsxMaxRows: get("xlsxMaxRows") ?? 100,
    xlsxMaxCols: get("xlsxMaxCols") ?? 50,
  };
}
