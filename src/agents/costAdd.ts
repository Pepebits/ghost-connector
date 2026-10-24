import type { CostAgent, RunArtifact } from '../types.js';
import type { AgentUsage } from './runner.js';

/** Adds one more agent call to a plan's cost (answering pending items, "Fix with AI"...). */
export function addUsage(cost: RunArtifact['cost'], usage: AgentUsage, agent: CostAgent): RunArtifact['cost'] {
  const unpriced = new Set(cost.unpricedModels ?? []);
  if (usage.usd === null) unpriced.add(usage.model);
  const byAgent = { ...(cost.byAgent ?? {}) };
  if (usage.usd !== null) byAgent[agent] = (byAgent[agent] ?? 0) + usage.usd;
  return {
    inputTokens: cost.inputTokens + usage.inputTokens,
    outputTokens: cost.outputTokens + usage.outputTokens,
    usd: cost.usd + (usage.usd ?? 0),
    ...(unpriced.size ? { unpricedModels: [...unpriced] } : {}),
    byAgent,
  };
}
