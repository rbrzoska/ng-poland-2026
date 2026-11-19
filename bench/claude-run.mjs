// Runs Claude Code headless in a workspace and returns what the run cost. Shared by bench/agent.mjs and bench/facts.mjs.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

export function tokensOf(usage = {}) {
    return (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

/**
 * The CLI may emit several `result` events (a background command finishing adds a follow-up turn): turns, tokens and API time are
 * summed over all of them, cost is the last cumulative total, `seconds` is wall clock from spawn to the last result and
 * `modelSeconds` the part of it spent waiting for the model (an agent that hangs on its own command pays in `seconds` only).
 */
export function runClaude({ prompt, cwd, model, budget, recordingFile, onToolUse = () => {}, extraTools = [] }) {
    const recording = createWriteStream(recordingFile);
    const seen = new Set();
    const totals = { inputTokens: 0, outputTokens: 0, turns: 0, toolCalls: 0 };
    const results = [];
    const session = { modelId: null, cliVersion: null };
    let stderr = "";
    const handle = line => {
        if (!line.trim()) return;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            stderr += line + "\n";
            return;
        }
        if (event.type === "system" && event.subtype === "init") {
            session.modelId = event.model ?? null;
            session.cliVersion = event.claude_code_version ?? null;
        }
        if (event.type === "assistant") {
            const message = event.message ?? {};
            if (message.id && !seen.has(message.id)) {
                seen.add(message.id);
                totals.inputTokens += tokensOf(message.usage);
                totals.outputTokens += message.usage?.output_tokens ?? 0;
                totals.turns++;
            }
            for (const block of message.content ?? []) {
                if (block.type !== "tool_use") continue;
                totals.toolCalls++;
                onToolUse(block);
            }
        }
        if (event.type === "result") results.push({ ...event, elapsedMs: performance.now() - started });
    };
    const started = performance.now();
    return new Promise(resolve => {
        const child = spawn("claude", [
            "-p", prompt,
            "--output-format", "stream-json",
            "--verbose",
            "--model", model,
            "--max-budget-usd", String(budget),
            "--setting-sources", "project",
            "--strict-mcp-config",
            "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash", ...extraTools
        ], { cwd, env: { ...process.env, FORCE_COLOR: "0" }, stdio: [ "ignore", "pipe", "pipe" ] });
        let buffered = "";
        child.stdout.on("data", chunk => {
            buffered += chunk.toString();
            const lines = buffered.split("\n");
            buffered = lines.pop();
            for (const line of lines) {
                recording.write(`${JSON.stringify({ at: Math.round(performance.now() - started) })}\t${line}\n`);
                handle(line);
            }
        });
        child.stderr.on("data", chunk => { stderr += chunk.toString(); });
        child.on("error", error => { stderr += String(error.message ?? error) + "\n"; });
        child.on("close", code => {
            if (buffered.trim()) {
                recording.write(`${JSON.stringify({ at: Math.round(performance.now() - started) })}\t${buffered}\n`);
                handle(buffered);
            }
            recording.end();
            const elapsedMs = performance.now() - started;
            const finalEvent = results.at(-1);
            const result = finalEvent ?? {};
            const sum = pick => results.reduce((total, entry) => total + (pick(entry) ?? 0), 0);
            resolve({
                seconds: Math.round((finalEvent?.elapsedMs ?? elapsedMs) / 1000),
                apiSeconds: finalEvent ? Math.round(sum(entry => entry.duration_ms) / 1000) : null,
                modelSeconds: finalEvent ? Math.round(sum(entry => entry.duration_api_ms) / 1000) : null,
                resultEvents: results.length,
                turns: finalEvent ? sum(entry => entry.num_turns) : totals.turns,
                toolCalls: totals.toolCalls,
                inputTokens: (finalEvent && sum(entry => tokensOf(entry.usage))) || totals.inputTokens,
                outputTokens: (finalEvent && sum(entry => entry.usage?.output_tokens)) || totals.outputTokens,
                costUsd: result.total_cost_usd ?? null,
                modelId: session.modelId,
                cliVersion: session.cliVersion,
                error: result.is_error ? String(result.result ?? result.error ?? "agent reported an error").slice(0, 400)
                    : finalEvent ? null
                    : `claude exited with code ${code} without a result event: ${stderr.trim().slice(0, 400)}`
            });
        });
    });
}
