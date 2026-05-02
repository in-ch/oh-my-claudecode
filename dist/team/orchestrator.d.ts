/**
 * Team Orchestration for oh-my-codex
 *
 * Leverages Codex CLI's native multi_agent feature for multi-agent coordination.
 * Provides the staged pipeline: plan -> prd -> exec -> verify -> fix (loop)
 */
export type TeamPhase = 'team-plan' | 'team-prd' | 'team-exec' | 'team-verify' | 'team-fix';
export type TerminalPhase = 'complete' | 'failed' | 'cancelled';
import type { TeamTask } from './state.js';
export interface TeamState {
    active: boolean;
    phase: TeamPhase | TerminalPhase;
    task_description: string;
    created_at: string;
    phase_transitions: Array<{
        from: string;
        to: string;
        at: string;
        reason?: string;
    }>;
    tasks: TeamTask[];
    max_fix_attempts: number;
    current_fix_attempt: number;
}
/**
 * Validate a phase transition
 */
export declare function isValidTransition(from: TeamPhase, to: TeamPhase | TerminalPhase): boolean;
export declare function isTerminalPhase(phase: TeamPhase | TerminalPhase): phase is TerminalPhase;
export declare function canResumeTeamState(state: TeamState): boolean;
/**
 * Create initial team state
 */
export declare function createTeamState(taskDescription: string, maxFixAttempts?: number): TeamState;
/**
 * Transition to next phase
 */
export declare function transitionPhase(state: TeamState, to: TeamPhase | TerminalPhase, reason?: string): TeamState;
/**
 * Get agent roles recommended for each phase
 */
export declare function getPhaseAgents(phase: TeamPhase): string[];
/**
 * Generate phase instructions for AGENTS.md context
 */
export declare function getPhaseInstructions(phase: TeamPhase): string;
//# sourceMappingURL=orchestrator.d.ts.map