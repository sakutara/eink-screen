export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn as (payload: never) => void);
    this.listeners.set(type, set);
    return () => set.delete(fn as (payload: never) => void);
  }

  protected emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const fn of this.listeners.get(type) ?? []) (fn as (p: Events[K]) => void)(payload);
  }
}
