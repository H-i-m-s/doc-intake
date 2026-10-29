// 进度估算：卡片侧和 Node 侧共用同一套算法，两边看到的百分比不会互相打架。
//
// 为什么是「假进度」而不是真进度：云端 MinerU / PaddleOCR 只在结束时回一次结果，
// 中间没有可靠的已完成页数。真进度拿不到，就拿「已经跑了多久」去逼近一条渐近曲线：
// 一开始涨得快（用户需要马上看到有反应），越接近上限越慢，永远不到 100%，
// 最后那一段留给「真的完成了」这个事件去补。
//
// 本模块必须保持零依赖、不碰 DOM、不碰 Node API，卡片 iframe 和 App 主进程都要 import 它。

/** 各后端单页耗时（秒）。数值来自实测的经验值，不是承诺。 */
export const PAGE_SECONDS = {
  "mineru": 0.9,
  "mineru-local": 1.2,
  "paddleocr": 0.6,
  "paddleocr-local": 1.0,
};

/** 固定开销：进程启动、上传、排队、落盘。不随页数增长，所以单独加一项。 */
export const FIXED_OVERHEAD_MS = 8000;

/** 假进度上限。留出的 4 个点表示「最后阶段」，由完成事件收尾。 */
export const PROGRESS_CAP = 96;

/** 曲线陡度。值越大前段涨得越快、后段越贴住上限。 */
export const PROGRESS_K = 2.5;

const DEFAULT_PAGE_SECONDS = 1.0;

/**
 * 按页数和后端估一个总耗时（毫秒）。
 * 页数拿不到（云端上传、非 PDF）时按 1 页算，只为让曲线有个量级，不追求准确。
 */
export function estimateTotalMs(pages, backend) {
  const pageCount = Number(pages);
  const safePages = Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1;
  const perPage = PAGE_SECONDS[backend] ?? DEFAULT_PAGE_SECONDS;
  return safePages * perPage * 1000 + FIXED_OVERHEAD_MS;
}

/**
 * 已跑 elapsedMs 时该显示多少百分比。
 * 指数趋近：elapsed / total 走到几倍时基本贴住上限，但永远不会越过它。
 */
export function fakePercent(elapsedMs, totalMs) {
  const total = Number(totalMs);
  if (!(total > 0)) return 0;
  const elapsed = Number(elapsedMs);
  const safeElapsed = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const raw = PROGRESS_CAP * (1 - Math.exp(-PROGRESS_K * safeElapsed / total));
  if (!Number.isFinite(raw)) return 0;
  return Math.min(PROGRESS_CAP, Math.max(0, raw));
}
