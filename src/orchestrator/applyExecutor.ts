import path from "node:path";
import { buildApplyPrompt } from "../agent/promptBuilder.js";
import { runAgent } from "../agent/agentRunner.js";
import {
  readRunState,
  resolveRunStatePath,
  writeChangeLog,
  writeRunState,
} from "../reporting/logger.js";
import type { ChangeItem, ExecuteOptions, RunChangeRecord, RunSummary, LogLevel } from "../types.js";
import {
  logInfo,
  logSuccess,
  logError,
  logWarning,
  logTaskStart,
  logTaskProgress,
  logTaskSuccess,
  logTaskFailure,
  logTaskRetry,
  logCommand,
  logNextStep,
  logSubsection,
} from "../reporting/consoleLogger.js";

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
  logSubsection("Initializing execution queue");

  const statePath = resolveRunStatePath(options.stateDir, options.runId ?? "");

  logInfo(`Resuming previous state: ${options.runId && !options.dryRun}`);
  const resumeSummary =
    options.runId && !options.dryRun
      ? await readRunState(statePath).catch(() => null)
      : null;

  if (resumeSummary) {
    logSuccess(`Resuming from previous run: ${resumeSummary.runId}`);
    logInfo(`Previous state: ${resumeSummary.totals.success} succeeded, ${resumeSummary.totals.failed} failed`);
  }

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
  logInfo(`Queued ${readyChanges.length} changes for execution`);

  const queue = [...readyChanges];
  const workerCount = Math.max(1, options.concurrency);
  logInfo(`Starting ${workerCount} worker(s) with concurrency: ${options.concurrency}`);

  logNextStep("Processing changes...");

  const running = Array.from({ length: workerCount }).map(async (workerIndex) => {
    let processedCount = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      {
        const currentTotals = countTotals(summary);
        logTaskProgress(`worker-${workerIndex}`, `processed: ${processedCount}, remaining: ${queue.length}, total: ${currentTotals.total}, success: ${currentTotals.success}, failed: ${currentTotals.failed}`);
      }

      const change = queue.shift();
      if (!change) {
        logTaskProgress(`worker-${workerIndex}`, `queue empty, worker finished. processed: ${processedCount}`);
        return;
      }

      const record = summary.records
.find((item) => item.changeId === change.id);
      if (!record) {
        logWarning(`worker-${workerIndex}: record not found for ${change.id}, skipping`);
        continue;
      }

      if (record.status === "success") {
        logTaskProgress(`worker-${workerIndex}`, `${change.id}: already successful, skipping`);
        continue;
      }

      logTaskStart(change.id, change.name);
      processedCount++;

      if (options.dryRun) {
        record.status = "pending";
        record.message = "dry-run: 已识别为 apply-ready，未执行";
        logInfo(`worker-${workerIndex}: ${change.id} dry-run mode, marking as pending`);
        continue;
      }

      logTaskProgress(change.id, "building prompt...");
      const prompt = await buildApplyPrompt(change);
      logTaskProgress(change.id, "prompt built, starting agent");

      const startedAt = new Date().toISOString();
      let success = false;
      let lastMessage = "";

      for (let attempt = 1; attempt <= options.retry + 1; attempt += 1) {
        record.attempts = attempt;
        record.startedAt = startedAt;

        if (attempt > 1) {
          logTaskRetry(change.id, attempt, options.retry);
        }

        logTaskProgress(change.id, `running agent (attempt ${attempt}/${options.retry + 1})...`);
        logCommand(options.agentCommand, options.projectRoot);

        const result = await runAgent({
          command: options.agentCommand,
          cwd: path.resolve(options.projectRoot),
          prompt,
          timeoutMs: options.timeoutMs,
          attempt,
          logLevel: options.logLevel,
          changeId: change.id,
          maxAttempts: options.retry,
        });

        logTaskProgress(change.id, `agent finished (exitCode: ${result.exitCode}, duration: ${result.durationMs}ms)`);

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

        record.logPath = await writeChangeLog(options.logsDir, summary.runId, change.id, content);
        record.finishedAt = result.finishedAt;
        record.durationMs = result.durationMs;
        record.exitCode = result.exitCode;

        if (!result.failureKind) {
          record.status = "success";
          record.failureKind = undefined;
          record.message = "apply completed";
          success = true;
          logTaskSuccess(change.id, result.durationMs);
          logTaskProgress(change.id, "saving state...");
          break;
        }

        record.status = "failed";
        record.failureKind = result.failureKind;
        lastMessage = `attempt ${attempt} failed: ${result.failureKind}`;
        record.message = lastMessage;

        logTaskFailure(change.id, lastMessage, attempt);

        if (attempt <= options.retry) {
          const backoffMs = 1000 * 2 ** (attempt - 1);
          logTaskProgress(change.id, `waiting ${backoffMs}ms before retry...`);
          await sleep(backoffMs);
        }
      }

      if (!success && !record.message) {
        record.message = lastMessage || "apply failed";
      }

      logTaskProgress(change.id, "saving run state...");
      await writeRunState(statePath, {
        ...summary,
        totals: countTotals(summary),
      });
      logTaskProgress(change.id, "run state saved");
    }
  });

  logInfo("Waiting for all workers to complete...");
  await Promise.all(running);

  logSuccess("All workers completed");
  summary.totals = countTotals(summary);

  if (!options.dryRun) {
    logInfo("Saving final state...");
    await writeRunState(statePath, summary);
    logSuccess("Final state saved");
  }

  logNextStep("Execution complete");
  return { summary, statePath };
}
