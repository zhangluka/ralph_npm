import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import os from "node:os";
import path from "node:path";
import { scanChanges } from "../src/discovery/changeScanner.js";
import { executeApplyQueue } from "../src/orchestrator/applyExecutor.js";
import { createRunId, ensureRunPaths } from "../src/reporting/logger.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (target) => {
      await rm(target, { recursive: true, force: true });
    }),
  );
});

async function createReadyChange(root: string, changeId: string): Promise<void> {
  const changePath = path.join(root, "phspec", "changes", changeId);
  await mkdir(changePath, { recursive: true });
  await writeFile(path.join(changePath, "tasks.md"), "- [ ] task\n", "utf8");
}

describe("apply executor", () => {
  it("supports dry-run without writing state file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "phspec-auto-apply-"));
    tempRoots.push(root);
    await createReadyChange(root, "change-a");
    const changes = await scanChanges(path.join(root, "phspec", "changes"));
    const runPaths = await ensureRunPaths(root);
    const runId = createRunId();

    const result = await executeApplyQueue(changes, {
      projectRoot: root,
      changesDir: path.join(root, "phspec", "changes"),
      agentCommand: "node -e \"process.exit(0)\"",
      retry: 1,
      timeoutMs: 5000,
      concurrency: 1,
      dryRun: true,
      runId,
      stateDir: runPaths.runsDir,
      logsDir: runPaths.logsDir,
    });

    assert.equal(result.summary.totals.ready, 1);
    assert.equal(result.summary.totals.success, 0);
    assert.ok(result.summary.records[0]?.message?.includes("dry-run"));
  });

  it("retries and succeeds on second attempt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "phspec-auto-apply-"));
    tempRoots.push(root);
    await createReadyChange(root, "change-b");
    const changes = await scanChanges(path.join(root, "phspec", "changes"));
    const runPaths = await ensureRunPaths(root);
    const runId = createRunId();

    const agentCmd =
      "node -e \"if(process.env.PHSPEC_AUTO_APPLY_ATTEMPT==='1'){console.error('fail-first');process.exit(2)};console.log('ok-second')\"";

    const result = await executeApplyQueue(changes, {
      projectRoot: root,
      changesDir: path.join(root, "phspec", "changes"),
      agentCommand: agentCmd,
      retry: 2,
      timeoutMs: 5000,
      concurrency: 1,
      dryRun: false,
      runId,
      stateDir: runPaths.runsDir,
      logsDir: runPaths.logsDir,
    });

    assert.equal(result.summary.totals.success, 1);
    assert.equal(result.summary.records[0]?.attempts, 2);
    assert.equal(result.summary.records[0]?.status, "success");
    const logPath = result.summary.records[0]?.logPath;
    assert.ok(logPath);
    const logContent = await readFile(String(logPath), "utf8");
    assert.ok(logContent.includes("ok-second"));
  });
});
