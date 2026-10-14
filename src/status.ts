export type SessionStatus = {
  status: "working" | "waiting" | "idle";
  detail: string;
};

type Tool = { agentId: string; name: string; detail: string };
type Wait = { agentId: string; detail: string };

// Extension factories are rebound to subagents. One state belongs to one
// interactive main session, including its descendants, not to each factory.
export class AgentStatus {
  private readonly active = new Set<string>();
  private readonly tools = new Map<string, Tool>();
  private readonly waits = new Map<string, Wait>();
  private readonly activity = new Map<string, Wait>();

  start(agentId: string): void {
    this.active.add(agentId);
  }

  end(agentId: string, willContinue = false): void {
    if (willContinue) return;
    this.active.delete(agentId);
    this.removeOwned(this.tools, agentId);
    this.removeOwned(this.activity, agentId);
    // A plan review can open as an agent settles; it outlives the agent loop.
    for (const [key, wait] of this.waits) {
      if (wait.agentId === agentId && !key.startsWith("plan:")) this.waits.delete(key);
    }
  }

  toolStart(agentId: string, id: string, name: string, intent?: string): void {
    this.tools.set(`${agentId}:${id}`, { agentId, name, detail: intent || `Running ${name}` });
  }

  toolEnd(agentId: string, id: string): void {
    this.tools.delete(`${agentId}:${id}`);
    this.waits.delete(`approval:${agentId}:${id}`);
  }

  wait(agentId: string, id: string, detail: string): void {
    this.waits.set(id, { agentId, detail });
  }

  resolve(id: string): void {
    this.waits.delete(id);
  }

  activityStart(agentId: string, kind: string, detail: string): void {
    this.activity.set(`${agentId}:${kind}`, { agentId, detail });
  }

  activityEnd(agentId: string, kind: string): void {
    this.activity.delete(`${agentId}:${kind}`);
  }

  remove(agentId: string): void {
    this.end(agentId);
    this.removeOwned(this.waits, agentId);
  }

  reset(): void {
    this.active.clear();
    this.tools.clear();
    this.waits.clear();
    this.activity.clear();
  }

  snapshot(backgroundJobs = 0, pendingDelivery = false): SessionStatus {
    for (const wait of this.waits.values()) return { status: "waiting", detail: wait.detail };
    for (const tool of this.tools.values()) {
      if (tool.name === "ask") return { status: "waiting", detail: "Answer an omp question" };
    }
    for (const activity of this.activity.values()) return { status: "working", detail: activity.detail };
    for (const tool of this.tools.values()) return { status: "working", detail: tool.detail };
    if (this.active.size) return { status: "working", detail: "omp is thinking" };
    if (backgroundJobs) {
      return { status: "working", detail: `${backgroundJobs} background job${backgroundJobs === 1 ? "" : "s"} running` };
    }
    if (pendingDelivery) return { status: "working", detail: "Processing background results" };
    return { status: "idle", detail: "Ready for your next prompt" };
  }

  private removeOwned<T extends { agentId: string }>(entries: Map<string, T>, agentId: string): void {
    for (const [key, value] of entries) {
      if (value.agentId === agentId) entries.delete(key);
    }
  }
}

// OSC fields are delimiter-separated, not shell-quoted. Never let a tool's
// intent inject another field or terminal control sequence.
export function statusDetail(text: string): string {
  return Array.from(text.replace(/[\x00-\x1f\x7f-\x9f;\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim())
    .slice(0, 160).join("");
}

const COLORS = { working: "#ffa500", waiting: "#ffcc00", idle: "#34c759" } as const;

export function statusSequence(value: SessionStatus): string {
  return `\x1b]21337;status=${value.status};indicator=${COLORS[value.status]};status-color=;detail=${statusDetail(value.detail)}\x07`;
}

export const CLEAR_STATUS = "\x1b]21337;status=;indicator=;status-color=;detail=\x07";

export function supportsStatus(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  return isTTY && env.TERM_PROGRAM === "iTerm.app" && !env.TMUX && !env.STY && !env.ZELLIJ;
}

export function itermSessionId(env: NodeJS.ProcessEnv): string | undefined {
  const id = env.ITERM_SESSION_ID?.split(":").at(-1);
  return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
}
