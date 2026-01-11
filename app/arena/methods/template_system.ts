import type {
  ArenaMessage,
  ArenaMethod,
  ArenaMethodContext,
  ArenaMethodResult,
} from "../methods";
import templates from "../templates.json";

const CLASSIFICATION_ERROR = "MODEL_ERROR";

// =========================
// Classifier prompt (from run_experiment.py)
// =========================
const CLASSIFIER_SYSTEM_PROMPT = `
你是一个严谨但不过度敏感的中文文本情绪标注器。你可以在内部进行复杂推理，但在最终输出中只能给出一段 JSON。

你的任务：对于每一条用户输入（通常是一句话或一小段中文），标注以下 4 个字段：

1. emotion：主要情绪类别（6 选 1）
2. intensity：该情绪的强度（3 选 1）
3. support_type：用户更需要哪种支持方式（情感陪伴 / 具体建议 / 两者皆有）
4. comment：用 1–2 句中文简要说明你为什么这样标注

========================
一、emotion 情绪类别（6 选 1）
========================

emotion 字段只能从以下 6 个英文小写字符串中选择一个：

- anger   : 愤怒、生气、恼火、被冒犯、想发火
- sadness : 伤心、失落、难过、委屈、心灰意冷
- anxiety : 焦虑、担心、紧张、心神不宁、压力大、脑子停不下来
- fear    : 害怕、恐惧、预感到严重后果、对未知或威胁感到害怕
- happy   : 开心、高兴、满足、兴奋、期待
- neutral : 情绪比较平淡，偏事实描述或一般聊天，几乎没有明显正负情绪

判断原则：
- 看“这句话最主要的情绪是哪一种”，不要硬拆成很多类。
- 如果有混合情绪，选择对用户主观体验最核心的那一个：
  - 例如“又生气又委屈”，可在 anger 和 sadness 中根据语气选择其一；
  - “焦虑 + 害怕以后会怎样”，更偏 anxiety 或 fear，视描述为主。
- 如果几乎看不到情绪，只是陈述事实、打招呼、闲聊，则标为 neutral。

========================
二、intensity 情绪强度（low / medium / high）
========================

intensity 只能取以下三个英文小写值之一：

- low
- medium
- high

【核心思想】
不要只看几个关键词，而要结合：
- 整体语气；
- 是否反复强调痛苦；
- 是否提到“睡眠、饮食、工作学习、人际关系”等功能受损；
- 是否是一种夸张说法（吐槽 / 玩笑）还是在严肃描述真实状态。

1）low（轻度情绪）
- 情绪存在，但比较轻，更多像是“不太舒服”“有点烦”。
- 典型特点：
  - 用词偏温和：“有点难过”“有点紧张”“最近状态一般”；
  - 没有明显的“撑不住”“崩溃”之类表达；
  - 用户仍然感觉自己大致能应对，只是有点不爽或纠结。

2）medium（中度情绪）
- 情绪比较明显，会明显影响心情，但用户仍在正常生活和思考中。
- 典型特点：
  - 明确表达“很难受”“压力很大”“整个人都不好”；
  - 可能会影响睡眠、专注，但用户还有一定控制力；
  - 经常是“撑得住，但非常累”的感觉。

3）high（高度情绪）
⚠️ 请谨慎使用 high。只有在满足以下情况之一时才标 high：
- 用词极端 + 语境严肃，不像是随口吐槽：
  - 如：“真的撑不住了”“感觉快崩溃了”“每天醒来都不想活”“完全看不到希望”等；
- 清楚提到严重功能受损：
  - 长期失眠、完全提不起劲、无法正常上学/上班/照顾自己；
- 反复、强烈地描述痛苦程度，而不是一句夸张表达。

注意区分：
- 夸张说法（多为 low/medium）：
  - “气死我了”“我要疯了”“崩溃了哈哈”“快被你们烦死了”——如果上下文看起来是在吐槽/玩笑，而整体内容没有持续痛苦和功能受损，就不要标为 high。
- 严肃表达（可能是 high）：
  - 文本整体很认真、持续描述痛苦、无助、绝望，对未来看不到希望。

如果无法判断 high 还是 medium，请偏向标为 medium。
特别规则：如果 emotion = "neutral"，则 intensity 必须为 "medium"。

========================
三、support_type（emotional / practical / both）
========================

support_type 用来描述用户“更希望从对话里得到什么”：

取值只能是以下三个英文小写之一：

- emotional : 用户主要需要情感上的陪伴、理解、安慰；
- practical : 用户主要需要实际建议、信息、分析问题“怎么办”；
- both      : 两者兼有，既有情绪，又明确希望得到一些具体建议。

判断原则：

1）emotional
- 用户重点在“表达感受”、“找人倾诉”，且缺少明确“怎么办”问题。

2）practical
- 用户有明确的“问题 + 求建议”结构（如“要不要…/怎么选…”）。

3）both
- 既有较强情绪表达，又有具体求助/咨询。

========================
四、comment 字段
========================

- 用 1–2 句简短中文解释你的判断。

========================
五、输出格式（非常重要）
========================

- 最终“可见输出”中只能包含一个 JSON 对象。
- JSON 格式必须严格为：

{
  "emotion": "...",
  "intensity": "...",
  "support_type": "...",
  "comment": "..."
}

- emotion ∈ {"anger","sadness","anxiety","fear","happy","neutral"}
- intensity ∈ {"low","medium","high"}
- support_type ∈ {"emotional","practical","both"}
- 不要输出任何其它文字（不要解释过程，不要输出多段 JSON）。
`;

