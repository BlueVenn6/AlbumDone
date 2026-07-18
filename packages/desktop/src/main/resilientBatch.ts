export class RecoverableBatchError<T> extends Error {
  constructor(
    message: string,
    readonly remainingItems: T[],
  ) {
    super(message);
    this.name = 'RecoverableBatchError';
  }
}

export async function runCrashIsolatedBatches<T>(
  items: T[],
  maximumBatchSize: number,
  attempt: (batch: T[]) => Promise<void>,
  onIsolatedFailure: (item: T, error: RecoverableBatchError<T>) => void,
): Promise<void> {
  const batchSize = Math.max(1, Math.floor(maximumBatchSize));

  const runIsolated = async (batch: T[]): Promise<void> => {
    if (batch.length === 0) return;

    try {
      await attempt(batch);
    } catch (error) {
      if (!(error instanceof RecoverableBatchError)) throw error;

      const remaining = error.remainingItems;
      if (remaining.length === 0) return;
      if (remaining.length === 1) {
        onIsolatedFailure(remaining[0]!, error);
        return;
      }

      const midpoint = Math.ceil(remaining.length / 2);
      await runIsolated(remaining.slice(0, midpoint));
      await runIsolated(remaining.slice(midpoint));
    }
  };

  for (let index = 0; index < items.length; index += batchSize) {
    await runIsolated(items.slice(index, index + batchSize));
  }
}
