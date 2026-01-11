import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

function getWebhookUrl() {
  return (
    process.env.ARENA_BACKUP_WEBHOOK_URL ||
    process.env.ARENA_WEBHOOK_URL ||
    ""
  ).trim();
}

export async function POST(req: NextRequest) {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    return NextResponse.json(
      { ok: false, error: "ARENA_BACKUP_WEBHOOK_URL is not configured" },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      return NextResponse.json(
        { ok: false, error: `Webhook responded with ${resp.status}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
