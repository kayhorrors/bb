export * from "bb-environment-provider-host/jj";
import {
  withProcessLocalQueuedLocks,
  type ProcessLocalQueuedLockWork,
} from "bb-environment-provider-host/process-local-lock";
import type { JjWorkspaceLayout } from "bb-environment-provider-host/jj";

export async function withJjRepoLock<T>(
  layout: JjWorkspaceLayout,
  work: ProcessLocalQueuedLockWork<T>,
  signal?: AbortSignal,
): Promise<T> {
  return withProcessLocalQueuedLocks({
    locks: [{ key: `jj-repo:${layout.repoPath}` }],
    signal,
    work,
  });
}