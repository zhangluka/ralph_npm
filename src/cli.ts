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

interface CommonOptions {
  changesDir?: string;
}

function printSummary(summary: Awaited<ReturnType<typeof executeApplyQueue>>["summary"]): void {
  console.log(`runId: ${summary.runId}`);
  console.log(`changesDir: ${summary.changesDir}`);
  console.log(
    `totals => total=${summary.totals.total}, ready=${summary.totals.ready}, skipped=${summary.totals.skipped}, success=${summary.totals.success}, failed=${summary.totals.failed}`,
  );
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
    const projectRoot = process.cwd();
    const changesDir = await resolveChangesDir(projectRoot, opts.changesDir);
    const changes = await scanChanges(changesDir);
    const ready = changes.filter((item) => item.state === "ready");
    const notReady = changes.filter((item) => item.state === "not-ready");

    console.log(`projectRoot: ${projectRoot}`);
    console.log(`changesDir: ${changesDir}`);
    console.log("");
    console.log(`apply-ready (${ready.length}):`);
    for (const item of ready) {
      console.log(`- ${item.id}`);
    }
    console.log("");
    console.log(`not-ready (${notReady.length}):`);
    for (const item of notReady) {
      console.log(`- ${item.id}: ${item.reason ?? "not ready"}`);
    }
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
    const projectRoot = process.cwd();
    const runPaths = await ensureRunPaths(projectRoot);
    const changesDir = await resolveChangesDir(projectRoot, opts.changesDir);
    const changes = await scanChanges(changesDir);
    const runId = typeof opts.resume === "string" ? opts.resume : createRunId();

    const result = await executeApplyQueue(changes, {
      projectRoot,
      changesDir,
      agentCommand: String(opts.agentCmd ?? "devagent --yolo"),
      retry: Number(opts.retry ?? 1),
      timeoutMs: Number(opts.timeoutMs ?? 1200000),
      concurrency: Number(opts.concurrency ?? 1),
      dryRun: Boolean(opts.dryRun),
      runId,
      stateDir: runPaths.runsDir,
      logsDir: runPaths.logsDir,
    });

    printSummary(result.summary);
    if (!opts.dryRun) {
      console.log(`state: ${result.statePath}`);
      console.log(`logs: ${path.join(runPaths.logsDir, runId)}`);
    }
  });

program
  .command("report")
  .description("Show run report by runId.")
  .argument("<runId>", "run id")
  .action(async (runId: string) => {
    const projectRoot = process.cwd();
    const runPaths = await ensureRunPaths(projectRoot);
    const statePath = resolveRunStatePath(runPaths.runsDir, runId);
    const summary = await readRunState(statePath);
    printSummary(summary);
    console.log("");
    console.log("records:");
    for (const item of summary.records) {
      console.log(
        `- ${item.changeId}: status=${item.status}, attempts=${item.attempts}, failure=${item.failureKind ?? "-"}, log=${item.logPath ?? "-"}`,
      );
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
