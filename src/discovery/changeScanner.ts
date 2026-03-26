import { readdir } from "node:fs/promises";
import path from "node:path";
import { detectChangeState } from "./changeState.js";
import type { ChangeItem } from "../types.js";

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
    return path.resolve(projectRoot, userProvided);
  }

  for (const candidate of DEFAULT_CANDIDATE_DIRS) {
    const fullPath = path.resolve(projectRoot, candidate);
    // eslint-disable-next-line no-await-in-loop
    if (await directoryExists(fullPath)) {
      return fullPath;
    }
  }

  return path.resolve(projectRoot, DEFAULT_CANDIDATE_DIRS[0]);
}

export async function scanChanges(changesDir: string): Promise<ChangeItem[]> {
  const entries = await readdir(changesDir, { withFileTypes: true });
  const changes: ChangeItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.toLowerCase() === "archive") {
      continue;
    }

    const changePath = path.join(changesDir, entry.name);
    // eslint-disable-next-line no-await-in-loop
    const detected = await detectChangeState(changePath);

    changes.push({
      id: entry.name,
      name: entry.name,
      path: changePath,
      tasksPath: detected.tasksPath,
      state: detected.state,
      reason: detected.reason,
    });
  }

  return changes.sort((a, b) => a.id.localeCompare(b.id));
}
