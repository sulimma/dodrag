import { createContext } from 'react';

// A boundary starts observing failures before its first await. Work admitted
// during an import or a final save belongs to the same boundary.
export function createSaveCompletion() {
  const pending = new Map<Promise<unknown>, 'import' | 'write'>();
  const failedDrafts = new Set<() => boolean>();
  const hasFailedDraft = () => [...failedDrafts].some(check => check());
  let failures = 0;
  function track<T>(work: Promise<T>, kind: 'import' | 'write') {
    pending.set(work, kind);
    const settled = (success: boolean) => {
      if (!success) failures++;
      pending.delete(work);
    };
    void work.then(value => settled(value !== null && value !== false), () => settled(false));
    return work;
  }
  async function drain() {
    while (pending.size) await Promise.allSettled([...pending.keys()]);
  }
  async function finish(flush: () => Promise<boolean>, hasDrafts: () => boolean) {
    const initialFailures = failures;
    do {
      await drain();
      if (initialFailures !== failures || hasFailedDraft() || !await flush()) return false;
      await drain();
      if (initialFailures !== failures || hasFailedDraft()) return false;
    } while (pending.size || hasDrafts());
    return true;
  }
  return {
    track, finish,
    hasImports: () => [...pending.values()].includes('import'),
    // A submitted edit which failed remains in its editor until retry or discard.
    watchFailedDraft: (check: () => boolean) => {
      failedDrafts.add(check);
      return () => { failedDrafts.delete(check); };
    },
  };
}

export const SaveCompletionContext = createContext<ReturnType<typeof createSaveCompletion> | null>(null);
