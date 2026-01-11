import { NextRequest, NextResponse } from "next/server";
import { AvailableMethods } from "@/app/arena/methods";

export const runtime = "edge";

type Role = "system" | "user" | "assistant";

export type ArenaMessage = {
  role: Role;
  content: string;
};

function isRole(v: any): v is Role {
  return v === "system" || v === "user" || v === "assistant";
}

function normalizeMessages(input: unknown): ArenaMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((m: any) => ({ role: m?.role, content: m?.content }))
    .filter((m: any) => isRole(m.role) && typeof m.content === "string")
    .map((m: any) => ({ role: m.role as Role, content: m.content as string }));
}

type ArenaVariantSpec =
  | {
      mode: "baseline";
    }
  | {
      mode: "system";
      systemPrompt: string;
    }
  | {
      mode: "method";
      methodId: string;
    };

export type ArenaTurnRequest = {
  /** Conversation history for side A (user+assistant, optional system). */
  messagesA: ArenaMessage[];
  /** Conversation history for side B (user+assistant, optional system). */
  messagesB: ArenaMessage[];

  /** The new user input for this turn (will be appended to both sides if provided). */
  userInput?: string;

  /** Variant config for each side. */
  a: ArenaVariantSpec;
  b: ArenaVariantSpec;

  /** Base model config (same for A and B). */
  model: {
    provider: string;
    model: string;
  };
};

function toProviderChatCompletionsPath(provider: string) {
  const p = provider.toLowerCase();
  // Support OpenAI-compatible providers first.
  switch (p) {
    case "openai":
      return "/api/openai/v1/chat/completions";
    case "xai":
      return "/api/xai/v1/chat/completions";
    case "moonshot":
      return "/api/moonshot/v1/chat/completions";
    case "siliconflow":
      return "/api/siliconflow/v1/chat/completions";
    case "302ai":
    case "302.ai":
    case "302":
      return "/api/302ai/v1/chat/completions";
    case "deepseek":
      // DeepSeek uses /chat/completions without /v1.
      return "/api/deepseek/chat/completions";
    default:
      // Allow power users to pass exact provider segment already routed by /api/[provider]/...
      return `/api/${p}/v1/chat/completions`;
  }
}

function buildOpenAICompatBody(model: string, messages: ArenaMessage[]) {
  return {
    model,
    messages,
    stream: false,
  };
}

function pickForwardHeaders(req: NextRequest) {
  // Forward auth headers from browser -> arena -> provider.
  // Note: we intentionally do NOT forward cookies.
  const headers = new Headers();

  const auth = req.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);

  const xGoog = req.headers.get("x-goog-api-key");
  if (xGoog) headers.set("x-goog-api-key", xGoog);

  const xApiKey = req.headers.get("x-api-key");
  if (xApiKey) headers.set("x-api-key", xApiKey);

  const apiKey = req.headers.get("api-key");
  if (apiKey) headers.set("api-key", apiKey);

  return headers;
}

async function callProviderOnce(
  req: NextRequest,
  provider: string,
  model: string,
  messages: ArenaMessage[],
) {
  const url = new URL(req.url);
  const base = `${url.protocol}//${url.host}`;
  const endpoint = `${base}${toProviderChatCompletionsPath(provider)}`;

  const forwardHeaders = pickForwardHeaders(req);
  forwardHeaders.set("Content-Type", "application/json");

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: forwardHeaders,
    body: JSON.stringify(buildOpenAICompatBody(model, messages)),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Provider error ${resp.status}: ${text}`);
  }

  const data: any = await resp.json();
  const content =
    data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";
  return String(content);
}

async function getVariantSystemPrompt(
  variant: ArenaVariantSpec,
  ctx: {
    messages: ArenaMessage[];
    model: { provider: string; model: string };
    origin: string;
    forwardHeaders: Record<string, string>;
  },
) {
  if (variant.mode === "baseline") return "";
  if (variant.mode === "system") return (variant.systemPrompt ?? "").trim();

  const method = AvailableMethods[variant.methodId];
  if (!method) throw new Error(`Unknown methodId: ${variant.methodId}`);

  const result = await method.build({
    messages: ctx.messages,
    model: ctx.model,
    origin: ctx.origin,
    forwardHeaders: ctx.forwardHeaders,
  });
  return (result?.systemPrompt ?? "").trim();
}

function injectSystemPrompt(
  baseMessages: ArenaMessage[],
  systemPrompt: string,
) {
  const msgs = [...baseMessages];
  const sp = (systemPrompt ?? "").trim();
  if (!sp) return msgs;

  if (msgs.length > 0 && msgs[0].role === "system") {
    msgs[0] = { role: "system", content: sp };
  } else {
    msgs.unshift({ role: "system", content: sp });
  }

  return msgs;
}

export async function POST(req: NextRequest) {
  let body: ArenaTurnRequest;
  try {
    body = (await req.json()) as ArenaTurnRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const provider = body?.model?.provider;
  const model = body?.model?.model;
  if (!provider || !model) {
    return NextResponse.json(
      { ok: false, error: "Missing model.provider or model.model" },
      { status: 400 },
    );
  }

  const baseA: ArenaMessage[] = normalizeMessages((body as any).messagesA);
  const baseB: ArenaMessage[] = normalizeMessages((body as any).messagesB);

  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;
  const forwardHeadersObj: Record<string, string> = {};
  for (const [k, v] of pickForwardHeaders(req).entries()) {
    forwardHeadersObj[k] = v;
  }

  const userInput = (body.userInput ?? "").trim();
  const mergedA: ArenaMessage[] = userInput
    ? [...baseA, { role: "user" as const, content: userInput }]
    : baseA;
  const mergedB: ArenaMessage[] = userInput
    ? [...baseB, { role: "user" as const, content: userInput }]
    : baseB;

  const ctxA = {
    messages: mergedA,
    model: { provider, model },
    origin,
    forwardHeaders: forwardHeadersObj,
  };
  const ctxB = {
    messages: mergedB,
    model: { provider, model },
    origin,
    forwardHeaders: forwardHeadersObj,
  };

  try {
    const [systemA, systemB] = await Promise.all([
      getVariantSystemPrompt(body.a, ctxA),
      getVariantSystemPrompt(body.b, ctxB),
    ]);

    const aMsgs = injectSystemPrompt(mergedA, systemA);
    const bMsgs = injectSystemPrompt(mergedB, systemB);

    const [aText, bText] = await Promise.all([
      callProviderOnce(req, provider, model, aMsgs),
      callProviderOnce(req, provider, model, bMsgs),
    ]);

    return NextResponse.json({
      ok: true,
      a: { text: aText },
      b: { text: bText },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
