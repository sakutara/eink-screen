import { useEffect, useState } from 'preact/hooks';

/** Minimal observable store with a Preact hook. */
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}

  get state(): T {
    return this.value;
  }

  set(patch: Partial<T>): void {
    this.value = { ...this.value, ...patch };
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  use(): T {
    const [, force] = useState(0);
    useEffect(() => this.subscribe(() => force((n) => n + 1)), []);
    return this.value;
  }
}
