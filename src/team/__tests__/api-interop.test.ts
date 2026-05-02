import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_TEAM_MCP_TOOLS,
  TEAM_API_OPERATIONS,
  buildLegacyTeamDeprecationHint,
  executeTeamApiOperation,
  resolveTeamApiOperation,
} from '../api-interop.js';
import { createTask, initTeamState } from '../state.js';
import type { TeamConfig } from '../types.js';

function teamConfig(name: string, cwd: string): TeamConfig {
  return {
    name,
    task: 'api interop contract',
    agent_type: 'executor',
    worker_launch_mode: 'interactive',
    worker_count: 2,
    max_workers: 20,
    workers: [1, 2].map((index) => ({
      name: `worker-${index}`,
      index,
      role: 'executor',
      assigned_tasks: [],
      pane_id: `%${index + 1}`,
      working_dir: cwd,
    })),
    created_at: new Date().toISOString(),
    tmux_session: `${name}:0`,
    next_task_id: 1,
    leader_cwd: cwd,
    team_state_root: join(cwd, '.omc', 'state', 'team', name),
    workspace_mode: 'single',
    worktree_mode: 'disabled',
    leader_pane_id: '%1',
    hud_pane_id: null,
    resize_hook_name: null,
    resize_hook_target: null,
  };
}

describe('team api interop', () => {
  it('normalizes canonical, legacy, casing, and whitespace operation names', () => {
    expect(resolveTeamApiOperation('send-message')).toBe('send-message');
    expect(resolveTeamApiOperation('team_send_message')).toBe('send-message');
    expect(resolveTeamApiOperation('claim_task')).toBe('claim-task');
    expect(resolveTeamApiOperation('  SEND_MESSAGE  ')).toBe('send-message');
    expect(resolveTeamApiOperation('nonexistent-op')).toBeNull();

    for (const op of TEAM_API_OPERATIONS) {
      expect(resolveTeamApiOperation(op)).toBe(op);
      expect(op).not.toMatch(/_/);
    }
    expect(LEGACY_TEAM_MCP_TOOLS.every((name) => name.startsWith('team_'))).toBe(true);
  });

  it('builds CLI migration hints for legacy MCP tool names', () => {
    const hint = buildLegacyTeamDeprecationHint('team_send_message', { team_name: 'alpha' });
    expect(hint).toMatch(/omc team api send-message/);
    expect(hint).toMatch(/"team_name":"alpha"/);
    expect(buildLegacyTeamDeprecationHint('team_nonexistent')).toMatch(/omc team api <operation>/);
  });

  it('executes core state operations through the canonical API gateway', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'omc-api-interop-'));
    try {
      await initTeamState(teamConfig('api-team', cwd), cwd);
      const task = await createTask('api-team', { subject: 'api task', description: 'd', status: 'pending' }, cwd);

      const list = await executeTeamApiOperation('list-tasks', { team_name: 'api-team' }, cwd);
      expect(list.ok).toBe(true);
      expect(list.ok ? list.data.tasks : []).toEqual(expect.arrayContaining([expect.objectContaining({ id: task.id })]));

      const claim = await executeTeamApiOperation(resolveTeamApiOperation('team_claim_task')!, {
        team_name: 'api-team',
        task_id: task.id,
        worker: 'worker-1',
        expected_version: task.version ?? 1,
      }, cwd);
      expect(claim.ok).toBe(true);

      const mailbox = await executeTeamApiOperation('send-message', {
        team_name: 'api-team',
        from_worker: 'worker-1',
        to_worker: 'worker-2',
        body: 'hello',
      }, cwd);
      expect(mailbox.ok).toBe(true);

      const invalid = await executeTeamApiOperation('list-tasks', { team_name: '---' }, cwd);
      expect(invalid.ok).toBe(false);
      expect(invalid.ok ? '' : invalid.error.code).toBe('operation_failed');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
