import { access } from "node:fs/promises";
import path from "node:path";
import type { ChangeState } from "../types.js";
import {
  logDebug,
} from "../reporting/consoleLogger.js";

export interface ChangeStateResult {
  state: ChangeState;
  tasksPath: string;
  reason?: string;
}

export async function detectChangeState(changePath: string): Promise<ChangeStateResult> {
  const tasksPath = path.join(changePath, "tasks.md");
  logDebug(`Detecting state for: ${changePath}`);
  logDebug(`Looking for tasks.md at: ${tasksPath}`);

  try {
    await access(tasksPath);
    logDebug(`tasks.md found, change is ready`);
    return { state: "ready", tasksPath };
  } catch {
    const reason = "缺少 tasks.md，尚未进入 apply 阶段";
    logDebug(`tasks.md not found: ${reason}`);
    return {
      state: "not-ready",
      tasksPath,
      reason,
    };
  }
}
