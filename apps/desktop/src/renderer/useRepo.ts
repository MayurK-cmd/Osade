import { useEffect, useState } from 'react';

import { api } from './api.js';

/**
 * The repository the window is scoped to, when it was opened with one.
 *
 * `osade .` passes a path; this turns it into the repo the ledger filters by. Resolving through
 * the daemon rather than matching the path in the renderer is deliberate — the daemon is the one
 * that knows a subdirectory belongs to a repository, and §18.1 says the renderer never decides
 * anything it can be told.
 *
 * A second `osade .` in another repository re-scopes this window rather than opening a new one,
 * which is what `onRepoOpened` is listening for.
 */

export interface OpenRepo {
  repoId: string;
  path: string;
  name: string;
  slug: string | null;
  defaultBranch: string;
}

export function useRepo(): { repo: OpenRepo | null; error: string | null } {
  const [path, setPath] = useState<string | null>(null);
  const [repo, setRepo] = useState<OpenRepo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // What the window was opened on, plus anything a later `osade .` points it at.
  useEffect(() => {
    void window.osade?.openedRepo().then(setPath);
    return window.osade?.onRepoOpened(setPath);
  }, []);

  useEffect(() => {
    if (!path) {
      setRepo(null);
      return;
    }

    let cancelled = false;
    void api
      .repoOpen(path)
      .then((result) => {
        if (cancelled) return;
        setRepo(result);
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return { repo, error };
}
