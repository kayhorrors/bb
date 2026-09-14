import type { Environment } from "@bb/domain";
import type { GitCheckoutRef } from "@bb/domain";
import { managedCheckoutNoun, resolveWorkspaceVcs } from "@bb/domain";

type EnvironmentDisplayHostLocality = "local" | "remote";

interface EnvironmentDisplayHostIdentity {
  name: string;
  connected: boolean;
}

export interface EnvironmentDisplayHostContext {
  locality: EnvironmentDisplayHostLocality;
  identity: EnvironmentDisplayHostIdentity | null;
}

export interface EnvironmentDisplayProvider {
  id: string;
  displayName: string;
  icon: string | null;
}

export type EnvironmentDisplayProviderLookup =
  | { status: "loading" }
  | { status: "loaded"; provider: EnvironmentDisplayProvider | null };

export interface EnvironmentDisplayNameSource {
  name: string | null;
  branchName: string | null;
  path: string | null;
  environmentProviderId: string | null;
}

export interface EnvironmentDisplayInfo {
  /**
   * Human-readable environment label: a custom environment name when present,
   * "Provisioning" while the environment is still being set up, "Destroying"
   * while it is torn down, "Destroyed" once it is gone, otherwise "Working
   * locally", "Working remotely", or the checkout's own name — "Worktree" for
   * git, "Workspace" for jj.
   */
  modeLabel: string;
  compactModeLabel: string;
  typeLabel: string;
  providerLabel: string | null;
  lifecycle: "provisioning" | "destroyed" | null;
  id: string;
}

interface FormatEnvironmentDisplayArgs {
  environment: Environment;
  /**
   * Live checkout for this environment, when the caller has it. Used only to
   * recognize a jj workspace whose environment row predates bb recording it.
   */
  checkout?: GitCheckoutRef | null;
  host: EnvironmentDisplayHostContext;
  providerLookup: EnvironmentDisplayProviderLookup;
}

export function resolveEnvironmentDisplayProvider(
  lookup: EnvironmentDisplayProviderLookup,
): EnvironmentDisplayProvider | null {
  return lookup.status === "loaded" ? lookup.provider : null;
}

export function resolveEnvironmentProviderLabel(
  environmentProviderId: string | null,
  lookup: EnvironmentDisplayProviderLookup,
): string | null {
  if (environmentProviderId === null || lookup.status === "loading") {
    return null;
  }
  return lookup.provider === null
    ? environmentProviderId
    : lookup.provider.displayName;
}

export function resolveWorkspaceFolderName(
  workspacePath: string | null,
): string | null {
  if (workspacePath === null) return null;
  const segments = workspacePath.split(/[\\/]+/u).filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

export function resolveEnvironmentDisplayName(
  source: EnvironmentDisplayNameSource,
  lookup: EnvironmentDisplayProviderLookup,
): string | null {
  return (
    source.name ??
    source.branchName ??
    resolveWorkspaceFolderName(source.path) ??
    resolveEnvironmentProviderLabel(source.environmentProviderId, lookup)
  );
}

export function formatEnvironmentDisplay({
  environment,
  checkout,
  host,
  providerLookup,
}: FormatEnvironmentDisplayArgs): EnvironmentDisplayInfo {
  const lifecycle: EnvironmentDisplayInfo["lifecycle"] =
    environment.status === "destroyed"
      ? "destroyed"
      : environment.status === "provisioning"
        ? "provisioning"
        : null;
  const lifecycleLabel =
    lifecycle === "destroyed"
      ? "Destroyed"
      : lifecycle === "provisioning"
        ? "Provisioning"
        : null;
  const managedCheckoutLabel =
    environment.workspaceProvisionType === "managed-worktree"
      ? managedCheckoutNoun(resolveWorkspaceVcs(checkout), {
          capitalized: true,
        })
      : null;
  const providerLabel = resolveEnvironmentProviderLabel(
    environment.environmentProviderId,
    providerLookup,
  );
  const localityLabel = host.locality === "remote" ? "Remote" : "Local";
  const namedLabel =
    providerLabel ??
    (host.locality === "remote" ? "Working remotely" : "Working locally");
  const namedCompactLabel = providerLabel ?? localityLabel;

  return {
    modeLabel:
      environment.name ?? lifecycleLabel ?? managedCheckoutLabel ?? namedLabel,
    compactModeLabel:
      environment.name ??
      lifecycleLabel ??
      managedCheckoutLabel ??
      namedCompactLabel,
    typeLabel:
      providerLabel === null
        ? localityLabel
        : `${providerLabel} · ${localityLabel}`,
    providerLabel,
    lifecycle,
    id: environment.id,
  };
}
