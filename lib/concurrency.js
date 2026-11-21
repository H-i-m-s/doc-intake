// 三档并发闸门：云端 api、本地 local、旧格式转换 legacy。
//
// 为什么是模块级单例：并发上限描述的是「这个进程同时打几个后端」，不是
// 「某一次调用同时打几个」。每次调用各建一份 Semaphore，同进程里工具、卡片、
// 服务叠起来真实并发就是上限乘以入口数，云端那边看到的就是超配额。
// 上限仍然由调用方按设置传进来，这里只负责记住它，并让后到的值覆盖先前的值。

import { Semaphore } from "./semaphore.js";

/** kind -> 该档位的信号量。首次用到某档时才建，没走过的档位不占资源。 */
const semaphores = new Map();

function semaphoreFor(kind, max) {
  const existing = semaphores.get(kind);
  if (!existing) {
    const created = new Semaphore(max);
    semaphores.set(kind, created);
    return created;
  }
  // 上限可能跟着设置改过：同步一次，顺带把按旧上限卡在队列里的任务放出去。
  existing.setMax(max);
  return existing;
}

/** 更新三档上限。没传的档位保持不动，所以可以只改其中一档。 */
export function setLimits({ api, local, legacy } = {}) {
  for (const [kind, max] of [["api", api], ["local", local], ["legacy", legacy]]) {
    if (max === undefined) continue;
    semaphoreFor(kind, max);
  }
}

/** 在某一档的闸门里跑一次 fn，返回 fn 的结果。 */
export async function runWithLimit(kind, max, fn) {
  return semaphoreFor(kind, max).run(fn);
}
