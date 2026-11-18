# copilot-pi

Run [GitHub Copilot CLI](https://github.com/github/copilot-cli) as a minimal, [Pi](https://pi.dev)-style coding agent: a short system prompt, a small tool set, parallel tool calls, and no approval prompts.

`copilot-pi` is a separate command. Your normal `copilot` is not changed.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/elemount/copilot-pi/main/install.sh | bash
```

Requires GitHub Copilot CLI (`npm install -g @github/copilot`), signed in. Tested with Copilot CLI 1.0.114 on macOS.

The installer puts:

- the `copilot-pi` command in `~/.local/bin`
- the plugin and system prompt in `~/.copilot/pi-mode`

Run it again to update. If you edited `SYSTEM.md`, your version is kept and the new default is saved as `SYSTEM.default.md`.

## Use

```bash
copilot-pi                       # interactive
copilot-pi -p "fix the failing test"
copilot-pi --model claude-sonnet-4.6
copilot-pi --resume              # resume with pi-mode settings
```

Any `copilot` option works.

## What it changes

| | Copilot CLI | copilot-pi |
|---|---|---|
| System prompt | Long, Copilot-specific | Short `SYSTEM.md` + environment info + `AGENTS.md` |
| Tools | 20+ | `view`, `bash`, `apply_patch` (GPT) or `edit`/`create` (Claude), `web_fetch`, `web_search`, `run_program`, `task`, `read_agent` |
| Tool definitions | ~11k tokens | ~2.8k tokens |
| Parallel tool calls | Prompted | Prompted (the same instruction Pi uses) |
| Approvals | Ask before commands and edits | None (like Pi) |
| Folder trust | Prompt | Trusts the working folder for the run |
| Memory | On | Off |
| Skills | `skill` tool | Pi-style: listed in the prompt, read with `view` |
| MCP | Tools declared up front | Deferred behind tool search; `run_program` for batched calls |

Details:

- **`bash`** is a Pi-style replacement: `command` and optional `timeout`, output truncated to the last 2000 lines or 50KB (full output saved to a temp file), Ctrl+C kills the command's process group.
- **`web_search`** is a one-line wrapper around GitHub MCP's `web_search`.
- **`task`** keeps Copilot's built-in sub-agents, limited to `general-purpose` and `explore`.
- **Skills** are discovered from `.github/skills`, `.claude/skills`, `.agents/skills` (project), `~/.copilot/skills`, `~/.agents/skills`, `skillDirectories` and `COPILOT_SKILLS_DIRS`.
- **MCP** servers come from your normal Copilot MCP config. Turn one on for a run with `--enable-mcp-server <name>`.

## Configure

| Variable | Effect |
|---|---|
| `COPILOT_PI_APPROVAL=manual` | Restore Copilot's approval and folder-trust prompts |
| `COPILOT_PI_HOME` | Plugin location (default `~/.copilot/pi-mode`) |
| `COPILOT_PI_BIN_DIR` | Install location of the command (default `~/.local/bin`) |
| `COPILOT_PI_REF` | Branch or tag the installer downloads (default `main`) |

Edit `~/.copilot/pi-mode/SYSTEM.md` to change the system prompt.

## Limitations

- Relies on experimental Copilot features (extensions, `run_program` feature flags, experimental SDK APIs). A Copilot update can break it; if the plugin fails to load, `copilot-pi` behaves like plain Copilot.
- No approvals and automatic folder trust: a repository's hooks, MCP servers and extensions load without asking, and commands run without confirmation. Use `COPILOT_PI_APPROVAL=manual` or a container for untrusted code.
- `bash` has no background mode, does not use Copilot's command sandbox, and runs with the extension's environment, from which Copilot removes some sensitive variables.
- Copilot features that need removed tools or prompt sections do not work: plan mode, autopilot, `/fleet`, memory, session-history search, workflows, canvases.
- Resume with `copilot-pi --resume`; plain `copilot --resume` does not apply pi-mode.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/elemount/copilot-pi/main/uninstall.sh | bash
```

## License

MIT
