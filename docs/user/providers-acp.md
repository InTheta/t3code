# ACP providers

T3 Code can run installed ACP commands or coding agents from the official
[ACP Registry](https://agentclientprotocol.com/get-started/registry). Registry agents bring their
own models, tools, and sign-in, while T3 Code provides projects, threads, checkpoints, and task
delegation.

Agents that T3 Code supports as their own providers, such as Codex, Claude, Cursor, Grok, OpenCode,
Pi, and [Antigravity](./providers-antigravity.md), don't appear in the Registry list. Enable them in
**Settings → Providers** instead.

T3 Code prefers the current ACP v2 preview protocol and uses its richer messages, usage, plans,
configuration, compaction, and agent-terminal updates when the agent supports them. It also
negotiates ACP v1 for Registry agents that have not migrated yet, so they continue to work through
the same generic integration.

Claude Agent uses the ACP v2 preview by default for Registry and local `claude-agent-acp`
commands. If you encounter preview issues, set `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=0` in the
provider instance's environment overrides to use ACP v1.

## Add an agent

1. Open **Settings → Providers**.
2. Select **Add provider**, then **Show more**.
3. Search the ACP Registry for the agent and select **Add** on its result.
4. Confirm the name and instance ID, then complete the agent's sign-in step.

Search only shows agents that can run on the connected server. Registry agents are third-party
code; review an agent's source and license before adding it.

## Add a local command

In **Settings → Providers → Add provider**, select **Show more**, then **Local ACP command**. Enter the executable
name or path on the selected environment, add one literal argument per row, and choose a display
name. For DeepSeek Harness, use `dsh` with arguments `--profile` and `acp`.

Local commands require no registry entry or download. Environment overrides apply to the command;
credentials and skills remain managed by the installed agent or its wrapper. Models and reasoning
options come from ACP, including model IDs that contain JSON. T3 Code launches the executable directly
without expanding shell expressions.

### Prime Agent

Install [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent/releases) on the machine
hosting the T3 server. Add a local ACP command with the Prime Agent executable and two argument
rows, `--mode` and `acp`. Configure model access in Prime Agent before opening a thread.

For a local Ollama trial, configure Prime Agent's custom provider with the Ollama OpenAI-compatible
endpoint and the exact installed model tag. When both processes run on the same host, use
`http://127.0.0.1:11434/v1`. To pin the launch settings, add separate argument rows for
`--provider`, the configured provider name, `--model`, the tag, `--thinking`, and the desired
level. Use a dedicated profile via the `PRIME_AGENT_CODING_AGENT_DIR` environment override if you
want separate credentials and session state.

On Windows, Prime Agent needs its Python kernel to execute tools. Make `uv` available to the
agent for automatic setup, or set `PRIME_AGENT_KERNEL_PYTHON` to an interpreter with the runtime
bundled with your Prime Agent release and its
[default kernel packages](https://github.com/PrimeIntellect-ai/prime-agent/blob/v0.10.3/crates/pa-core/src/kernel/bootstrap/mod.rs).
For a separate daemon on Windows, use a full named pipe path for `PRIME_AGENT_DAEMON_SOCKET`,
such as `\\.\pipe\prime-agent-t3-lab`.

Prime Agent 0.10.3 advertised a model selector and no reasoning selector for the tested custom
Ollama model. With that configuration, select reasoning using the launch arguments. Test the
provider in a disposable project before giving it access to a working checkout.

## Where agents run

Registry agents always run on the machine that hosts your T3 Code server. That stays true when you
connect through `app.t3.codes`, T3 Connect, or a relay.

Agents install under `tools/<agent-id>/<version>/` inside T3 home. T3 Code verifies SHA-256 when the Registry entry
provides one; entries without a checksum retain the Registry's HTTPS distribution guarantee.
Registry `npx` and `uvx` packages use T3-owned npm prefixes and Python tool directories at the exact
version published by the Registry. Their commands are available in a new server terminal for
sign-in and direct use. Removing an agent's last provider instance removes T3-managed binary files
but keeps package installs. To use an existing local binary, set **Executable override** explicitly.

## Signing in

Open the agent's account section in **Settings → Providers** on web or desktop. Choose
**Sign in** and, if the agent offers several methods, select one. For an installed, configured
provider, mobile also offers **Settings → Providers**.

Browser sign-in shows the agent's URL and waits for you to open or copy it before telling the
agent to proceed. The page opens on your device, while the agent runs on the environment.
Terminal methods run in an in-app terminal on that environment. On mobile, send responses
through the terminal response field. T3 Code reconnects after terminal login and waits for the
agent to confirm sign-in before reporting success. You can cancel or retry an expired attempt.

Browser and terminal sign-in leave credentials in the agent's own store. Agents that use API keys
through environment variables still take those keys in the instance's environment settings.
A configured environment or agent home applies to both sign-in and chat.

If the agent advertises logout, choose **Sign out**. Changing a shared agent login stops running
threads for instances of that same agent on the environment. Thread history and workspace files
are kept. ACP does not describe account isolation, so adding another instance does not guarantee
a separate account; use the agent's own configuration to isolate accounts when supported.

If an agent cannot complete its advertised flow remotely, its CLI remains available on the
server. For example, Codex supports `codex login --device-auth`, and Grok Build supports
`grok login --device-auth`.

## Models and options

The model picker lists the models the agent reports. If the agent reports none, or hides some, add
your own model IDs under **Custom models** in the instance settings.

Other settings the agent offers, such as reasoning effort or approval mode, appear in the
composer's model picker, beside the model list, like they do for built-in providers. Models and options that change while an agent
is running update the picker without waiting for another provider probe.

## Commands and skills

Slash commands the agent provides appear under **Provider** in the `/` menu while a session is
running. Commands the agent names with a `$` prefix appear in T3 Code's `$` skill menu instead.

## Native sessions

When an agent advertises ACP session listing and import support, expand its provider card,
choose a project, and select **List sessions**. Importing one creates a deterministic T3 thread
backed by that native session. Importing the same agent session again returns the existing thread,
including when another client performs the import.

The thread keeps the native session's title and last-update value as provider metadata without
overwriting a title you set in T3 Code. Agents that report ACP context usage drive the thread details
context window and cumulative cost metadata. See
[commands and skills](./composer.md#commands-and-skills) to show it on web and desktop.
Text resources and links render as assistant output;
binary resources, images, and audio that T3 Code cannot render yet appear as explicit placeholders
instead of disappearing.

## Permissions and terminals

Registry agents read files, edit, and run commands themselves, under their own sandbox and
approval rules. They start in their own default mode, and their mode picker in the model options
menu switches it. How far an agent is confined depends on that mode and the agent's own settings,
so use its sandbox and permission controls when that matters.

When a registry agent asks for approval, T3 Code answers by the thread's
[permission mode](./permission-modes.md): **Supervised** shows the request in the conversation,
**Auto-accept edits** approves edits and shows the rest, and **Auto** and **Full access** approve
automatically. File reads and searches never wait for approval.

Devin runs its commands through T3 Code's terminals, and those commands follow the thread's
permission mode. For other agents, T3 Code shows the command, output, and exit status the agent
reports but does not run or stop their terminals.

Registry agents can schedule work and use T3's MCP tools. Child-task presentation depends on what
the agent exposes: ACP has no portable native subagent-lineage contract, so richer delegation views
remain agent-specific.

## Checkpoints

Checkpoint rollback restores your files as usual. ACP agents cannot rewind their own conversation,
so the next turn after a rollback starts a fresh agent session that no longer remembers the
conversation from before the checkpoint.

Registry instances are not used for T3's app-owned text generation, such as thread titles, commit
messages, branch names, or pull request descriptions. Configure a text-generation-capable provider
for those actions.

## Advanced configuration

- **Executable override** runs an existing local executable instead of the managed distribution,
  keeping the registry-declared arguments and environment.
- **Authentication method** picks a specific method when the agent advertises more than one.
- **Custom models** adds model IDs the agent does not report.
