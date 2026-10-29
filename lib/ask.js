/**
 * A side question about one round.
 *
 * The overview is a reading surface, not a second session: a question asked here
 * must not enqueue anything into the conversation, edit its history, or hold a
 * round open. So the answer is produced the same way a summary is — one model
 * call over a bounded packet — and it never touches session state.
 */

/** What the answerer is told, and nothing else. */
export const ASK_SYSTEM_PROMPT = [
  "你在一个会话的「概览」里回答关于某一轮的追问。",
  "只依据给出的记录回答：用户请求、本轮回复摘录、已记录的事实、会话里更早轮的摘要、此前的追问。",
  "记录里没有的信息就直接说「给出的记录里没有」，不要猜测，也不要声称做过记录之外的事。",
  "用中文回答，不超过三句话，不用标题、列表或 Markdown 语法。"
].join("\n");

/**
 * Ask the model one question about a round.
 *
 * @param {object} ctx - runtime context that owns the llm service.
 * @param {object} input - provider, model, packet text, deadline.
 * @returns {Promise<{answer: string, tokens: number}|null>} answer or null.
 */
export async function answerQuestion(ctx, input) {
  const llm = safeService(ctx, "llm");
  if (llm === undefined) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("ask timed out")), input.deadlineMs);
  try {
    const call = await llm.prepareCall(
      { provider: input.provider, model: input.model, maxTokens: input.maxOutputTokens },
      controller.signal
    );
    const options = Object.freeze(Object.assign({}, call.config, {
      system: ASK_SYSTEM_PROMPT, // ui-copy-ignore
      messages: [{ role: "user", content: [{ type: "text", text: input.packet }] }],
      sessionId: input.sessionId,
      purpose: "vantage-ask", // ui-copy-ignore
      signal: controller.signal // ui-copy-ignore
    }));
    let text = "";
    let tokens = 0;
    for await (const chunk of call.stream(options)) {
      if (controller.signal.aborted) break;
      if (chunk.type === "text-delta" || chunk.type === "text") {
        text += typeof chunk.text === "string" ? chunk.text : typeof chunk.delta === "string" ? chunk.delta : "";
      } else if (chunk.type === "block-end" && chunk.block?.type === "text") {
        if (text === "") text = chunk.block.text ?? "";
      } else if (chunk.type === "usage" && Number.isFinite(chunk.usage?.totalTokens)) {
        tokens = chunk.usage.totalTokens;
      }
    }
    const answer = text.trim();
    return answer === "" ? null : { answer, tokens };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a service without letting a missing registry throw.
 *
 * @param {object} ctx - owner context.
 * @param {string} name - service name.
 * @returns {any} the service or undefined.
 */
function safeService(ctx, name) {
  try {
    return ctx?.get?.(name);
  } catch {
    return undefined;
  }
}
