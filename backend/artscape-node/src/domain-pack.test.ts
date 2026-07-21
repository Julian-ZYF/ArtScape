import { describe, expect, it } from 'vitest';
import { compileWorkflowToFSM, validateDomainPackSpec } from '@hypha/domain';
import { artScapeDomainPack } from './domain-pack';

describe('ArtScape DomainPack', () => {
  it('validates all formal tasks, contracts, tools, and workflows', () => {
    expect(validateDomainPackSpec(artScapeDomainPack).id).toBe(
      'domain.artscape.portfolio-sandbox'
    );
    expect(artScapeDomainPack.taskSchemas.map((task) => task.taskType)).toEqual([
      'task.art-portfolio-intake',
      'task.art-scenario-analysis',
      'task.art-candidate-comparison',
      'task.art-report-export',
    ]);
    expect(artScapeDomainPack.outputContracts).toHaveLength(4);
    expect(artScapeDomainPack.tools).toHaveLength(10);
  });

  it('compiles every workflow to a valid FSM', () => {
    for (const workflow of artScapeDomainPack.workflows) {
      const fsm = compileWorkflowToFSM(artScapeDomainPack, { workflowId: workflow.id });
      expect(fsm.id).toContain(workflow.id);
      expect(fsm.states.some((state) => state.id === 'completed')).toBe(true);
      expect(fsm.states.some((state) => state.id === 'failed')).toBe(true);
    }
  });
});