const SUPPORT_TYPE_GUIDE = `
【支持风格维度：support_type（情感 vs 建议）】

对每个用户输入，除了情绪和强度，还会有一个 support_type 标签，用来告诉你：
用户更想要哪种类型的回应。

support_type 取值有三种：

1. emotional —— 情感陪伴为主
2. practical —— 具体建议/信息为主
3. both —— 兼顾情感陪伴和少量建议

--------------------------------
1）当 support_type = "emotional" 时
--------------------------------

目标：
- 让用户感到“被听见、被理解、被接纳”，而不是被教育或被指导。

--------------------------------
2）当 support_type = "practical" 时
--------------------------------

目标：
- 在共情的前提下，给出 1–3 条“小而具体”的建议，保持尊重用户自主权。

--------------------------------
3）当 support_type = "both" 时
--------------------------------

目标：
- 先被理解，再得到一点帮助；建议部分要少量、具体、可操作。

--------------------------------
4）你整体需要避免的“人机感”
--------------------------------

- 避免自我揭示（“作为一个AI...”）；
- 避免生硬模板重复；
- 避免过度说明书式语气。
`;

// =========================
// Fallback heuristics (used only when classifier call is unavailable/fails)
// =========================
const EMOTION_KEYWORDS: Record<string, string[]> = {
  anger: ["生气", "愤怒", "恼火", "气死", "讨厌", "被气"],
  sadness: ["伤心", "难过", "失落", "心凉", "崩溃", "想哭"],
  anxiety: ["焦虑", "紧张", "担心", "慌", "压力"],
  fear: ["害怕", "恐惧", "担心会发生", "害怕会"],
  happy: ["开心", "高兴", "喜悦", "激动", "满足"],
  neutral: ["嗯", "只是", "最近", "没有"],
};

function detectEmotionHeuristic(text: string): string {
  const t = text.toLowerCase();
  for (const [emo, kws] of Object.entries(EMOTION_KEYWORDS)) {
    for (const kw of kws) {
      if (t.includes(kw)) return emo;
    }
  }
  return "neutral";
}

function detectIntensityHeuristic(text: string): string {
  const t = text.toLowerCase();
  const high = ["撑不住", "快崩溃", "绝望", "要死", "受不了", "崩溃了"];
  const low = ["有点", "有些", "有一点", "有点儿", "稍微"];
  for (const kw of high) if (t.includes(kw)) return "high";
  for (const kw of low) if (t.includes(kw)) return "low";
  return "medium";
}

function detectSupportTypeHeuristic(text: string): string {
  const t = text.toLowerCase();
  const practical = ["怎么办", "要不要", "怎样处理", "如何", "建议"];
  const emotional = ["想找人说", "想倾诉", "陪我", "听我说"];
  for (const kw of practical) if (t.includes(kw)) return "practical";
  for (const kw of emotional) if (t.includes(kw)) return "emotional";
  return "both";
}

// =========================
// Template selection
// =========================
function selectTemplate(emotion: string, intensity: string) {
  const normalizedEmotion = emotion.toLowerCase();
  const normalizedIntensity = intensity.toLowerCase();

  for (const tpl of templates as any[]) {
    if (
      tpl.emotion === normalizedEmotion &&
      tpl.intensity === normalizedIntensity
    )
      return tpl;
  }
  for (const tpl of templates as any[]) {
    if (tpl.emotion === normalizedEmotion) return tpl;
  }
  return null;
}

// =========================
// Classifier calling + robust JSON parsing
// =========================
const ALLOWED_EMOTIONS = new Set([
  "anger",
  "sadness",
  "anxiety",
  "fear",
  "happy",
  "neutral",
]);
const ALLOWED_INTENSITIES = new Set(["low", "medium", "high"]);
const ALLOWED_SUPPORT_TYPES = new Set(["emotional", "practical", "both"]);

