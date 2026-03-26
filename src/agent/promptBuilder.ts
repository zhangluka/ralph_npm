import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ChangeItem } from "../types.js";

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function buildApplyPrompt(change: ChangeItem): Promise<string> {
  const tasksContent = await readFile(change.tasksPath, "utf8");
  const proposalPath = path.join(change.path, "proposal.md");
  const designPath = path.join(change.path, "design.md");
  const proposal = await readIfExists(proposalPath);
  const design = await readIfExists(designPath);

  const sections = [
    "你是项目中的编码 Agent。请严格按照以下 change 的 tasks 执行实现。",
    `Change: ${change.id}`,
    `ChangePath: ${change.path}`,
    "",
    "执行要求：",
    "1) 仅实现该 change 任务，不做无关重构。",
    "2) 优先完成 tasks.md 中未完成项。",
    "3) 实现后运行必要验证并修复明显错误。",
    "4) 最终输出以下结构：",
    "   - COMPLETED: ...",
    "   - PENDING: ...",
    "   - BLOCKERS: ...",
    "",
    "tasks.md:",
    tasksContent.trim(),
  ];

  if (proposal?.trim()) {
    sections.push("", "proposal.md:", proposal.trim());
  }
  if (design?.trim()) {
    sections.push("", "design.md:", design.trim());
  }

  return `${sections.join("\n")}\n`;
}
