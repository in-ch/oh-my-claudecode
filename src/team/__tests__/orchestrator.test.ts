import { describe, expect, it } from 'vitest';
import {
  canResumeTeamState,
  createTeamState,
  getPhaseAgents,
  getPhaseInstructions,
  isTerminalPhase,
  isValidTransition,
  transitionPhase,
} from '../orchestrator.js';

describe('team orchestrator OMX parity state machine', () => {
  it('creates resumable team-plan state', () => {
    const state = createTeamState('ship feature');
    expect(state.active).toBe(true);
    expect(state.phase).toBe('team-plan');
    expect(canResumeTeamState(state)).toBe(true);
  });

  it('enforces canonical staged transitions', () => {
    expect(isValidTransition('team-plan', 'team-prd')).toBe(true);
    expect(isValidTransition('team-plan', 'team-exec')).toBe(false);
    expect(isValidTransition('team-verify', 'team-fix')).toBe(true);
    expect(isValidTransition('team-verify', 'complete')).toBe(true);
  });

  it('marks terminal phases inactive', () => {
    const planned = createTeamState('demo');
    const prd = transitionPhase(planned, 'team-prd', 'plan done');
    const exec = transitionPhase(prd, 'team-exec');
    const verify = transitionPhase(exec, 'team-verify');
    const complete = transitionPhase(verify, 'complete', 'verified');

    expect(isTerminalPhase(complete.phase)).toBe(true);
    expect(complete.active).toBe(false);
    expect(canResumeTeamState(complete)).toBe(false);
    expect(complete.phase_transitions.at(-1)?.reason).toBe('verified');
  });

  it('fails when the fix loop exceeds the configured max attempts', () => {
    let state = createTeamState('demo', 1);
    state = transitionPhase(state, 'team-prd');
    state = transitionPhase(state, 'team-exec');
    state = transitionPhase(state, 'team-verify');
    state = transitionPhase(state, 'team-fix');
    state = transitionPhase(state, 'team-verify');
    const failed = transitionPhase(state, 'team-fix');

    expect(failed.phase).toBe('failed');
    expect(failed.active).toBe(false);
    expect(failed.phase_transitions.at(-1)?.reason).toMatch(/team-fix loop limit reached/);
  });

  it('returns phase role and instruction hints', () => {
    expect(getPhaseAgents('team-exec')).toContain('executor');
    expect(getPhaseInstructions('team-verify')).toMatch(/Verification/);
  });
});
