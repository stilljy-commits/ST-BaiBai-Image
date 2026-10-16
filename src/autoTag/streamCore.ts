import type { StreamPhase } from '@/autoTag/streamState';
import { normalizeStreamBatchSize } from '@/autoTag/batchSettings';

export interface StreamJob<P, R> {
  id: string;
  ordinal: number;
  createdAt: number;
  input: { raw: string; intent: string; text: string; prefix: string; sourceLine: number };
  phase: StreamPhase;
  controller: AbortController;
  payload?: P;
  result?: R;
  error?: string;
  attached: boolean;
  saved: boolean;
  revision: number;
}
export interface StreamDependencies<P, R> {
  analyze: (job: StreamJob<P, R>) => Promise<P>;
  /** Each configured group is analyzed together, with one independent result per marker. */
  analyzeBatch?: (jobs: StreamJob<P, R>[]) => Promise<P[]>;
  batchFailed?: (jobs: StreamJob<P, R>[], error: unknown) => void;
  generate: (payload: P, job: StreamJob<P, R>) => Promise<R>;
  commit: (job: StreamJob<P, R>) => Promise<boolean>;
  changed: (job: StreamJob<P, R>) => void;
  release: (result: R) => void;
  idle?: () => void;
}

/** Expected sizes at full capacity; incomplete groups are dispatched only when input ends. */
export function streamBatchSizes(capacity: number, batchSize: number = 3): number[] {
  const total = Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : 0;
  const size = normalizeStreamBatchSize(batchSize);
  return Array.from({ length: Math.ceil(total / size) }, (_, index) => Math.min(size, total - index * size));
}

/** Analysis, rendering and persistence have separate lifetimes. DOM never starts jobs. */
export class StreamRun<P, R> {
  readonly jobs: StreamJob<P, R>[] = [];
  private queue: StreamJob<P, R>[] = [];
  private analyzing = 0;
  private stopped = false;
  private active = new Set<Promise<void>>();
  private commits = new Set<string>();
  private committed = new Map<string, number>();
  private generating = new Set<string>();
  private singles = new Set<string>();
  private inputFinished = false;
  private analysisWaiters = new Set<() => void>();
  readonly batchSize: number;
  constructor(readonly id: string, readonly max: number, readonly concurrency: number,
    readonly autoGenerate: boolean, readonly dependencies: StreamDependencies<P, R>, batchSize = 3) {
    this.batchSize = normalizeStreamBatchSize(batchSize);
  }

  add(input: StreamJob<P, R>['input'], payload?: P): StreamJob<P, R> | null {
    if (this.stopped || this.jobs.filter(job => job.phase !== 'cancelled').length >= this.max) return null;
    const ordinal = this.jobs.length;
    const job: StreamJob<P, R> = { id: `${this.id}_${ordinal}`, ordinal, createdAt: performance.now(), input, phase: 'analyzing',
      controller: new AbortController(), attached: false, saved: false, revision: 0 };
    this.jobs.push(job);
    if (payload) { job.payload = payload; job.phase = this.autoGenerate ? 'generating' : 'pending'; this.touch(job); if (this.autoGenerate) this.startGeneration(job); }
    else { this.queue.push(job); this.touch(job); this.pump(); }
    return job;
  }

  attach(jobs: StreamJob<P, R>[]): void {
    for (const job of jobs) { job.attached = true; this.touch(job); }
  }

  cancelJob(job: StreamJob<P, R>): void {
    job.controller.abort(); job.phase = 'cancelled';
    if (job.result) { this.dependencies.release(job.result); job.result = undefined; }
    this.dependencies.changed(job); this.pump(); this.dependencies.idle?.();
  }
  cancel(): void { this.stopped = true; this.queue = []; for (const job of this.jobs) this.cancelJob(job); }

  /** Story completion releases a short final part, without waiting for images or uploads. */
  finishInput(): void { this.inputFinished = true; this.pump(); }

  /** Supplemental analysis shares the analysis limit, rather than waiting for NAI tasks. */
  async analysisSettled(): Promise<void> {
    if (!this.analyzing && !this.queue.length) return;
    await new Promise<void>(resolve => this.analysisWaiters.add(resolve));
  }

  /** Reserve a real analysis slot so a manual retry cannot overlap a supplemental call. */
  async additionalAnalysis<T>(task: () => Promise<T>): Promise<T> {
    do { await this.analysisSettled(); } while (this.analyzing || this.queue.length);
    if (this.stopped) throw new DOMException('Cancelled', 'AbortError');
    this.analyzing++;
    try { return await task(); }
    finally { this.analyzing--; this.pump(); this.dependencies.idle?.(); }
  }

