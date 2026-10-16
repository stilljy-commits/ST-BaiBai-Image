/** Shared by storage, settings UI and the scheduler. A batch counts images/pages, not panels. */
export const DEFAULT_STREAM_BATCH_SIZE = 3;
export const MAX_STREAM_BATCH_SIZE = 50;

export function normalizeStreamBatchSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_STREAM_BATCH_SIZE, Math.max(1, Math.floor(value)))
    : DEFAULT_STREAM_BATCH_SIZE;
}
