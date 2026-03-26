import { access } from "node:fs/promises";
import path from "node:path";
import type { ChangeState } from "../types.js";

export interface ChangeStateResult {
  state: ChangeState;
  tasksPath: string;
  reason?: string;
}

export async function detectChangeState(changePath: string): Promise<ChangeStateResult> {
  const tasksPath = path.join(changePath, "tasks.md");
  try {
    await access(tasksPath);
    return { state: "ready", tasksPath };
  } catch {
    return {
      state: "not-ready",
      tasksPath,
      reason: "缺少 tasks.md，尚未进入 apply 阶段",
    };
  }
}
