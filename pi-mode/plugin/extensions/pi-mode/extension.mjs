import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { joinSession } from "@microsoft/copilot-sdk/extension";

const home = homedir();
const promptPath = new URL("../../../SYSTEM.md", import.meta.url);
const basePrompt = readFileSync(promptPath, "utf8").trim();
const cwd = resolve(process.env.COPILOT_SESSION_CWD || process.cwd());

function expandHome(path) {
  return path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

function readSettings() {
  try {
    return JSON.parse(readFileSync(join(process.env.COPILOT_HOME || join(home, ".copilot"), "settings.json"), "utf8"));
  } catch {
    return {};
  }
}

function projectRoots(start) {
  const roots = [];
  let dir = start;
  while (true) {
    roots.push(dir);
    if (existsSync(join(dir, ".git"))) break;
    const parent = dirname(dir);
    if (parent === dir) return [start];
    dir = parent;
  }
  return roots;
}

function skillDirectories(settings) {
  const dirs = [];
  for (const root of projectRoots(cwd)) {
    dirs.push(join(root, ".github/skills"), join(root, ".claude/skills"), join(root, ".agents/skills"));
  }

  const configured = [
    ...(Array.isArray(settings.skillDirectories) ? settings.skillDirectories : []),
    ...(process.env.COPILOT_SKILLS_DIRS || "").split(","),
  ].map((dir) => dir.trim()).filter(Boolean);

  dirs.push(...configured.map((dir) => resolve(cwd, expandHome(dir))));
  dirs.push(join(home, ".copilot/skills"), join(home, ".agents/skills"));
  return [...new Set(dirs)];
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;

  const lines = match[1].split(/\r?\n/);
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const field = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;

    const [, key, raw] = field;
    if (raw === ">" || raw === "|" || raw === ">-" || raw === "|-") {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === "")) {
        block.push(lines[++i].trim());
      }
      data[key] = raw.startsWith(">") ? block.filter(Boolean).join(" ") : block.join("\n");
    } else {
      data[key] = unquote(raw);
    }
  }
  return data;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function discoverSkills() {
  const settings = readSettings();
  const disabled = new Set((settings.disabledSkills || []).map((name) => String(name).toLowerCase()));
  const skills = [];
  const seen = new Set();

  for (const dir of skillDirectories(settings)) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const location = join(dir, entry.name, "SKILL.md");
      try {
        if (!statSync(location).isFile()) continue;
        const metadata = parseFrontmatter(readFileSync(location, "utf8"));
        const name = metadata?.name || entry.name;
        const key = name.toLowerCase();
        if (!metadata?.description || seen.has(key) || disabled.has(key)) continue;
        if (String(metadata["disable-model-invocation"]).toLowerCase() === "true") continue;

        seen.add(key);
        skills.push({ name, description: metadata.description, location });
      } catch {
        // Skip unreadable or malformed skills; Copilot's normal skill loader still reports those in /skills.
      }
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function buildPrompt() {
  const skills = discoverSkills();
  if (skills.length === 0) return basePrompt;

  const list = skills.map((skill) => `  <skill>
    <name>${escapeXml(skill.name)}</name>
    <description>${escapeXml(skill.description)}</description>
    <location>${escapeXml(skill.location)}</location>
  </skill>`).join("\n");

  return `${basePrompt}

<skills>
The following skills provide specialized instructions for specific tasks.
When a task matches a skill description, use view to read that skill's SKILL.md before acting.
Resolve relative paths against the skill's directory (the parent of SKILL.md). Use absolute paths in tool calls.

<available_skills>
${list}
</available_skills>
</skills>`;
}

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;
const skipPermission = process.env.COPILOT_PI_APPROVAL !== "manual";
let session;

// Keep the tail of long output, like Pi; save the full text to a temp file.
function truncateOutput(text) {
  const lines = text.split("\n");
  let tail = lines.slice(-MAX_LINES).join("\n");
  if (Buffer.byteLength(tail) > MAX_BYTES) tail = Buffer.from(tail).subarray(-MAX_BYTES).toString("utf8");
  if (tail.length === text.length) return text;
  const file = join(mkdtempSync(join(tmpdir(), "copilot-pi-bash-")), "output.log");
  writeFileSync(file, text);
  return `[Output truncated to the last ${MAX_LINES} lines or ${MAX_BYTES / 1024}KB. Full output: ${file}]\n${tail}`;
}

function runBash(command, timeoutSeconds, signal) {
  return new Promise((resolvePromise) => {
    const child = spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    let aborted = false;
    const killGroup = () => {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    };
    const onAbort = () => {
      aborted = true;
      killGroup();
    };
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    const timer = timeoutSeconds > 0 ? setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutSeconds * 1000) : undefined;
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (result) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(result);
    };
    child.on("error", (error) => finish(`Failed to start bash: ${error.message}`));
    child.on("close", (code, sig) => {
      let result = truncateOutput(output);
      if (aborted) result += "\n\nCommand aborted";
      else if (timedOut) result += `\n\nCommand timed out after ${timeoutSeconds} seconds`;
      else if (code !== 0) result += `\n\nCommand exited with code ${code ?? sig}`;
      finish(result || "(no output)");
    });
  });
}

