import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import os from "node:os";
import path from "node:path";
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
    assert.equal(resolved, changesDir);
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
    assert.equal(changes.length, 2);
    assert.equal(changes.find((c) => c.id === "add-dark-mode")?.state, "ready");
    assert.equal(changes.find((c) => c.id === "add-logs")?.state, "not-ready");
  });
});
