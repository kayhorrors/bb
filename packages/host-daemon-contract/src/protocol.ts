// Version 184 supports Jujutsu sources. Managed checkouts on a colocated jj
// repo are provisioned as jj workspaces rather than git worktrees, the
// `detached` checkout variant can carry a `jj` object naming the bookmark at
// HEAD, and `workspace.commit` refuses to run in a jj main workspace with a
// typed `jj_workspace` error the server maps to 409. An older daemon reports
// no jj checkouts and would provision a git worktree where the server now
// expects a jj workspace, so the bump forces enrolled machines to update.
export const HOST_DAEMON_PROTOCOL_VERSION = 184 as const;

export const HOST_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;
