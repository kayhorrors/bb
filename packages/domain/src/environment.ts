import { z } from "zod";
import type { GitCheckoutRef } from "./git-checkout.js";
export const environmentStatusValues = [
  "provisioning",
  "ready",
  "retiring",
  "error",
  "destroying",
  "destroyed",
] as const;
export const environmentStatusSchema = z.enum(environmentStatusValues);
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

const WORKSPACE_PROVISION_TYPES = [
  "unmanaged",
  "managed-worktree",
  "personal",
] as const;
export const workspaceProvisionTypeSchema = z.enum(WORKSPACE_PROVISION_TYPES);
export type WorkspaceProvisionType = z.infer<
  typeof workspaceProvisionTypeSchema
>;

const environmentWorkspaceDisplayKindValues = [
  "managed-worktree",
  "unmanaged-worktree",
  "other",
] as const;
export const environmentWorkspaceDisplayKindSchema = z.enum(
  environmentWorkspaceDisplayKindValues,
);
export type EnvironmentWorkspaceDisplayKind = z.infer<
  typeof environmentWorkspaceDisplayKindSchema
>;

interface ResolveEnvironmentWorkspaceDisplayKindArgs {
  environment: {
    isWorktree: boolean | null;
    workspaceProvisionType: WorkspaceProvisionType | null;
  };
}

export function resolveEnvironmentWorkspaceDisplayKind({
  environment,
}: ResolveEnvironmentWorkspaceDisplayKindArgs): EnvironmentWorkspaceDisplayKind {
  if (environment.workspaceProvisionType === "managed-worktree") {
    return "managed-worktree";
  }

  if (environment.isWorktree === true) {
    return "unmanaged-worktree";
  }

  return "other";
}

const workspaceVcsValues = ["git", "jj"] as const;
/**
 * Which tool owns a workspace's working copy. "jj" means a Jujutsu workspace,
 * where bb reads through a git checkout it keeps alongside jj but commits with
 * jj. It changes what bb calls the checkout in the interface — a workspace,
 * not a worktree — and which commands it runs.
 */
export const workspaceVcsSchema = z.enum(workspaceVcsValues);
export type WorkspaceVcs = z.infer<typeof workspaceVcsSchema>;

/**
 * Which tool owns a workspace, read off its checkout.
 *
 * bb stores nothing about this: a jj workspace is recognizable from the
 * checkout alone, because git reports it detached and bb reports the jj
 * bookmark on it. Surfaces holding only an environment record (the sidebar,
 * provisioning transcripts) cannot tell, and say "worktree".
 */
export function resolveWorkspaceVcs(
  checkout: GitCheckoutRef | null | undefined,
): WorkspaceVcs | null {
  if (checkout?.kind === "detached" && checkout.jj) {
    return "jj";
  }
  return null;
}

/**
 * What to call a bb-managed checkout in text a person reads.
 *
 * git calls it a worktree and jj calls it a workspace, and users of each expect
 * their own word — so every user-facing string that names the thing goes
 * through here rather than hardcoding one of them.
 */
export function managedCheckoutNoun(
  vcs: WorkspaceVcs | null | undefined,
  options: { capitalized?: boolean; plural?: boolean } = {},
): string {
  const noun = vcs === "jj" ? "workspace" : "worktree";
  const withNumber = options.plural ? `${noun}s` : noun;
  return options.capitalized
    ? `${withNumber.charAt(0).toUpperCase()}${withNumber.slice(1)}`
    : withNumber;
}

/**
 * Properties discovered about a workspace during provisioning.
 * Used by the provision command result and to populate the environment record.
 */
export const discoveredWorkspacePropertiesSchema = z.object({
  path: z.string().min(1),
  isGitRepo: z.boolean(),
  isWorktree: z.boolean(),
  branchName: z.string().nullable(),
  defaultBranch: z.string().nullable(),
});
export type DiscoveredWorkspaceProperties = z.infer<
  typeof discoveredWorkspacePropertiesSchema
>;

export const environmentSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  projectId: z.string(),
  hostId: z.string(),
  path: z.string().nullable(),
  managed: z.boolean(),
  isGitRepo: z.boolean(),
  isWorktree: z.boolean(),
  workspaceProvisionType: workspaceProvisionTypeSchema,
  branchName: z.string().nullable(),
  baseBranch: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  mergeBaseBranch: z.string().nullable(),
  status: environmentStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Environment = z.infer<typeof environmentSchema>;

type EnvironmentMergeBaseBranchSource = Pick<
  Environment,
  "baseBranch" | "defaultBranch" | "mergeBaseBranch"
>;

export function resolveEnvironmentMergeBaseBranch(
  environment: EnvironmentMergeBaseBranchSource | null | undefined,
): string | undefined {
  return (
    environment?.mergeBaseBranch ??
    environment?.baseBranch ??
    environment?.defaultBranch ??
    undefined
  );
}
