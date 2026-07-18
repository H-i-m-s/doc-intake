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
