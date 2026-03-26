import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveChangesDir, scanChanges } from "../src/discovery/changeScanner.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (target) => {
      await rm(target, { recursive: true, force: true });
    }),
  );
});

describe("change scanner", () => {
  it("resolves default phspec/changes directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "phspec-auto-apply-"));
    tempRoots.push(root);
    const changesDir = path.join(root, "phspec", "changes");
    await mkdir(changesDir, { recursive: true });

    const resolved = await resolveChangesDir(root);
    expect(resolved).toBe(changesDir);
  });

  it("skips archive and marks apply-ready by tasks.md", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "phspec-auto-apply-"));
    tempRoots.push(root);
    const changesDir = path.join(root, "phspec", "changes");
    await mkdir(changesDir, { recursive: true });

    const ready = path.join(changesDir, "add-dark-mode");
    const notReady = path.join(changesDir, "add-logs");
    const archive = path.join(changesDir, "archive");
    await mkdir(ready, { recursive: true });
    await mkdir(notReady, { recursive: true });
    await mkdir(archive, { recursive: true });
    await writeFile(path.join(ready, "tasks.md"), "- [ ] task 1\n", "utf8");

    const changes = await scanChanges(changesDir);
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.id === "add-dark-mode")?.state).toBe("ready");
    expect(changes.find((c) => c.id === "add-logs")?.state).toBe("not-ready");
  });
});