function mcpText(result) {
  if (!result) return "(no result)";
  const text = (result.content || []).map((part) => part.text ?? JSON.stringify(part)).join("\n");
  return result.isError ? `Error: ${text}` : text;
}

// Pi-sized replacements for Copilot's verbose bash and GitHub MCP web_search definitions.
const compactTools = [
  {
    name: "bash",
    overridesBuiltInTool: true,
    skipPermission,
    defer: "never",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to the last ${MAX_LINES} lines or ${MAX_BYTES / 1024}KB. Optionally provide a timeout in seconds.`,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command to execute" },
        timeout: { type: "number", description: "Timeout in seconds (optional)" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    handler: async ({ command, timeout }, invocation) => runBash(command, timeout, invocation?.signal),
  },
  {
    name: "web_search",
    skipPermission,
    defer: "never",
    description: "Search the public web and return an answer with source citations.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A specific, standalone natural-language question." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async ({ query }) => mcpText(await session.rpc.mcp.callTool({
      serverName: "github-mcp-server",
      toolName: "web_search",
      arguments: { query },
    })),
  },
];

session = await joinSession({
  // Keep only the general-purpose and explore sub-agents to shorten the task tool definition.
  agents: { includedBuiltinAgents: ["general-purpose", "explore"] },
  // Pi has no cross-session memory context; avoid Copilot's injected <memories> message.
  state: { memory: { enabled: false } },
  systemMessage: {
    mode: "customize",
    sections: {
      preamble: { action: "remove" },
      identity: { action: "replace", content: buildPrompt() },
      tone: { action: "remove" },
      tool_efficiency: { action: "remove" },
      environment_context: { action: "preserve" },
      code_change_rules: { action: "remove" },
      guidelines: { action: "remove" },
      safety: { action: "remove" },
      tool_instructions: { action: "remove" },
      custom_instructions: { action: "preserve" },
      runtime_instructions: { action: "remove" },
      last_instructions: { action: "remove" },
    },
  },
  tools: {
    // Pi-like MCP exposure: defer MCP/external tools behind tool search instead of declaring them all up front.
    search: { enabled: true, deferThreshold: 1 },
    definitions: compactTools,
    // The compact web_search above replaces the GitHub MCP version.
    excludedTools: ["mcp:web_search"],
    // Copilot picks edit/create or apply_patch by model; unavailable names are ignored.
    availableTools: [
      "builtin:view",
      "custom:bash",
      "custom:web_search",
      "builtin:edit",
      "builtin:create",
      "builtin:apply_patch",
      "builtin:web_fetch",
      // MCP servers are controlled by Copilot's normal MCP config and --enable/--disable-mcp-server flags.
      "mcp:*",
      // Lets Copilot defer large MCP tool sets when its tool-search feature is active.
      "builtin:tool_search_tool",
      // Codemode-like JavaScript orchestration for calling tools and returning reduced results.
      "builtin:run_program",
      // Built-in sub-agents.
      "builtin:task",
      "builtin:read_agent",
    ],
  },
});
