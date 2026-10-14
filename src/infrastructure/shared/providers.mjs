export function normalizeUsage(provider, raw, inputText = "", outputText = "") {
  if (provider === "gemini" && raw)
    return {
      input: raw.promptTokenCount ?? 0,
      output: (raw.candidatesTokenCount ?? 0) + (raw.thoughtsTokenCount ?? 0),
      cached: raw.cachedContentTokenCount ?? 0,
      reasoning: raw.thoughtsTokenCount ?? 0,
      actual: true,
    };
  if (provider === "anthropic" && raw)
    return {
      input:
        (raw.input_tokens ?? 0) +
        (raw.cache_read_input_tokens ?? 0) +
        (raw.cache_creation_input_tokens ?? 0),
      output: raw.output_tokens ?? 0,
      cached: raw.cache_read_input_tokens ?? 0,
      reasoning: 0,
      actual: true,
    };
  if (raw)
    return {
      input: raw.prompt_tokens ?? 0,
      output: raw.completion_tokens ?? 0,
      cached:
        raw.prompt_tokens_details?.cached_tokens ??
        raw.prompt_cache_hit_tokens ??
        0,
      reasoning: raw.completion_tokens_details?.reasoning_tokens ?? 0,
      actual: true,
    };
  return {
    input: Math.ceil(inputText.length / 3),
    output: Math.ceil(outputText.length / 3),
    cached: 0,
    reasoning: 0,
    actual: false,
  };
}
export function estimateCost(usage, config) {
  if (config.inputPrice == null || config.outputPrice == null) return null;
  return (
    ((usage.input - usage.cached) * config.inputPrice +
      usage.cached * (config.cachedPrice ?? config.inputPrice) +
      usage.output * config.outputPrice) /
    1000000
  );
}
export function endpoint(config, key, request) {
  const root = new URL(config.baseUrl);
  if (
    root.protocol !== "https:" &&
    !(
      root.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(root.hostname)
    )
  )
    throw new Error("远程服务必须使用 HTTPS，本地模型可使用 localhost HTTP。");
  if (root.username || root.password || root.search || root.hash)
    throw new Error("Base URL 不应包含密码、查询参数或片段。");
  const base = config.baseUrl.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json" };
  const limit = request.maxTokens ?? 1500;
  if (config.id === "anthropic")
    return {
      url: `${base}/messages`,
      headers: {
        ...headers,
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: config.model,
        max_tokens: limit,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        stream: true,
      },
    };
  if (config.id === "gemini")
    return {
      url: `${base}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`,
      headers: { ...headers, "x-goog-api-key": key },
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: { maxOutputTokens: limit },
      },
    };
  return {
    url: `${base}/chat/completions`,
    headers: { ...headers, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: {
      model: config.model,
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.prompt },
      ],
      max_tokens: limit,
      stream: true,
      stream_options: { include_usage: true },
    },
  };
}
export async function* parseSSE(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      pending = pending.replace(/\r\n/g, "\n");
      let end;
      while ((end = pending.indexOf("\n\n")) !== -1) {
        const event = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") yield JSON.parse(data);
      }
      if (done) {
        const data = pending
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") yield JSON.parse(data);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
export async function complete(
  config,
  key,
  request,
  signal,
  onChunk,
  fetcher = fetch,
) {
  if (!config.model.trim()) throw new Error("请在设置中填写模型名称。");
  if (!key && config.id !== "custom")
    throw new Error("请先在设置中保存此服务商的 API Key。");
  const spec = endpoint(config, key, request);
  const response = await fetcher(spec.url, {
    method: "POST",
    headers: spec.headers,
    body: JSON.stringify(spec.body),
    signal,
    redirect: "error",
  });
  if (!response.ok) {
    const friendly = {
      400: "请求参数或模型配置不被服务商支持，请检查模型名称。",
      401: "API Key 无效，请检查设置中的密钥。",
      403: "服务商拒绝访问，请检查账户权限或地区可用性。",
      404: "模型或 API 地址不存在，请检查设置。",
      429: "服务商限流或余额不足，请稍后重试并检查账户。",
    };
    throw new Error(
      friendly[response.status] ??
        `服务暂不可用（HTTP ${response.status}），请稍后重试。`,
    );
  }
  if (!response.body) throw new Error("服务没有返回响应内容。");
  let text = "";
  let rawUsage;
  let finishReason;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const data = await response.json();
    text =
      config.id === "gemini"
        ? (data.candidates?.[0]?.content?.parts ?? [])
            .filter((p) => !p.thought)
            .map((p) => p.text ?? "")
            .join("")
        : config.id === "anthropic"
          ? (data.content ?? [])
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("")
          : (data.choices?.[0]?.message?.content ?? "");
    rawUsage = data.usage ?? data.usageMetadata;
    onChunk(text);
  } else
    for await (const event of parseSSE(response.body)) {
      if (event.error || event.type === "error")
        throw new Error("服务商在生成过程中返回错误，请检查账户与模型设置。");
      let delta = "";
      if (config.id === "anthropic") {
        if (event.type === "message_start") rawUsage = event.message?.usage;
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta"
        )
          delta = event.delta.text;
        if (event.type === "message_delta") {
          rawUsage = { ...rawUsage, ...event.usage };
          finishReason = event.delta?.stop_reason;
        }
      } else if (config.id === "gemini") {
        delta = (event.candidates?.[0]?.content?.parts ?? [])
          .filter((part) => !part.thought)
          .map((part) => part.text ?? "")
          .join("");
        if (event.usageMetadata) rawUsage = event.usageMetadata;
        finishReason = event.candidates?.[0]?.finishReason ?? finishReason;
      } else {
        delta = event.choices?.[0]?.delta?.content ?? "";
        if (event.usage) rawUsage = event.usage;
        finishReason = event.choices?.[0]?.finish_reason ?? finishReason;
      }
      text += delta;
      if (delta) onChunk(delta);
    }
  const usage = normalizeUsage(
    config.id,
    rawUsage,
    request.system + request.prompt,
    text,
  );
  if (!text.trim()) {
    const error = new Error(
      "模型没有返回可显示的文字，请检查模型支持的任务与输出限制。",
    );
    error.usage = usage;
    throw error;
  }
  if (["length", "max_tokens", "MAX_TOKENS"].includes(finishReason)) {
    const error = new Error(
      "模型达到输出长度限制，回答未完成；请缩短内容或提高输出限制。",
    );
    error.usage = usage;
    throw error;
  }
  return { text, usage };
}
