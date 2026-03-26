import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunSummary } from "../types.js";

export interface RunPaths {
  baseDir: string;
  runsDir: string;
  logsDir: string;
}

export async function ensureRunPaths(projectRoot: string): Promise<RunPaths> {
  const baseDir = path.join(projectRoot, ".phspec-auto-apply");
  const runsDir = path.join(baseDir, "runs");
  const logsDir = path.join(baseDir, "logs");
  await mkdir(runsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  return { baseDir, runsDir, logsDir };
}

export function createRunId(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

export function resolveRunStatePath(runsDir: string, runId: string): string {
  return path.join(runsDir, `${runId}.json`);
}

export async function writeRunState(statePath: string, summary: RunSummary): Promise<void> {
  summary.updatedAt = new Date().toISOString();
  await writeFile(statePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

export async function readRunState(statePath: string): Promise<RunSummary> {
  const raw = await readFile(statePath, "utf8");
  return JSON.parse(raw) as RunSummary;
}

export async function writeChangeLog(
  logsDir: string,
  runId: string,
  changeId: string,
  content: string,
): Promise<string> {
  const runLogDir = path.join(logsDir, runId);
  await mkdir(runLogDir, { recursive: true });
  const safeChange = changeId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const logPath = path.join(runLogDir, `${safeChange}.log`);
  await writeFile(logPath, content, "utf8");
  return logPath;
}
