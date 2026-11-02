/**
 * A side question about one round.
 *
 * The overview is a reading surface, not a second session: a question asked here
 * must not enqueue anything into the conversation, edit its history, or hold a
 * round open. So the answer is produced the same way a summary is — one model
 * call over a bounded packet — and it never touches session state.
 */

/**
 * The one line a model writes when the index it was given is not enough. It is
 * a read request, not an answer: the caller replaces it with the material and
 * asks again, so a question about a file name or an earlier round costs one
 * more call instead of a wrong guess.
 */
export const READ_PREFIX = "@@READ";

/** How many times one question may ask for more material. */
export const MAX_READS = 2;

/** Names are short indexes, not sentences: a request names at most three. */
const READ_NAMES_MAX = 3;

/** What the answerer is told, and nothing else. */
export const ASK_SYSTEM_PROMPT = [
  "你在一个会话的「概览」里回答关于某一轮的追问。",
  "问题后面附一份索引，说明这轮和这个会话里有哪些记录可读；索引里只有标题、条数和摘要，不是全部内容。",
  `索引不够时，先只回一行「${READ_PREFIX} 条目名」，条目名可以写多个、用空格分隔，不要猜；这一行不要带别的字。`,
  `最多读 ${MAX_READS} 次，读完会用「已经读取」把材料补上，然后再回答。`,
  "问题已经能回答就直接回答，只依据读到的记录。",
  "记录里没有的信息就直接说「给出的记录里没有」，不要猜测，也不要声称做过记录之外的事。",
  "用中文回答，不超过三句话，不用标题、列表或 Markdown 语法。"
].join("\n");

/**
 * The read request at the end of a model's text, when it wrote one.
 *
 * The marker is only honoured as the whole of the last line: a model that
 * mentions it inside a sentence is answering, not asking for a file.
 *
 * @param {string} text - the model's text for one step.
 * @returns {string[]} requested names, empty when the text is an answer.
 */
export function readRequestOf(text) {
  const body = String(text ?? "").trim();
  if (body === "") return [];
  const lines = body.split("\n");
  const last = lines[lines.length - 1].trim();
  if (!last.startsWith(READ_PREFIX)) return [];
  const rest = last.slice(READ_PREFIX.length).trim();
  if (rest === "" || rest.includes("@")) return [];
  const names = rest.split(/[\s,，、]+/u).map((name) => name.trim().toLowerCase()).filter((name) => name !== "");
  if (names.length === 0) return [];
  return [...new Set(names)].slice(0, READ_NAMES_MAX);
}

/**
 * Ask the model one question about a round.
 *
 * @param {object} ctx - runtime context that owns the llm service.
 * @param {object} input - provider, model, packet text, optional `read` names to
 *   material and `maxReads`, deadline, owner signal.
 * @returns {Promise<{answer: string, tokens: number}|null>} answer or null.
 */
export async function answerQuestion(ctx, input) {
  const llm = safeService(ctx, "llm");
  if (llm === undefined) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("ask timed out")), input.deadlineMs);
  // Turning the plugin off must not leave a model call streaming into a page that
  // no longer exists: the owner's signal cancels the same request the timer does.
  const outer = input.signal;
  const forward = () => controller.abort(new Error("ask cancelled"));
  if (outer !== undefined && outer !== null) {
    if (outer.aborted) forward();
    else outer.addEventListener("abort", forward, { once: true });
  }
  try {
    const call = await llm.prepareCall(
      { provider: input.provider, model: input.model, maxTokens: input.maxOutputTokens },
      controller.signal
    );
    const messages = [{ role: "user", content: [{ type: "text", text: input.packet }] }];
    const maxReads = Number.isFinite(input.maxReads) ? Math.max(0, Math.min(MAX_READS, Math.floor(input.maxReads))) : MAX_READS;
    const read = typeof input.read === "function" ? input.read : undefined;
    let tokens = 0;
    let reads = 0;
    for (;;) {
      const options = Object.freeze(Object.assign({}, call.config, {
        system: ASK_SYSTEM_PROMPT, // ui-copy-ignore
        messages,
        sessionId: input.sessionId,
        purpose: "vantage-ask", // ui-copy-ignore
        signal: controller.signal // ui-copy-ignore
      }));
      let text = "";
      for await (const chunk of call.stream(options)) {
        if (controller.signal.aborted) break;
        if (chunk.type === "text-delta" || chunk.type === "text") {
          text += typeof chunk.text === "string" ? chunk.text : typeof chunk.delta === "string" ? chunk.delta : "";
        } else if (chunk.type === "block-end" && chunk.block?.type === "text") {
          if (text === "") text = chunk.block.text ?? "";
        } else if (chunk.type === "usage" && Number.isFinite(chunk.usage?.totalTokens)) {
          tokens += chunk.usage.totalTokens;
        }
      }
      if (controller.signal.aborted) return null;
      const body = text.trim();
      // A read request is not an answer: it is replaced by the material it names
      // and the model is asked once more. Past the cap the text is the answer it
      // could give with what it has.
      const wanted = readRequestOf(body);
      if (wanted.length === 0 || read === undefined || reads >= maxReads) {
        return body === "" ? null : { answer: body, tokens };
      }
      const material = String(read(wanted) ?? "").trim();
      if (material === "") return body === "" ? null : { answer: body, tokens };
      reads += 1;
      messages.push({ role: "assistant", content: [{ type: "text", text: body }] });
      messages.push({ role: "user", content: [{ type: "text", text: `已经读取：\n${material}\n\n直接回答用户的追问。` }] });
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener?.("abort", forward);
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
