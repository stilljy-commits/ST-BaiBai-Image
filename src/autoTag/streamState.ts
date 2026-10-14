import { reactive } from 'vue';

export type StreamPhase = 'analyzing' | 'pending' | 'generating' | 'saving' | 'ready' | 'error' | 'cancelled';
export interface StreamSlotState { phase: StreamPhase; url?: string; error?: string; }
const slots = reactive(new Map<string, StreamSlotState>());
const actions = new Map<string, { cancel: () => void; retry: () => void }>();

export function streamSlotState(id?: string): StreamSlotState | undefined { return id ? slots.get(id) : undefined; }
export function updateStreamSlot(id: string, value: StreamSlotState): void { slots.set(id, value); }
export function registerStreamActions(id: string, value: { cancel: () => void; retry: () => void }): void { actions.set(id, value); }
export function cancelStreamSlot(id?: string): boolean { if (!id || !actions.has(id)) return false; actions.get(id)!.cancel(); actions.delete(id); slots.delete(id); return true; }
export function retryStreamSlot(id?: string): boolean { if (!id || !actions.has(id)) return false; actions.get(id)!.retry(); return true; }
export function forgetStreamSlot(id: string): void { actions.delete(id); slots.delete(id); }