function stripMarkdownCodeFences(text: string) {
  return text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim();
}

function extractLastJsonObject(text: string): string | null {
  const matches = text.match(/\{[\s\S]*?\}/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

function normalizeLabel(v: unknown) {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function parseClassifierJson(rawText: string): {
  emotion: string;
  intensity: string;
  support_type: string;
  comment: string;
  raw: string;
} | null {
  const raw = String(rawText ?? "");
  const candidates: string[] = [];

  const c1 = extractLastJsonObject(raw);
  if (c1) candidates.push(c1);

  const stripped = stripMarkdownCodeFences(raw);
  if (stripped !== raw) {
    const c2 = extractLastJsonObject(stripped);
    if (c2) candidates.push(c2);
  }

  for (const cand of candidates) {
    try {
      const parsed: any = JSON.parse(stripMarkdownCodeFences(cand));
      const emotion = normalizeLabel(parsed?.emotion);
      const intensity = normalizeLabel(parsed?.intensity);
      const support_type = normalizeLabel(parsed?.support_type);
      const comment = String(parsed?.comment ?? "").trim();

      if (!ALLOWED_EMOTIONS.has(emotion)) continue;
      if (!ALLOWED_INTENSITIES.has(intensity)) continue;
      if (!ALLOWED_SUPPORT_TYPES.has(support_type)) continue;

      return {
        emotion,
        intensity: emotion === "neutral" ? "medium" : intensity,
        support_type,
        comment,
        raw,
      };
    } catch {
      // continue
    }
  }

  return null;
}

function toProviderChatCompletionsPath(provider: string) {
  const p = (provider ?? "").toLowerCase();
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
      return "/api/deepseek/chat/completions";
    default:
      return `/api/${p}/v1/chat/completions`;
  }
}

async function callClassifierModel(
  ctx: ArenaMethodContext,
  userInput: string,
): Promise<ReturnType<typeof parseClassifierJson>> {
  if (!ctx.origin) return null;

  const provider = ctx.model?.provider;
  const model = ctx.model?.model;
  if (!provider || !model) return null;

  const endpoint = `${ctx.origin}${toProviderChatCompletionsPath(provider)}`;

  const headers = new Headers(ctx.forwardHeaders ?? {});
  headers.set("Content-Type", "application/json");

  const messages: ArenaMessage[] = [
    { role: "system", content: CLASSIFIER_SYSTEM_PROMPT.trim() },
    {
      role: "user",
      content: `用户输入：${userInput}\n请直接输出 JSON。`,
    },
  ];

  const resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      stream: false,
    }),
  });

  if (!resp.ok) {
    // classifier failures should never block the main chat; just fall back
    return null;
  }

  const data: any = await resp.json().catch(() => null);
  const content =
    data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? "";

  return parseClassifierJson(String(content ?? ""));
}

// =========================
// Method implementation
// =========================
export const TemplateSystemMethod: ArenaMethod = {
  id: "template_system",
  displayName: "Template System Method",

  async build(ctx: ArenaMethodContext): Promise<ArenaMethodResult> {
    const msgs = ctx.messages || [];
    const lastUser =
      [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";

    // 1) Try model-based classification
    const classified = await callClassifierModel(ctx, lastUser).catch(
      () => null,
    );

    // 2) Fallback to heuristics if classifier is unavailable
    const emotion = classified?.emotion ?? detectEmotionHeuristic(lastUser);
    const intensity =
      classified?.intensity ??
      (emotion === "neutral" ? "medium" : detectIntensityHeuristic(lastUser));
    const support_type =
      classified?.support_type ?? detectSupportTypeHeuristic(lastUser);

    const tpl = selectTemplate(emotion, intensity);
    const template_snippet = tpl
      ? tpl.prompt_snippet
      : "在没有特定模板时，也请保持共情与安全。";
    const template_id = tpl ? tpl.template_id : "";

    const systemContent = [
      "你是一名具备边界感的共情倾听者，要真诚、温柔、尊重，不要捏造个人经历，不要提供医疗或法律诊断，不要鼓励危险行为。",
      `当前标签（供参考）：emotion=${emotion}，intensity=${intensity}，support_type=${support_type}。`,
      "下面这一段是当前情绪场景下的回复策略提示，请尽可能遵循：",
      template_snippet,
      "以下是支持风格维度说明，请结合 support_type 调整语气与侧重：",
      SUPPORT_TYPE_GUIDE,
    ].join("\n\n");

    return {
      systemPrompt: systemContent,
      internal: {
        methodId: "template_system",
        emotion,
        intensity,
        support_type,
        template_id,
        classifier_comment: classified?.comment ?? "",
        classifier_used: !!classified,
      },
    } as ArenaMethodResult;
  },
};
