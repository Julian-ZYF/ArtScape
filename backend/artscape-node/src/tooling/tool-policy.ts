import type { PolicyDecision, PolicyEngine, PolicyEvaluationContext } from '@hypha/core';

export const ARTSCAPE_POLICY_IDS = {
  governed: 'policy.artscape.governed-tools',
  denied: 'policy.artscape.denied',
} as const;

export function evaluateArtScapeToolPolicy(
  context: PolicyEvaluationContext
): PolicyDecision {
  if (context.sideEffectLevel === 'external_effect' || context.sideEffectLevel === 'irreversible') {
    return {
      allowed: false,
      policyId: ARTSCAPE_POLICY_IDS.denied,
      reason: 'ArtScape MVP denies external and irreversible effects.',
    };
  }
  if (context.sideEffectLevel === 'none' || context.sideEffectLevel === 'read') {
    return {
      allowed: true,
      policyId: ARTSCAPE_POLICY_IDS.governed,
      ruleId: 'allow-deterministic-read',
    };
  }
  if (context.sideEffectLevel === 'write') {
    return {
      allowed: true,
      policyId: ARTSCAPE_POLICY_IDS.governed,
      ruleId: 'allow-audited-write',
    };
  }
  return {
    allowed: false,
    policyId: ARTSCAPE_POLICY_IDS.denied,
    reason: 'Unsupported side-effect level.',
  };
}

export function createArtScapeToolPolicyEngine(): PolicyEngine {
  return {
    async evaluate(context) {
      return evaluateArtScapeToolPolicy(context);
    },
  };
}

