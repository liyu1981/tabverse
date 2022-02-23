import { List } from 'immutable';

type Task = () => void | Promise<void>;

export class TaskQueue {
  q: List<Task>;

  constructor() {
    this.q = List();
  }

  enqueue(t: Task) {
    this.q = this.q.push(t);
  }

  async run() {
    const _run = async () => {
      if (this.q.size > 0) {
        const t = this.q.first();
        const r = t();
        if (r instanceof Promise) {
          await r;
        }
        this.q = this.q.shift();
      }
      if (this.q.size > 0) {
        setTimeout(_run);
      }
    };
    setTimeout(_run);
  }
}
