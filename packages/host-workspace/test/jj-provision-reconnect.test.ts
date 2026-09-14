import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachShadowGitCheckout,
  runJj,
} from "../src/jj.js";
import { provisionWorkspace } from "../src/provision.js";
import { Workspace } from "../src/workspace.js";
import { resolveAdditionalWorkspaceWriteRoots } from "../src/workspace-write-roots.js";

const execFileAsync = promisify(execFile);

const jjAvailable = await execFileAsync("jj", ["--version"]).then(
  () => true,
  () => false,
);

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return await fs.realpath(dir);
}

async function initColocatedSource(): Promise<string> {
  const sourcePath = await makeTempDir("bb-jj-reconnect-source-");
  await runJj(["git", "init", "--colocate"], { cwd: sourcePath });
  await runJj(["config", "set", "--repo", "user.name", "BB Tests"], {
    cwd: sourcePath,
  });
  await runJj(["config", "set", "--repo", "user.email", "bb@example.com"], {
    cwd: sourcePath,
  });
  await fs.writeFile(path.join(sourcePath, "README.md"), "hello\n", "utf8");
  await runJj(["commit", "-m", "Initial commit"], { cwd: sourcePath });
  await runJj(["bookmark", "create", "main", "-r", "@-"], { cwd: sourcePath });
  return sourcePath;
}

async function createJjWorkspace(
  sourcePath: string,
  branchName: string,
): Promise<string> {
  const parent = await makeTempDir("bb-jj-reconnect-target-");
  const targetPath = path.join(parent, "repo");
  await runJj(
    ["workspace", "add", "--name", branchName, targetPath, "-r", "main"],
    { cwd: sourcePath },
  );
  await attachShadowGitCheckout({ sourcePath, workspacePath: targetPath });
  return targetPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!jjAvailable)("reconnecting to a jj workspace", () => {
  it("rebuilds the jj-backed workspace from the directory alone", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await createJjWorkspace(sourcePath, "bb/thread-1");

    // A daemon restart reconnects with nothing but the path on disk.
    const reconnected = await provisionWorkspace({ path: targetPath });
    expect(reconnected.isWorktree).toBe(true);

    await fs.writeFile(path.join(targetPath, "work.txt"), "work\n", "utf8");
    const status = await reconnected.getStatus();
    expect(status.workingTree.files.map((file) => file.path)).toEqual([
      "work.txt",
    ]);

    const commit = await reconnected.commit({
      message: "after restart",
      noVerify: true,
    });
    // Committed through jj: the bookmark moved and no anonymous head was left
    // behind in the source repository.
    const bookmark = await runJj(
      ["log", "--no-graph", "-r", "bb/thread-1", "-T", "commit_id"],
      { cwd: sourcePath },
    );
    expect(bookmark.stdout.trim()).toBe(commit.commitSha);
  });

  it("grants agents write access to the repository state outside the workspace", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await createJjWorkspace(sourcePath, "bb/thread-1");

    const roots = await resolveAdditionalWorkspaceWriteRoots(targetPath);
    expect(roots).toContain(path.join(sourcePath, ".jj", "repo"));
    expect(roots).toContain(path.join(sourcePath, ".git", "objects"));
  });

  it("changes the shared refs fingerprint when a bookmark moves", async () => {
    const sourcePath = await initColocatedSource();
    const workspace = new Workspace(sourcePath);
    const before = await workspace.getSharedGitRefsFingerprint();

    await fs.writeFile(path.join(sourcePath, "more.txt"), "more\n", "utf8");
    await runJj(["commit", "-m", "Second commit"], { cwd: sourcePath });
    await runJj(["bookmark", "move", "main", "--to", "@-"], {
      cwd: sourcePath,
    });

    const after = await workspace.getSharedGitRefsFingerprint();
    expect(after).not.toBe(before);
  });
});