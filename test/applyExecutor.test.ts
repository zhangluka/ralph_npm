import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

    expect(result.summary.totals.ready).toBe(1);
    expect(result.summary.totals.success).toBe(0);
    expect(result.summary.records[0]?.message).toContain("dry-run");
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

    expect(result.summary.totals.success).toBe(1);
    expect(result.summary.records[0]?.attempts).toBe(2);
    expect(result.summary.records[0]?.status).toBe("success");
    const logPath = result.summary.records[0]?.logPath;
    expect(logPath).toBeTruthy();
    const logContent = await readFile(String(logPath), "utf8");
    expect(logContent).toContain("ok-second");
  });
});
