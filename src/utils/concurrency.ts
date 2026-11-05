export function normalizeConcurrency(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const index = nextIndex++;
        if (index >= items.length) {
          return;
        }

        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}
