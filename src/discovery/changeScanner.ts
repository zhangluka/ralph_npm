import { readdir } from "node:fs/promises";
import path from "node:path";
import { detectChangeState } from "./changeState.js";
import type { ChangeItem } from "../types.js";
import {
  logInfo,
  logSuccess,
  logWarning,
  logDebug,
} from "../reporting/consoleLogger.js";

const DEFAULT_CANDIDATE_DIRS = ["phspec/changes", "changes"];

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const entries = await readdir(targetPath);
    return entries.length >= 0;
  } catch {
    return false;
  }
}

export async function resolveChangesDir(projectRoot: string, userProvided?: string): Promise<string> {
  if (userProvided) {
    const fullPath = path.resolve(projectRoot, userProvided);
    logInfo(`Using user-provided changes directory: ${fullPath}`);
    return fullPath;
  }

  logInfo(`Searching for changes directory in: ${DEFAULT_CANDIDATE_DIRS.join(", ")}`);

  for (const candidate of DEFAULT_CANDIDATE_DIRS) {
    const fullPath = path.resolve(projectRoot, candidate);
    logInfo(`Checking: ${fullPath}`);
    // eslint-disable-next-line no-await-in-loop
    if (await directoryExists(fullPath)) {
      logSuccess(`Found changes directory: ${fullPath}`);
      return fullPath;
    }
    logInfo(`Not found: ${fullPath}`);
  }

  const fallbackPath = path.resolve(projectRoot, DEFAULT_CANDIDATE_DIRS[0]);
  logWarning(`No changes directory found, using fallback: ${fallbackPath}`);
  return fallbackPath;
}

export async function scanChanges(changesDir: string): Promise<ChangeItem[]> {
  logInfo(`Scanning changes directory: ${changesDir}`);

  const entries = await readdir(changesDir, { withFileTypes: true });
  const changes: ChangeItem[] = [];
  let skipped = 0;

  logInfo(`Found ${entries.length} entries in directory`);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      logDebug(`Skipping non-directory: ${entry.name}`);
      continue;
    }
    if (entry.name.toLowerCase() === "archive") {
      logInfo(`Skipping archive directory: ${entry.name}`);
      skipped++;
      continue;
    }

    const changePath = path.join(changesDir, entry.name);
    logInfo(`Processing change: ${entry.name}`);

    // eslint-disable-next-line no-await-in-loop
    const detected = await detectChangeState(changePath);

    const stateIcon = detected.state === "ready" ? "✓" : "○";
    logInfo(`${stateIcon} ${entry.name}: ${detected.state}${detected.reason ? ` (${detected.reason})` : ""}`);

    changes.push({
      id: entry.name,
      name: entry.name,
      path: changePath,
      tasksPath: detected.tasksPath,
      state: detected.state,
      reason: detected.reason,
    });
  }

  const sortedChanges = changes.sort((a, b) => a.id.localeCompare(b.id));
  const readyCount = sortedChanges.filter((c) => c.state === "ready").length;

  logSuccess(`Scan complete: ${sortedChanges.length} changes found, ${readyCount} ready, ${skipped} skipped`);

  return sortedChanges;
}
