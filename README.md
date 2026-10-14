# omp-iterm2

An Oh My Pi extension for native iTerm2 agent status and review Clippings. No tmux, custom omp build, Python daemon, or fork commands.

## Requirements

- Interactive omp directly in iTerm2.
- omp 18.10.4 or newer within the 18.x series; tested with 18.10.4.
- iTerm2 3.7.4 or newer; tested with 3.7.4.
- For Clippings only: iTerm2's `it2` utility on `PATH`, with API access allowed. iTerm2's Shell Integration installs the utility. Status reporting does not require API access.

## Install from a checkout

From this repository:

```sh
omp plugin link "$PWD"
```

The extension loads automatically in new omp sessions in the selected profile. Restart an existing session with `/restart` to load it. There is no build step and no need to run `bun install` just to use the extension.

For a single session without installing:

```sh
omp --extension /absolute/path/to/omp-iterm2
```

Show the sidebar through **View > Toolbelt > Show Toolbelt**, then **View > Toolbelt > Session Status**. iTerm2's Cockpit and notify-on-status-change features also consume these statuses. The extension does not change iTerm2 preferences, profiles, titles, or keyboard shortcuts.

## Session Status

| Status | Meaning |
| --- | --- |
| `working` | The main agent or a descendant is running, automatic retry/compaction is active, or background work/results remain pending. |
| `waiting` | A question, tool approval, or plan review needs an answer. Waiting takes precedence over concurrent work. |
| `idle` | The conversation has settled and no tracked background work remains. |

Detail text reports tool intent, approvals, or background activity. It does not copy prompts, assistant responses, tool arguments, or tool results into the sidebar. Tool intent itself can contain task-specific information; iTerm2 may display it in the Cockpit as well as the sidebar. Detail text is limited to 160 Unicode code points and sanitized against terminal-control and OSC-field injection.

Descendant agents contribute to their interactive main session; their shutdown cannot clear the parent's status. Session switches discard old activity, and graceful shutdown clears all four status fields. Hard kills cannot run shutdown cleanup.

Non-iTerm terminals, print/RPC/headless sessions, and sessions inside tmux, screen, or Zellij are left untouched. Manual `/compact` is not separately tracked: omp's extension API does not provide a paired completion/cancellation event for that operation. Automatic compaction is tracked through its paired lifecycle events.

Status is sent directly to the owning terminal using [OSC 21337](https://iterm2.com/documentation-session-status.html). Background-job snapshots are sampled once per second; unchanged status is not re-emitted. No prompts or model calls are added.

## Commands

Check that the integration is active:

```text
/iterm2
/iterm2 status
```

Add a review note to iTerm2's native Clippings panel:

```text
/iterm2 clip Missing timeout | `fetchAccount()` needs a bounded timeout before retrying.
```

The first `|` separates the title from the Markdown body. The body can contain further pipes and newlines. The command targets the terminal identified by `ITERM_SESSION_ID`, not the currently focused tab. It passes literal arguments to `it2`, without shell evaluation.

Every session in an iTerm2 Workgroup shares its leader's Clippings panel. Use its Send or Copy controls to hand review notes back to the coding session. This extension does not automatically start reviews or submit Clippings as prompts.

## Optional Workgroup

In **Settings > Arrangements > Workgroups**, use **Add Preset > Coding Agent + Diff**. Enter it from **Shell > Workgroups** while omp is running. Your main session remains omp; the Diff peer and native toolbar are managed by iTerm2.

You can add a Code Review peer using iTerm2's normal Workgroup settings and run another omp session there. `/iterm2 clip` adds that session's review notes to the shared panel. Workgroup configuration is optional and is not installed or overwritten by this package.

See the official [Workgroups](https://iterm2.com/documentation-workgroups.html), [Clippings](https://iterm2.com/documentation-clippings.html), and [`it2` utility](https://iterm2.com/documentation-utilities.html) documentation.

## Remove

```sh
omp plugin uninstall omp-iterm2
```

Restart already-running omp sessions after removing the plugin. No iTerm2 preferences or background services need to be removed.

## Development and verification

```sh
bun install
bun run check
bun test
```

Regression tests cover concurrent waits, retry continuation, background delivery, descendant cleanup, session reset, terminal eligibility, originating-session identity, and OSC injection prevention.

The installed omp CLI was exercised in an isolated real iTerm2 tab using a temporary keyless provider: question answer, approval denial/approval, background completion, Clipping submission (including literal option-like text and Markdown), and restart cleanup. The probe observed the actual omp dialogs and status sequences forwarded to the terminal. The temporary provider is not part of this package.

Desktop screenshot verification was unavailable on the implementation machine: screen capture failed and Accessibility access was denied. Sidebar colors/layout were not visually verified.
