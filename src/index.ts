import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { AgentStatus, CLEAR_STATUS, itermSessionId, statusSequence, supportsStatus } from "./status";

type Integration = {
  state: AgentStatus;
  refresh: () => void;
};

// Omp reuses this module but rebinds the factory for each descendant session.
// Only an interactive main session owns terminal output. Children contribute
// lifecycle state to that owner and must never clear its status on shutdown.
const bindings = new Map<string, Integration>();

export default function iterm2(pi: ExtensionAPI): void {
  pi.setLabel("iTerm2 agent integration");
  let timer: Timer | undefined;
  let owner: Integration | undefined;

  function update(ctx: ExtensionContext, change: (state: AgentStatus, agentId: string) => void): void {
    const group = bindings.get(ctx.agent.id);
    if (!group) return;
    change(group.state, ctx.agent.id);
    group.refresh();
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.agent.kind === "sub") {
      const parent = ctx.agent.parentId && bindings.get(ctx.agent.parentId);
      if (parent) bindings.set(ctx.agent.id, parent);
      return;
    }
    if (ctx.mode !== "tui" || !supportsStatus(process.env, process.stdout.isTTY === true)) return;
    const state = new AgentStatus();
    let lastSequence: string | undefined;
    const refresh = () => {
      const jobs = ctx.getAsyncJobSnapshot();
      const value = state.snapshot(jobs?.running.length, Boolean(jobs?.delivery.queued || jobs?.delivery.delivering));
      const sequence = statusSequence(value);
      if (sequence === lastSequence) return;
      process.stdout.write(sequence);
      lastSequence = sequence;
    };
    owner = { state, refresh };
    bindings.set(ctx.agent.id, owner);
    const review = ctx.getPendingPlanReview();
    if (review) state.wait(ctx.agent.id, `plan:${review.reviewId}`, "Review the omp plan");
    if (!ctx.isIdle()) state.start(ctx.agent.id);
    refresh();
    // Async jobs can settle between main-agent turns. Sample only their public
    // snapshot; deduplicate output so an idle session emits nothing repeatedly.
    timer = ctx.setInterval(refresh, 1000);
  });

  pi.on("agent_start", (_event, ctx) => update(ctx, (state, id) => state.start(id)));
  pi.on("agent_end", (event, ctx) => update(ctx, (state, id) => state.end(id, event.willContinue)));
  pi.on("tool_execution_start", (event, ctx) => {
    update(ctx, (state, id) => state.toolStart(id, event.toolCallId, event.toolName, event.intent));
  });
  pi.on("tool_execution_end", (event, ctx) => update(ctx, (state, id) => state.toolEnd(id, event.toolCallId)));
  pi.on("tool_approval_requested", (event, ctx) => {
    update(ctx, (state, id) => state.wait(id, `approval:${id}:${event.toolCallId}`, `Approve ${event.toolName}`));
  });
  pi.on("tool_approval_resolved", (event, ctx) => {
    update(ctx, (state, id) => state.resolve(`approval:${id}:${event.toolCallId}`));
  });
  pi.on("plan_review_requested", (event, ctx) => {
    update(ctx, (state, id) => state.wait(id, `plan:${event.reviewId}`, "Review the omp plan"));
  });
  pi.on("plan_review_resolved", (event, ctx) => update(ctx, state => state.resolve(`plan:${event.reviewId}`)));
  pi.on("auto_compaction_start", (_event, ctx) => {
    update(ctx, (state, id) => state.activityStart(id, "compaction", "Compacting context"));
  });
  pi.on("auto_compaction_end", (event, ctx) => {
    update(ctx, (state, id) => {
      state.activityEnd(id, "compaction");
      if (!event.willRetry && ctx.isIdle()) state.end(id);
    });
  });
  pi.on("auto_retry_start", (event, ctx) => {
    update(ctx, (state, id) => state.activityStart(id, "retry", `Retrying (${event.attempt}/${event.maxAttempts})`));
  });
  pi.on("auto_retry_end", (event, ctx) => {
    update(ctx, (state, id) => {
      state.activityEnd(id, "retry");
      if (!event.success) state.end(id);
    });
  });

  function reset(_event: unknown, ctx: ExtensionContext): void {
    if (!owner || ctx.agent.kind !== "main") return;
    for (const [id, group] of bindings) {
      if (group === owner && id !== ctx.agent.id) bindings.delete(id);
    }
    owner.state.reset();
    if (!ctx.isIdle()) owner.state.start(ctx.agent.id);
    owner.refresh();
  }
  pi.on("session_switch", reset);
  pi.on("session_branch", reset);
  pi.on("session_tree", reset);

  pi.on("session_shutdown", (_event, ctx) => {
    const group = bindings.get(ctx.agent.id);
    if (!group) return;
    if (owner === group) {
      if (timer) ctx.clearTimer(timer);
      for (const [id, binding] of bindings) {
        if (binding === owner) bindings.delete(id);
      }
      process.stdout.write(CLEAR_STATUS);
      owner = undefined;
    } else {
      bindings.delete(ctx.agent.id);
      group.state.remove(ctx.agent.id);
      group.refresh();
    }
  });

  pi.registerCommand("iterm2", {
    description: "Show integration status, or add a review Clipping: /iterm2 clip Title | Markdown",
    handler: async (args, ctx) => {
      if (!owner || ctx.agent.kind !== "main") {
        ctx.ui.notify("iTerm2 integration is inactive: use interactive omp directly in iTerm2, outside tmux/screen/Zellij.", "warning");
        return;
      }
      if (!args.trim() || args.trim() === "status") {
        owner.refresh();
        ctx.ui.notify("iTerm2 Session Status is active. Show it with View > Toolbelt > Session Status. Clippings: /iterm2 clip Title | Markdown", "info");
        return;
      }
      const clipping = /^clip\s+([^|]+)\|([\s\S]+)$/.exec(args.trim());
      if (!clipping || !clipping[1].trim() || !clipping[2].trim()) {
        ctx.ui.notify("Usage: /iterm2 [status] or /iterm2 clip Title | Markdown", "warning");
        return;
      }
      const sessionId = itermSessionId(process.env);
      const utility = Bun.which("it2", { PATH: process.env.PATH });
      if (!sessionId || !utility) {
        ctx.ui.notify("Clippings require ITERM_SESSION_ID and iTerm2's it2 utility on PATH. Install iTerm2 Shell Integration and enable its API.", "error");
        return;
      }
      try {
        const result = await pi.exec(utility, [
          "session", "add-clipping", "--session", sessionId, "--", "Code Review Comment", clipping[1].trim(), clipping[2].trim(),
        ], { timeout: 5000 });
        if (result.code !== 0) {
          ctx.ui.notify("iTerm2 rejected the Clipping. Check it2 authentication and the session's API permission.", "error");
          return;
        }
        ctx.ui.notify("Added review Clipping to iTerm2.", "info");
      } catch {
        ctx.ui.notify("Could not reach it2. Check iTerm2 Shell Integration, API permission, and authentication.", "error");
      }
    },
  });
}
