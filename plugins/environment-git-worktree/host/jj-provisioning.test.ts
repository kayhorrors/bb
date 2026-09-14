import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const renameMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  const realRename = actual.rename;
  renameMock.mockImplementation((fromPath: string, toPath: string) =>
    realRename(fromPath, toPath),
  );
  return { ...actual, rename: renameMock };
});
import { runGit } from "bb-environment-provider-host/git";
import { runJj } from "bb-environment-provider-host/jj";
import { createWorktree, removeWorktree } from "./worktree.js";

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
  const sourcePath = await makeTempDir("bb-jj-provision-source-");
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

async function provision(sourcePath: string, branchName: string) {
  const parent = await makeTempDir("bb-jj-provision-target-");
  const targetPath = path.join(parent, "repo");
  await createWorktree({
    sourcePath,
    targetPath,
    completionPath: path.join(parent, "completion"),
    ownWorktreesRoot: path.join(sourcePath, ".git", "worktrees"),
    branchName,
    baseBranch: "main",
    branchMode: "reset",
  });
  return targetPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!jjAvailable)("provisioning against a colocated jj source", () => {
  it("creates a jj workspace that git can also read", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await provision(sourcePath, "bb/thread-1");

    const workspaces = await runJj(
      ["workspace", "list", "-T", 'name ++ "\\n"'],
      { cwd: sourcePath },
    );
    expect(workspaces.stdout.split("\n")).toContain("bb/thread-1");
    // The shadow git registration is what keeps every git-based read working.
    const gitDir = await runGit(["rev-parse", "--git-dir"], {
      cwd: targetPath,
    });
    expect(gitDir.stdout).toContain("/worktrees/");
    expect(
      (await runGit(["status", "--porcelain"], { cwd: targetPath })).stdout.trim(),
    ).toBe("");
  });

  it("reuses an existing workspace", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await provision(sourcePath, "bb/thread-1");

    await expect(
      createWorktree({
        sourcePath,
        targetPath,
        completionPath: path.join(path.dirname(targetPath), "completion"),
        ownWorktreesRoot: path.join(sourcePath, ".git", "worktrees"),
        branchName: "bb/thread-1",
        baseBranch: "main",
        branchMode: "reset",
      }),
    ).resolves.toMatchObject({ path: targetPath });
  });

  it("replaces a jj workspace that belongs to a different branch", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await provision(sourcePath, "bb/thread-1");

    await createWorktree({
      sourcePath,
      targetPath,
      completionPath: path.join(path.dirname(targetPath), "completion"),
      ownWorktreesRoot: path.join(sourcePath, ".git", "worktrees"),
      branchName: "bb/other-thread",
      baseBranch: "main",
      branchMode: "reset",
    });

    const workspaces = await runJj(
      ["workspace", "list", "-T", 'name ++ "\\n"'],
      { cwd: sourcePath },
    );
    expect(workspaces.stdout.split("\n")).toContain("bb/other-thread");
    expect(workspaces.stdout.split("\n")).not.toContain("bb/thread-1");
  });

  it("bases a workspace on a remote-tracking branch", async () => {
    // bb resolves default bases in git's spelling ("origin/main"). jj has no
    // such revision — the same commit is the remote bookmark "main@origin".
    const upstream = await initColocatedSource();
    const remoteParent = await makeTempDir("bb-jj-remote-");
    const remotePath = path.join(remoteParent, "remote.git");
    await runGit(["clone", "--bare", upstream, remotePath], {
      cwd: remoteParent,
    });
    const cloneParent = await makeTempDir("bb-jj-clone-");
    const clonePath = path.join(cloneParent, "repo");
    await runJj(["git", "clone", "--colocate", remotePath, clonePath], {
      cwd: cloneParent,
    });

    const parent = await makeTempDir("bb-jj-provision-target-");
    const targetPath = path.join(parent, "repo");
    await createWorktree({
      sourcePath: clonePath,
      targetPath,
      completionPath: path.join(parent, "completion"),
      ownWorktreesRoot: path.join(clonePath, ".git", "worktrees"),
      branchName: "bb/thread-1",
      baseBranch: "origin/main",
      branchMode: "reset",
    });

    const head = await runGit(["rev-parse", "HEAD"], { cwd: targetPath });
    const remoteMain = await runGit(["rev-parse", "refs/remotes/origin/main"], {
      cwd: clonePath,
    });
    expect(head.stdout.trim()).toBe(remoteMain.stdout.trim());
  });

  it("leaves nothing registered when provisioning fails", async () => {
    const sourcePath = await initColocatedSource();
    const parent = await makeTempDir("bb-jj-provision-target-");
    const targetPath = path.join(parent, "repo");

    // jj creates the workspace before it resolves the revision, so a bad base
    // fails with a workspace already registered. Rollback has to undo that, or
    // the next attempt trips over the leftover.
    await expect(
      createWorktree({
        sourcePath,
        targetPath,
        completionPath: path.join(parent, "completion"),
        ownWorktreesRoot: path.join(sourcePath, ".git", "worktrees"),
        branchName: "bb/thread-1",
        baseBranch: "no-such-branch",
        branchMode: "reset",
      }),
    ).rejects.toThrow();

    const workspaces = await runJj(
      ["workspace", "list", "-T", 'name ++ "\\n"'],
      { cwd: sourcePath },
    );
    expect(workspaces.stdout.split("\n")).not.toContain("bb/thread-1");
    await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("forgets the jj workspace when the checkout is removed", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await provision(sourcePath, "bb/thread-1");

    await removeWorktree({
      path: targetPath,
    });

    const workspaces = await runJj(
      ["workspace", "list", "-T", 'name ++ "\\n"'],
      { cwd: sourcePath },
    );
    expect(workspaces.stdout.split("\n")).not.toContain("bb/thread-1");
    const worktrees = await runGit(["worktree", "list"], { cwd: sourcePath });
    expect(worktrees.stdout).not.toContain(targetPath);
    await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still provisions plain git sources as git worktrees", async () => {
    const sourcePath = await makeTempDir("bb-jj-plain-source-");
    await runGit(["init", "-b", "main"], { cwd: sourcePath });
    await runGit(["config", "user.name", "BB Tests"], { cwd: sourcePath });
    await runGit(["config", "user.email", "bb@example.com"], { cwd: sourcePath });
    await fs.writeFile(path.join(sourcePath, "README.md"), "hello\n", "utf8");
    await runGit(["add", "."], { cwd: sourcePath });
    await runGit(["commit", "-m", "Initial commit"], { cwd: sourcePath });

    const targetPath = await provision(sourcePath, "bb/thread-1");
    const branch = await runGit(["symbolic-ref", "--short", "HEAD"], {
      cwd: targetPath,
    });
    expect(branch.stdout.trim()).toBe("bb/thread-1");
    await expect(fs.stat(path.join(targetPath, ".jj"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("copies the shadow registration when /tmp is a different filesystem", async () => {
    const sourcePath = await initColocatedSource();
    const parent = await makeTempDir("bb-jj-exdev-target-");
    const targetPath = path.join(parent, "repo");

    // The staged .git lives in os.tmpdir() but the workspace can be on another
    // device (e.g. tmpfs /tmp), which makes rename(2) fail with EXDEV.
    renameMock.mockRejectedValueOnce(
      Object.assign(new Error("EXDEV: cross-device link not permitted"), {
        code: "EXDEV",
      }),
    );

    await expect(
      createWorktree({
        sourcePath,
        targetPath,
        completionPath: path.join(parent, "completion"),
        ownWorktreesRoot: path.join(sourcePath, ".git", "worktrees"),
        branchName: "bb/thread-exdev",
        baseBranch: "main",
        branchMode: "reset",
      }),
    ).resolves.toMatchObject({ path: targetPath });

    // The copied pointer still resolves through git.
    const gitDir = await runGit(["rev-parse", "--git-dir"], {
      cwd: targetPath,
    });
    expect(gitDir.stdout).toContain("/worktrees/");
    expect(
      (await runGit(["status", "--porcelain"], { cwd: targetPath })).stdout.trim(),
    ).toBe("");
  });
});
