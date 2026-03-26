import path from "node:path";
import { buildApplyPrompt } from "../agent/promptBuilder.js";
import { runAgent } from "../agent/agentRunner.js";
import {
  readRunState,
  resolveRunStatePath,
  writeChangeLog,
  writeRunState,
} from "../reporting/logger.js";
import type { ChangeItem, ExecuteOptions, RunChangeRecord, RunSummary } from "../types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEmptyRecord(change: ChangeItem): RunChangeRecord {
  return {
    changeId: change.id,
    changePath: change.path,
    status: change.state === "ready" ? "pending" : "skipped",
    attempts: 0,
    message: change.reason,
  };
}

function countTotals(summary: RunSummary): RunSummary["totals"] {
  const totals = {
    total: summary.records.length,
    ready: 0,
    skipped: 0,
    success: 0,
    failed: 0,
  };
  for (const record of summary.records) {
    if (record.status === "skipped") {
      totals.skipped += 1;
      continue;
    }
    totals.ready += 1;
    if (record.status === "success") {
      totals.success += 1;
    } else if (record.status === "failed") {
      totals.failed += 1;
    }
  }
  return totals;
}

function getResumeMap(existing: RunSummary): Map<string, RunChangeRecord> {
  return new Map(existing.records.map((record) => [record.changeId, record]));
}

export interface ExecuteResult {
  summary: RunSummary;
  statePath: string;
}

export async function executeApplyQueue(
  changes: ChangeItem[],
  options: ExecuteOptions,
): Promise<ExecuteResult> {
  const statePath = resolveRunStatePath(options.stateDir, options.runId ?? "");
  const resumeSummary =
    options.runId && !options.dryRun
      ? await readRunState(statePath).catch(() => null)
      : null;

  const resumeMap = resumeSummary ? getResumeMap(resumeSummary) : new Map<string, RunChangeRecord>();
  const summary: RunSummary = {
    runId: options.runId ?? "unknown",
    projectRoot: options.projectRoot,
    changesDir: options.changesDir,
    agentCommand: options.agentCommand,
    createdAt: resumeSummary?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totals: {
      total: 0,
      ready: 0,
      skipped: 0,
      success: 0,
      failed: 0,
    },
    records: changes.map((change) => {
      const resumeRecord = resumeMap.get(change.id);
      if (resumeRecord && (resumeRecord.status === "success" || resumeRecord.status === "skipped")) {
        return resumeRecord;
      }
      return createEmptyRecord(change);
    }),
  };

  const readyChanges = changes.filter((change) => change.state === "ready");
  const queue = [...readyChanges];
  const workerCount = Math.max(1, options.concurrency);
  const running = Array.from({ length: workerCount }).map(async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const change = queue.shift();
      if (!change) {
        return;
      }
      const record = summary.records.find((item) => item.changeId === change.id);
      if (!record) {
        continue;
      }
      if (record.status === "success") {
        continue;
      }
      if (options.dryRun) {
        record.status = "pending";
        record.message = "dry-run: 已识别为 apply-ready，未执行";
        continue;
      }

      const prompt = await buildApplyPrompt(change);
      const startedAt = new Date().toISOString();
      let success = false;
      let lastMessage = "";

      for (let attempt = 1; attempt <= options.retry + 1; attempt += 1) {
        record.attempts = attempt;
        record.startedAt = startedAt;
        const result = await runAgent({
          command: options.agentCommand,
          cwd: path.resolve(options.projectRoot),
          prompt,
          timeoutMs: options.timeoutMs,
          attempt,
        });
        const content = [
          `runId: ${summary.runId}`,
          `change: ${change.id}`,
          `attempt: ${attempt}`,
          `status: ${result.failureKind ? "failed" : "success"}`,
          `startedAt: ${result.startedAt}`,
          `finishedAt: ${result.finishedAt}`,
          `durationMs: ${result.durationMs}`,
          "",
          "---- stdout ----",
          result.stdout,
          "",
          "---- stderr ----",
          result.stderr,
          "",
        ].join("\n");

        // 最后一次覆盖即可，日志保留最新结果。
        record.logPath = await writeChangeLog(options.logsDir, summary.runId, change.id, content);
        record.finishedAt = result.finishedAt;
        record.durationMs = result.durationMs;
        record.exitCode = result.exitCode;

        if (!result.failureKind) {
          record.status = "success";
          record.failureKind = undefined;
          record.message = "apply completed";
          success = true;
          break;
        }

        record.status = "failed";
        record.failureKind = result.failureKind;
        lastMessage = `attempt ${attempt} failed: ${result.failureKind}`;
        record.message = lastMessage;

        if (attempt <= options.retry) {
          const backoffMs = 1000 * 2 ** (attempt - 1);
          await sleep(backoffMs);
        }
      }

      if (!success && !record.message) {
        record.message = lastMessage || "apply failed";
      }

      await writeRunState(statePath, {
        ...summary,
        totals: countTotals(summary),
      });
    }
  });

  await Promise.all(running);
  summary.totals = countTotals(summary);

  if (!options.dryRun) {
    await writeRunState(statePath, summary);
  }

  return { summary, statePath };
}
