import type { ChangeItem } from "../types.js";

export async function buildApplyPrompt(change: ChangeItem): Promise<string> {
  // 使用 slash command 调用 phspec 的 apply
  // 让 agent 按照 phspec 的工作流自动工作
  const prompt = `/phspec-apply ${change.id}`;

  return prompt;
}
