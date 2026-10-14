import { describe, expect, test } from "bun:test";
import { AgentStatus, itermSessionId, statusDetail, statusSequence, supportsStatus } from "../src/status";

describe("agent status", () => {
  test("an ask stays waiting while a parallel tool completes", () => {
    const state = new AgentStatus();
    state.start("Main");
    state.toolStart("Main", "question", "ask");
    state.toolStart("Main", "read", "read");
    state.toolEnd("Main", "read");
    expect(state.snapshot().status).toBe("waiting");
    state.toolEnd("Main", "question");
    expect(state.snapshot().status).toBe("working");
    state.end("Main");
    expect(state.snapshot().status).toBe("idle");
  });

  test("approval waits are independent and dominate work and background jobs", () => {
    const state = new AgentStatus();
    state.start("Main");
    state.wait("Main", "approval:Main:a", "Approve a");
    state.wait("Main", "approval:Main:b", "Approve b");
    state.resolve("approval:Main:a");
    expect(state.snapshot(2).status).toBe("waiting");
    state.resolve("approval:Main:b");
    expect(state.snapshot(2).status).toBe("working");
  });

  test("a plan review survives agent-end until it is answered", () => {
    const state = new AgentStatus();
    state.start("Main");
    state.wait("Main", "plan:review", "Review plan");
    state.end("Main");
    expect(state.snapshot().status).toBe("waiting");
    state.resolve("plan:review");
    expect(state.snapshot().status).toBe("idle");
  });

  test("a continuing agent-end never reports idle between retries", () => {
    const state = new AgentStatus();
    state.start("Main");
    state.end("Main", true);
    expect(state.snapshot().status).toBe("working");
    state.activityStart("Main", "retry", "Retrying");
    state.activityEnd("Main", "retry");
    expect(state.snapshot().status).toBe("working");
    state.end("Main");
    expect(state.snapshot().status).toBe("idle");
  });

  test("completion waits for background work and its result delivery", () => {
    const state = new AgentStatus();
    state.start("Main");
    state.end("Main");
    expect(state.snapshot(1).status).toBe("working");
    expect(state.snapshot(0, true).status).toBe("working");
    expect(state.snapshot(0, false).status).toBe("idle");
  });

  test("descendant shutdown removes only its own activity and waits", () => {
    const state = new AgentStatus();
    state.start("Main");
    state.start("Child");
    state.toolStart("Child", "same-id", "ask");
    state.toolStart("Main", "same-id", "read");
    expect(state.snapshot().status).toBe("waiting");
    state.remove("Child");
    expect(state.snapshot().status).toBe("working");
    state.toolEnd("Main", "same-id");
    state.end("Main");
    expect(state.snapshot().status).toBe("idle");
  });

  test("reset clears stale waits and compaction across session switches", () => {
    const state = new AgentStatus();
    state.start("Main");
    state.wait("Main", "plan:old", "Review");
    state.activityStart("Main", "compaction", "Compacting");
    state.toolStart("Child", "ask", "ask");
    state.reset();
    expect(state.snapshot().status).toBe("idle");
    state.start("Main");
    expect(state.snapshot().status).toBe("working");
  });
});

describe("terminal boundary", () => {
  test("untrusted detail cannot inject OSC fields or terminal controls", () => {
    const detail = "read;status=idle\x07\x1b]9;surprise\x1b\\\n\x9c";
    const sequence = statusSequence({ status: "working", detail });
    expect(sequence.split(";status=")).toHaveLength(2);
    expect(sequence.match(/\x07/g)).toHaveLength(1);
    expect(sequence.match(/\x1b/g)).toHaveLength(1);
    expect(statusDetail(detail)).not.toMatch(/[\x00-\x1f\x7f-\x9f;]/);
    expect(Array.from(statusDetail("🦉".repeat(200)))).toHaveLength(160);
  });

  test("only direct iTerm TTY sessions are eligible", () => {
    const env = { TERM_PROGRAM: "iTerm.app" };
    expect(supportsStatus(env, true)).toBe(true);
    expect(supportsStatus(env, false)).toBe(false);
    expect(supportsStatus({ TERM_PROGRAM: "xterm" }, true)).toBe(false);
    for (const key of ["TMUX", "STY", "ZELLIJ"]) {
      expect(supportsStatus({ ...env, [key]: "session" }, true)).toBe(false);
    }
  });

  test("Clippings use the originating UUID, never an active-session fallback", () => {
    const id = "94823DE6-B005-491D-8A73-8B262FDF7C0A";
    expect(itermSessionId({ ITERM_SESSION_ID: `w0t2p0:${id}` })).toBe(id);
    expect(itermSessionId({ ITERM_SESSION_ID: id })).toBe(id);
    expect(itermSessionId({})).toBeUndefined();
    expect(itermSessionId({ ITERM_SESSION_ID: "--all" })).toBeUndefined();
  });
});
