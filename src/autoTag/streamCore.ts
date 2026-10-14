import type { StreamPhase } from '@/autoTag/streamState';

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
  generate: (payload: P, job: StreamJob<P, R>) => Promise<R>;
  commit: (job: StreamJob<P, R>) => Promise<boolean>;
  changed: (job: StreamJob<P, R>) => void;
  release: (result: R) => void;
  idle?: () => void;
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
  constructor(readonly id: string, readonly max: number, readonly concurrency: number,
    readonly autoGenerate: boolean, readonly dependencies: StreamDependencies<P, R>) {}

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
    this.dependencies.changed(job); this.dependencies.idle?.();
  }
  cancel(): void { this.stopped = true; this.queue = []; for (const job of this.jobs) this.cancelJob(job); }

  retry(job: StreamJob<P, R>): void {
    if (this.stopped || job.saved || this.generating.has(job.id) || this.commits.has(job.id) || job.phase === 'analyzing') return;
    job.controller = new AbortController(); job.error = undefined;
    job.createdAt = performance.now();
    if (job.result) { job.phase = 'saving'; this.touch(job); }
    else if (job.payload) this.startGeneration(job);
    else { job.phase = 'analyzing'; this.queue.push(job); this.touch(job); this.pump(); }
  }

  get working(): boolean { return this.active.size > 0 || this.queue.length > 0; }
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
      const job = this.queue.shift()!;
      if (job.controller.signal.aborted) continue;
      this.analyzing++;
      this.track((async () => {
        try {
          const payload = await this.dependencies.analyze(job);
          if (job.controller.signal.aborted) return;
          job.payload = payload;
          job.phase = this.autoGenerate ? 'generating' : 'pending'; this.touch(job);
          if (this.autoGenerate) this.startGeneration(job);
        } catch (error) { this.failed(job, error); }
        finally { this.analyzing--; this.pump(); }
      })());
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
