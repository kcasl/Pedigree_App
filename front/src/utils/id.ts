export function createId(prefix: string = 'p'): string {
  // Collision-resistant enough for local-only in-memory usage.
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

