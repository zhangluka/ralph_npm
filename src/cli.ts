#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { scanChanges, resolveChangesDir } from "./discovery/changeScanner.js";
import { executeApplyQueue } from "./orchestrator/applyExecutor.js";
import {
  createRunId,
  ensureRunPaths,
  readRunState,
  resolveRunStatePath,
} from "./reporting/logger.js";
import {
  logSection,
  logSuccess,
  logInfo,
  logDebug,
  logError,
  logWarning,
  logSummary,
  logNextStep,
} from "./reporting/consoleLogger.js";
import type { RunSummary } from "./types.js";

interface CommonOptions {
  changesDir?: string;
}

const program = new Command();
program
  .name("phspec-auto-apply")
  .description("Scan all changes and auto apply apply-ready changes via agent.")
  .version("0.1.0");

program
  .command("list")
  .description("List apply-ready changes (tasks.md exists).")
  .option("--changes-dir <path>", "changes directory, e.g. phspec/changes")
  .action(async (opts: CommonOptions) => {
    logSection("PhSpec Auto Apply - List Changes");

    const projectRoot = process.cwd();
    logInfo(`Project root: ${projectRoot}`);

    const changesDir = await resolveChangesDir(projectRoot, opts.changesDir);
    logSuccess(`Changes directory resolved: ${changesDir}`);

    const changes = await scanChanges(changesDir);
    logInfo(`Scanned ${changes.length} changes`);

    const ready = changes.filter((item) => item.state === "ready");
    const notReady = changes.filter((item) => item.state === "not-ready");

    logSummary("Apply-ready changes", {
      count: ready.length,
      items: ready.map((item) => item.id),
    });

    if (ready.length > 0) {
      logNextStep("Use 'phspec-auto-apply run' to apply these changes");
    }

    logSummary("Not-ready changes", {
      count: notReady.length,
      items: notReady.map((item) => ({ id: item.id, reason: item.reason ?? "not ready" })),
    });

    logSummary("Total", {
      total: changes.length,
      ready: ready.length,
      notReady: notReady.length,
    });
  });

program
  .command("run")
  .description("Run agent for apply-ready changes.")
  .option("--changes-dir <path>", "changes directory, e.g. phspec/changes")
  .option("--agent-cmd <command>", "agent command", "devagent --yolo")
  .option("--concurrency <n>", "concurrency", "1")
  .option("--retry <n>", "retry times", "1")
  .option("--timeout-ms <n>", "timeout milliseconds", "1200000")
  .option("--dry-run", "only detect and print, do not execute")
  .option("--resume <runId>", "resume from existing run id")
  .action(async (opts: CommonOptions & Record<string, string | boolean | undefined>) => {
    logSection("PhSpec Auto Apply - Run");

    const projectRoot = process.cwd();
    logInfo(`Project root: ${projectRoot}`);

    const runPaths = await ensureRunPaths(projectRoot);
    logInfo(`Run paths initialized`);

    const changesDir = await resolveChangesDir(projectRoot, opts.changesDir);
    logSuccess(`Changes directory: ${changesDir}`);

    const changes = await scanChanges(changesDir);
    const readyChanges = changes.filter((item) => item.state === "ready");
    logInfo(`Found ${changes.length} changes, ${readyChanges.length} ready to apply`);

    const runId = typeof opts.resume === "string" ? opts.resume : createRunId();
    if (opts.resume) {
      logInfo(`Resuming from run ID: ${runId}`);
    } else {
      logInfo(`New run ID: ${runId}`);
    }

    const agentCommand = String(opts.agentCmd ?? "devagent --yolo");
    logInfo(`Agent command: ${agentCommand}`);
    logInfo(`Concurrency: ${opts.concurrency ?? 1}`);
    logInfo(`Max retries: ${opts.retry ?? 1}`);
    logInfo(`Timeout: ${opts.timeoutMs ?? 1200000}ms`);

    if (opts.dryRun) {
      logWarning("Dry-run mode: No actual changes will be applied");
    }

    logNextStep("Starting execution queue");

    const result = await executeApplyQueue(changes, {
      projectRoot,
      changesDir,
      agentCommand,
      retry: Number(opts.retry ?? 1),
      timeoutMs: Number(opts.timeoutMs ?? 1200000),
      concurrency: Number(opts.concurrency ?? 1),
      dryRun: Boolean(opts.dryRun),
      runId,
      stateDir: runPaths.runsDir,
      logsDir: runPaths.logsDir,
    });

    logSection("Execution Summary");
    logSummary("Run Info", {
      runId: result.summary.runId,
      changesDir: result.summary.changesDir,
    });

    logSummary("Statistics", result.summary.totals);

    if (!opts.dryRun) {
      logSuccess(`State saved to: ${result.statePath}`);
      logSuccess(`Logs saved to: ${path.join(runPaths.logsDir, runId)}`);
    }

    const { success, failed } = result.summary.totals;
    if (failed === 0 && success > 0) {
      logSuccess("All changes applied successfully!");
    } else if (failed > 0) {
      logError(`${failed} change(s) failed to apply`);
    }
  });

program
  .command("report")
  .description("Show run report by runId.")
  .argument("<runId>", "run id")
  .action(async (runId: string) => {
    logSection("PhSpec Auto Apply - Report");

    const projectRoot = process.cwd();
    const runPaths = await ensureRunPaths(projectRoot);
    const statePath = resolveRunStatePath(runPaths.runsDir, runId);

    logInfo(`Reading run state for runId: ${runId}`);
    logDebug(`State file path: ${statePath}`);

    let summary: RunSummary | null = null;
    try {
      summary = await readRunState(statePath);
      logSuccess("Run state loaded");
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === "ENOENT") {
        logError(`Run state file not found: ${statePath}`);
        logInfo(`This may be because:`);
        logInfo(`  1. The run was interrupted before state could be saved`);
        logInfo(`  2. The run ID is incorrect`);
        logInfo(`  3. The state file was deleted`);
        console.log("");
        logInfo(`You can check the logs directory for available runs:`);
        logInfo(`  ${path.join(runPaths.logsDir)}`);
        console.log("");
        logInfo(`Or use 'phspec-auto-apply list' to see available changes.`);
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    if (!summary) {
      logError("Summary is null, this should not happen");
      process.exitCode = 1;
      return;
    }

    logSummary("Run Info", {
      runId: summary.runId,
      projectRoot: summary.projectRoot,
      changesDir: summary.changesDir,
      agentCommand: summary.agentCommand,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
    });

    logSummary("Statistics", summary.totals);

    console.log("");
    logInfo("Change records:");

    for (const item of summary.records) {
      const statusIcon = item.status === "success" ? "✓" : item.status === "failed" ? "✗" : "○";
      const durationStr = item.durationMs ? ` (${(item.durationMs / 1000).toFixed(2)}s)` : "";
      console.log(`  ${statusIcon} ${item.changeId}`);
      console.log(`    status: ${item.status}${durationStr}`);
      console.log(`    attempts: ${item.attempts}`);
      if (item.failureKind) {
        console.log(`    failure: ${item.failureKind}`);
      }
      if (item.message) {
        console.log(`    message: ${item.message}`);
      }
      if (item.logPath) {
        console.log(`    log: ${item.logPath}`);
      }
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
