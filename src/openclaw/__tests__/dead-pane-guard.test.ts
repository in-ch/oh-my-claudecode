/**
 * Regression tests for issue #2562: dead tmux sessions must not emit
 * pane-derived keyword/stale alerts after cleanup.
 *
 * When `isPaneAlive(paneId)` returns false (pane_dead=1 or session gone),
 * wakeOpenClaw must skip capturePaneContent entirely so stale scrollback
 * from a cleaned-up session never reaches the OpenClaw gateway as tmuxTail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mocks for functions that will be called via dynamic import inside wakeOpenClaw.
const mockIsPaneAlive = vi.fn<(paneId: string) => boolean>();
const mockCapturePaneContent = vi.fn<(paneId: string, lines?: number) => string>();

vi.mock("../../features/rate-limit-wait/tmux-detector.js", () => ({
  isPaneAlive: (paneId: string) => mockIsPaneAlive(paneId),
  capturePaneContent: (paneId: string, lines?: number) => mockCapturePaneContent(paneId, lines),
}));

vi.mock("../../notifications/tmux.js", () => ({
  getCurrentTmuxSession: () => "test-session",
}));

vi.mock("../config.js", () => ({
  getOpenClawConfig: vi.fn(),
  resolveGateway: vi.fn(),
  resetOpenClawConfigCache: vi.fn(),
}));

vi.mock("../dispatcher.js", () => ({
  wakeGateway: vi.fn().mockResolvedValue({ success: true }),
  wakeCommandGateway: vi.fn().mockResolvedValue({ success: true }),
  isCommandGateway: vi.fn(() => false),
  shellEscapeArg: vi.fn((v: string) => v),
  interpolateInstruction: vi.fn((t: string) => t),
}));

vi.mock("../dedupe.js", () => ({
  shouldCollapseOpenClawBurst: vi.fn(() => false),
}));

vi.mock("../signal.js", () => ({
  buildOpenClawSignal: vi.fn(() => ({
    kind: "lifecycle",
    name: "stop",
    phase: "idle",
    priority: "normal",
    routeKey: "session.stopped",
    summary: "Session stopped",
  })),
}));

import { wakeOpenClaw } from "../index.js";
import { getOpenClawConfig, resolveGateway } from "../config.js";
import { wakeGateway } from "../dispatcher.js";
import type { OpenClawConfig } from "../types.js";

const TEST_CONFIG: OpenClawConfig = {
  enabled: true,
  gateways: {
    "test-gw": { url: "https://example.com/hook", method: "POST" },
  },
  hooks: {
    stop: { gateway: "test-gw", instruction: "Stopped: {{tmuxTail}}", enabled: true },
    "session-end": { gateway: "test-gw", instruction: "Ended: {{tmuxTail}}", enabled: true },
    "session-start": { gateway: "test-gw", instruction: "Started", enabled: true },
  },
};

const RESOLVED_GW = {
  gatewayName: "test-gw",
  gateway: { url: "https://example.com/hook", method: "POST" as const },
  instruction: "Stopped: {{tmuxTail}}",
};

describe("dead-pane guard in wakeOpenClaw (issue #2562)", () => {
  let origTmux: string | undefined;
  let origTmuxPane: string | undefined;

  beforeEach(() => {
    origTmux = process.env.TMUX;
    origTmuxPane = process.env.TMUX_PANE;
    process.env.TMUX = "/tmp/tmux-1000/default,12345,0";
    process.env.TMUX_PANE = "%42";

    vi.mocked(getOpenClawConfig).mockReturnValue(TEST_CONFIG);
    vi.mocked(resolveGateway).mockReturnValue(RESOLVED_GW);
    mockIsPaneAlive.mockReset();
    mockCapturePaneContent.mockReset();
    vi.mocked(wakeGateway).mockReset();
    vi.mocked(wakeGateway).mockResolvedValue({ gateway: "test-gw", success: true });
  });

  afterEach(() => {
    if (origTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = origTmux;
    if (origTmuxPane === undefined) delete process.env.TMUX_PANE;
    else process.env.TMUX_PANE = origTmuxPane;
    vi.clearAllMocks();
  });

  it("skips capture when pane is dead — no stale tmuxTail in payload", async () => {
    mockIsPaneAlive.mockReturnValue(false);

    await wakeOpenClaw("stop", {
      sessionId: "sid-dead",
      projectPath: "/home/user/project",
    });

    expect(mockIsPaneAlive).toHaveBeenCalledWith("%42");
    expect(mockCapturePaneContent).not.toHaveBeenCalled();
    const [, , payload] = vi.mocked(wakeGateway).mock.calls[0] as [string, unknown, { tmuxTail?: string }];
    expect(payload.tmuxTail).toBeUndefined();
  });

  it("captures content when pane is alive — tmuxTail forwarded to gateway", async () => {
    mockIsPaneAlive.mockReturnValue(true);
    mockCapturePaneContent.mockReturnValue("live output line");

    await wakeOpenClaw("stop", {
      sessionId: "sid-alive",
      projectPath: "/home/user/project",
    });

    expect(mockIsPaneAlive).toHaveBeenCalledWith("%42");
    expect(mockCapturePaneContent).toHaveBeenCalledWith("%42", 15);
    const [, , payload] = vi.mocked(wakeGateway).mock.calls[0] as [string, unknown, { tmuxTail?: string }];
    expect(payload.tmuxTail).toBe("live output line");
  });

  it("skips capture for session-end when pane is dead", async () => {
    mockIsPaneAlive.mockReturnValue(false);
    vi.mocked(resolveGateway).mockReturnValue({ ...RESOLVED_GW, instruction: "Ended: {{tmuxTail}}" });

    await wakeOpenClaw("session-end", {
      sessionId: "sid-end-dead",
      projectPath: "/home/user/project",
    });

    expect(mockIsPaneAlive).toHaveBeenCalledWith("%42");
    expect(mockCapturePaneContent).not.toHaveBeenCalled();
  });

  it("does not call isPaneAlive for session-start (non-stop event)", async () => {
    vi.mocked(resolveGateway).mockReturnValue({ ...RESOLVED_GW, instruction: "Started" });

    await wakeOpenClaw("session-start", {
      sessionId: "sid-start",
      projectPath: "/home/user/project",
    });

    expect(mockIsPaneAlive).not.toHaveBeenCalled();
    expect(mockCapturePaneContent).not.toHaveBeenCalled();
  });

  it("does not call isPaneAlive when TMUX env is absent", async () => {
    delete process.env.TMUX;
    mockIsPaneAlive.mockReturnValue(true);

    await wakeOpenClaw("stop", {
      sessionId: "sid-no-tmux",
      projectPath: "/home/user/project",
    });

    expect(mockIsPaneAlive).not.toHaveBeenCalled();
    expect(mockCapturePaneContent).not.toHaveBeenCalled();
  });

  it("does not call isPaneAlive when TMUX_PANE env is absent", async () => {
    delete process.env.TMUX_PANE;
    mockIsPaneAlive.mockReturnValue(true);

    await wakeOpenClaw("stop", {
      sessionId: "sid-no-pane-id",
      projectPath: "/home/user/project",
    });

    expect(mockIsPaneAlive).not.toHaveBeenCalled();
    expect(mockCapturePaneContent).not.toHaveBeenCalled();
  });

  it("uses caller-provided tmuxTail and skips isPaneAlive entirely", async () => {
    mockIsPaneAlive.mockReturnValue(true);

    await wakeOpenClaw("stop", {
      sessionId: "sid-prefilled",
      projectPath: "/home/user/project",
      tmuxTail: "pre-captured content",
    });

    expect(mockIsPaneAlive).not.toHaveBeenCalled();
    expect(mockCapturePaneContent).not.toHaveBeenCalled();
    const [, , payload] = vi.mocked(wakeGateway).mock.calls[0] as [string, unknown, { tmuxTail?: string }];
    expect(payload.tmuxTail).toBe("pre-captured content");
  });
});
