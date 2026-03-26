import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplyPrompt } from "../src/agent/promptBuilder.js";
import type { ChangeItem } from "../src/types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (target) => {
      await rm(target, { recursive: true, force: true });
    }),
  );
});

describe("prompt builder", () => {
  it("includes tasks and optional docs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "phspec-auto-apply-"));
    tempRoots.push(root);
    const changePath = path.join(root, "phspec", "changes", "add-dark-mode");
    await mkdir(changePath, { recursive: true });
    const tasksPath = path.join(changePath, "tasks.md");
    await writeFile(tasksPath, "- [ ] implement dark mode\n", "utf8");
    await writeFile(path.join(changePath, "proposal.md"), "why: improve UX\n", "utf8");

    const change: ChangeItem = {
      id: "add-dark-mode",
      name: "add-dark-mode",
      path: changePath,
      tasksPath,
      state: "ready",
    };

    const prompt = await buildApplyPrompt(change);
    expect(prompt).toContain("tasks.md:");
    expect(prompt).toContain("implement dark mode");
    expect(prompt).toContain("proposal.md:");
    expect(prompt).toContain("COMPLETED:");
  });
});
