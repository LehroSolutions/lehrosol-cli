// Supervisor/worker delegation, inspired by AWS's CLI Agent Orchestrator (tmux + MCP, supervisor-worker) and Hermes Agent's multi-agent building blocks (retry / replan / decompose, checkpointing, stuck detection).

export const RECOVERY_STRATEGIES = ['retry', 'replan', 'decompose', 'escalate'];

export class Supervisor {
  constructor(options) {
    const opts = options || {};
    this.maxConcurrentWorkers = opts.maxConcurrentWorkers || 3;
    this.tasks = new Map();
  }

  enqueue(task) {
    const id = task.id || ('task-' + (this.tasks.size + 1));
    this.tasks.set(id, Object.assign({ id: id, status: 'pending', attempts: 0 }, task));
    return id;
  }

  recoveryFor(task) {
    if (task.attempts < 1) return 'retry';
    if (task.attempts < 3) return 'replan';
    if (!task.decomposed) return 'decompose';
    return 'escalate';
  }

  snapshot() {
    return Array.from(this.tasks.values());
  }
}
