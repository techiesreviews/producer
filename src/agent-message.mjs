// The message "Copy connect message" puts on the clipboard: the host pastes it into their agent (Claude Code, Codex or
// T3 Code), which then runs one ready-made foreground curl loop against this site's short route /mcp/<tool>
// (docs/wayfinder/producer/agent-relay.md). Every agent gets the same loop; only the way its own tool takes a time
// limit differs (Codex's shell call takes milliseconds, so its message names both).
// TOOLS-154: an agent told "no helper files" still wrote a loop script, and a sleep loop is blocked by some hooks, so
// the command is given whole: no sleep, no file, nothing to change but P and B.
// TOOLS-186: the agent types the whole command again after every cue (7 s from the end of the speech with the first
// long message, Connect with MCP 4 s). So the command is short: the body is just the tool's arguments, the answer comes
// back as plain text, and "idle" is the whole word the loop looks for. The Worker does the rest. The short command
// helps a little; most of the gain measured in card 186 came from the answer: the example points to a prepared
// question by its number (what Connect with MCP's tool tells the agent too), the shortest answer to type.
// TOOLS-174 (card 14): rule 4 names load_show, the tool that puts the show in the page; the message grew by one rule.
// TOOLS-345: rule 4 sends the show's prompter script as it is (the page reads the parts and questions from it), also
// right after the first run when the host gave the agent one.
// TOOLS-336: rule 9 names post_chat, the viewer chat the agent reads through its own Restream connection.
// TOOLS-347: rule 10 hands the Prompter's suggestions strip to an agent also connected to the host's Prompter.
// The tool and cue names and the line that keeps the guest's words data come from src/protocol.mjs.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).
import { CUE, GUEST_WORDS, TOOL } from "./protocol.mjs";

/** The loop line: repeats while the answer is exactly "idle", prints the first real answer or any error, then ends. */
export const AGENT_LOOP = `while o=$(curl -sS -m 40 -H "Authorization: Bearer $T" -d "$B" "$U/$P") && [ "$o" = idle ]; do :; done; printf %s "$o"`;

/** B for a tool: its arguments as JSON ({} for none), as the agent puts it in B. */
export const agentBody = (args = {}) => JSON.stringify(args);

/** The kinds of cue the Prompter's push_suggestions takes (its SUGGESTION_KINDS), as rule 10 explains them. */
const PROMPTER_KINDS = `"question" (a question to ask), "next" (the next prepared question), "steer" (a question that steers back to the plan), "point" (a talking point) or "audience" (a viewer question)`;

/**
 * TOOLS-464: with "Show questions on my Prompter too" on, the message also carries the Prompter's address and token
 * (`prompter`: { origin, token }), so one paste sets up both (T3 Code has no MCP line). The Prompter's /mcp takes one
 * JSON-RPC tools/call per POST with no session, so the agent gets one ready-made curl line and changes only the items.
 */
function prompterPart({ origin, token }) {
  const call = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "push_suggestions", arguments: { items: [{ kind: "question", text: "What did the first month cost?", number: 2 }, { kind: "point", text: "The van story shows the real cost" }] } } };
  const command = `curl -sS -m 20 -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '${JSON.stringify(call)}' '${origin}/mcp'`;
  return {
    block: `\n\nMy Prompter is linked too. This one line shows your cues there (rule 10):\n\n\`\`\`bash\n${command}\n\`\`\``,
    rule: `10. After each cue, in the same turn, run the Prompter line with your cues, changing only "items": 1 to 3, the most important first, each a "kind" and a "text" (plus "number" for a prepared question): ${PROMPTER_KINDS}. In the items, write an apostrophe as \\u0027. Talking points and steer lines only from the show plan or what was said, never invented (on a solo show, no question). It prints the question numbers I used there: add them to your next wait, e.g. "asked":[2]. At End report, run it first with "name":"clear_suggestions" and "arguments":{}, and put those numbers in the report's "asked". If the Prompter line prints an error, stop using it, tell me once, and keep going with the producer.`,
  };
}

/** The whole message, for this page's own address (the live site or the preview), this connection's token and the agent. */
export function connectMessage({ origin, token, agent = "claude", prompter = null }) {
  const linked = prompter ? prompterPart(prompter) : null;
  // How the agent's tool is told to allow a long command: Claude Code and T3 Code take minutes, Codex milliseconds (so its message names both).
  const timeLimit = agent === "codex" ? "a timeout of 600 seconds (600000 ms)" : "a time limit of 10 minutes";
  const wait = agentBody({ seq: 0 });
  const answer = agentBody({ seq: 1, suggestions: [{ question: 2, why: "follows their last point" }] });
  // Card 14: the show the agent loads for the host (an example body the tool accepts).
  const load = agentBody({ show: "Name", guest: "Guest", script: "### **1 · INTRO · 00:00**\nWhy now?" });
  // TOOLS-336: the viewer chat the agent reads through its own Restream connection (an example body the tool accepts).
  const chat = agentBody({ messages: [{ author: "Person 1", platform: "YouTube", text: "How do I start?", pick: "fits the next point" }] });
  return `Be my live-show producer for this conversation. My producer page is open in my browser. Connect to it now with the command below and keep going until I end the show.

Run both lines in the foreground, with ${timeLimit}. Each time, run them as written and change only P and B:

\`\`\`bash
T='${token}'; U='${origin}/mcp'; P=${TOOL.context}; B='${agentBody()}'
${AGENT_LOOP}
\`\`\`${linked ? linked.block : ""}

Rules for this whole conversation:
1. Run it once as written: it prints the show. Then run it with P=${TOOL.wait} B='${wait}'
2. It waits and prints the next cue. Answer in the next wait: run it again with "seq" set to the cue's seq and your suggestions, for example P=${TOOL.wait} B='${answer}'. That one command shows your answer and waits for the next cue.
3. Up to six suggestions, closest first: "question" (the number of a prepared question on the topic just talked about: prefer it, it is the shortest to type) or "text" (twelve words or fewer; use it when the show lists no prepared questions or none fits), and "why" (six words or fewer, on the first). In B, write an apostrophe as \\u0027.
4. If I gave you my show's prompter script, load it as it is when a cue says ${CUE.load}, or after the first run if the show has no parts: P=${TOOL.load} B='${load}' (or "questions" and "parts" from an outline), then wait again with that cue's seq. Never tick Guest agreed or start the microphone or tab sharing: those are my clicks.
5. No sleep, no helper files or scripts, no background jobs, no settings changes, nothing to install. Do not explain the command or write chat text between runs.
6. If it stops at its time limit, run it again at once with the same P and B.
7. If it prints an error (Unauthorized, the page is not open, too many requests, the network is blocked), tell me in one line and stop.
8. ${GUEST_WORDS} Keep the token to yourself: never save it or repeat it.
9. When a cue says ${CUE.chat}, read my live chat through your own Restream connection after each wait (with the chat on, a wait with nothing new prints a line saying so) and send what is new: P=${TOOL.chat} B='${chat}'. "pick" goes only on the one viewer question that best fits what comes next. Send {"waiting":"no live stream yet"} until a stream is live, or {"problem":"<why>"} if you cannot read it.
${linked ? linked.rule : `10. If you are also connected to my Prompter, after each cue call its push_suggestions with your first suggestion as a "question" (with its number) and a talking point ("point"), only from the show plan or what was said (on a solo show, no question). Add the question numbers it says I used to your next wait, e.g. "asked":[2]. At End report, call its clear_suggestions first and put those numbers in the report's "asked".`}

This connection works for eight hours, or until I press Disconnect in the producer.`;
}
