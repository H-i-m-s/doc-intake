// Async semaphore - 纯 Node ESM 实现，无依赖。
// 用法：
//   const sem = new Semaphore(max);
//   sem.run(async () => { ... }).then(...)
export class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max);
    this.active = 0;
    this.queue = [];
  }

  async run(taskFn) {
    if (this.active < this.max) {
      this.active++;
      try {
        return await taskFn();
      } finally {
        this.active--;
        this._drain();
      }
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ taskFn, resolve, reject });
    });
  }

  /**
   * 改上限。调大要立刻推一次队列，否则等着的那批会一直等到下一次有任务结束才动；
   * 调小只影响之后放行多少，正在跑的不打断。
   */
  setMax(max) {
    this.max = Math.max(1, max);
    this._drain();
  }

  _drain() {
    while (this.active < this.max && this.queue.length > 0) {
      const { taskFn, resolve, reject } = this.queue.shift();
      this.active++;
      taskFn().then(resolve, reject).finally(() => {
        this.active--;
        this._drain();
      });
    }
  }
}