  retry(job: StreamJob<P, R>): void {
    if (this.stopped || job.saved || this.generating.has(job.id) || this.commits.has(job.id) || job.phase === 'analyzing') return;
    job.controller = new AbortController(); job.error = undefined;
    job.createdAt = performance.now();
    if (job.result) { job.phase = 'saving'; this.touch(job); }
    else if (job.payload) this.startGeneration(job);
    else { job.phase = 'analyzing'; this.singles.add(job.id); this.queue.push(job); this.touch(job); this.pump(); }
  }

  get working(): boolean { return this.active.size > 0 || this.analyzing > 0 || this.queue.length > 0; }
  async settled(): Promise<void> { while (this.active.size) await Promise.all([...this.active]); }

  private track(task: Promise<void>): void {
    this.active.add(task);
    void task.finally(() => { this.active.delete(task); this.dependencies.idle?.(); });
  }
  private touch(job: StreamJob<P, R>): void {
    job.revision++; this.dependencies.changed(job);
    if (job.attached && job.payload && !job.controller.signal.aborted) this.commit(job);
  }
  private pump(): void {
    while (!this.stopped && this.analyzing < this.concurrency && this.queue.length) {
      this.queue = this.queue.filter(job => !job.controller.signal.aborted);
      if (!this.queue.length) break;
      const single = !this.dependencies.analyzeBatch || this.singles.has(this.queue[0].id);
      const target = single ? 1 : this.batchSize;
      // A failed part retries through single requests; do not consume the next part's quota.
      const retryAt = this.queue.findIndex(item => this.singles.has(item.id));
      const available = retryAt > 0 ? retryAt : this.queue.length;
      if (!single && available < target && !this.inputFinished && retryAt < 0) break;
      const jobs = this.queue.splice(0, Math.min(target, available));
      this.analyzing++;
      this.track((async () => {
        try {
          const payloads = jobs.length === 1 ? [await this.dependencies.analyze(jobs[0])] : await this.dependencies.analyzeBatch!(jobs);
          if (payloads.length !== jobs.length) throw new Error('批量分析未覆盖所有标记');
          for (let i = 0; i < jobs.length; i++) {
            const item = jobs[i];
            if (item.controller.signal.aborted) continue;
            item.payload = payloads[i];
            item.phase = this.autoGenerate ? 'generating' : 'pending'; this.touch(item);
            if (this.autoGenerate) this.startGeneration(item);
          }
        } catch (error) {
          if (jobs.length > 1 && !this.stopped) {
            const remaining = jobs.filter(item => !item.controller.signal.aborted);
            for (const item of remaining) this.singles.add(item.id);
            this.queue.unshift(...remaining);
            this.dependencies.batchFailed?.(remaining, error);
          } else for (const item of jobs) this.failed(item, error);
        }
        finally { this.analyzing--; this.pump(); }
      })());
    }
    if (!this.analyzing && !this.queue.length) {
      for (const resolve of this.analysisWaiters) resolve();
      this.analysisWaiters.clear();
    }
  }
  private startGeneration(job: StreamJob<P, R>): void {
    if (!job.payload || this.generating.has(job.id) || job.controller.signal.aborted) return;
    this.generating.add(job.id);
    if (job.phase !== 'generating') { job.phase = 'generating'; this.touch(job); }
    this.track((async () => {
      try {
        const result = await this.dependencies.generate(job.payload!, job);
        if (job.controller.signal.aborted) { this.dependencies.release(result); return; }
        job.result = result; job.phase = 'ready'; this.touch(job);
      } catch (error) { this.failed(job, error); }
      finally { this.generating.delete(job.id); }
    })());
  }
  private commit(job: StreamJob<P, R>): void {
    if (this.commits.has(job.id)) return;
    this.commits.add(job.id);
    this.track((async () => {
      try {
        while (!job.controller.signal.aborted && this.committed.get(job.id) !== job.revision) {
          const revision = job.revision;
          const result = job.result;
          const saved = await this.dependencies.commit({ ...job, result });
          this.committed.set(job.id, revision);
          if (saved && result && job.result === result) {
            job.saved = true; this.dependencies.release(result); job.result = undefined;
            job.phase = 'ready'; this.dependencies.changed(job);
          }
        }
      } catch (error) { this.failed(job, error); }
      finally { this.commits.delete(job.id); }
    })());
  }
  private failed(job: StreamJob<P, R>, error: unknown): void {
    if (job.controller.signal.aborted) return;
    job.phase = 'error'; job.error = error instanceof Error ? error.message : String(error);
    this.dependencies.changed(job);
  }
}
