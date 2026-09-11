import { env } from "cloudflare:workers";
import { asc } from "drizzle-orm";
import { getDb } from "../../../../db";
import { dealers } from "../../../../db/schema";

function runtimeValue(name: string) {
  return String((env as unknown as Record<string, unknown>)[name] ?? "").trim();
}

function secretFromRequest(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.toLowerCase().startsWith("bearer "))
    return authorization.slice("bearer ".length).trim();
  return (
    request.headers.get("x-auto-sync-secret") ??
    new URL(request.url).searchParams.get("syncToken") ??
    ""
  ).trim();
}

function isAuthorized(request: Request) {
  const secret = runtimeValue("AUTO_SYNC_SECRET");
  return secret.length >= 24 && secretFromRequest(request) === secret;
}

function koreanHour(date = new Date()) {
  return (date.getUTCHours() + 9) % 24;
}

function shouldRunNow(date = new Date()) {
  const hour = koreanHour(date);
  return hour >= 9 && hour <= 18;
}

async function runAutoSync(request: Request) {
  if (!isAuthorized(request))
    return Response.json(
      { error: "자동 동기화 인증 토큰을 확인해주세요." },
      { status: 401 },
    );
  if (!shouldRunNow())
    return Response.json({
      message: "자동 동기화 실행 시간이 아니어서 건너뛰었습니다.",
      skipped: true,
      timezone: "Asia/Seoul",
      allowedHours: "09:00-18:59",
      checkedAt: new Date().toISOString(),
    });

  const db = getDb();
  const activeDealers = (await db.select().from(dealers).orderBy(asc(dealers.id)))
    .filter((dealer) => dealer.active);
  const secret = runtimeValue("AUTO_SYNC_SECRET");
  const endpoint = new URL("/api/salesforce/sync", request.url);
  const results = [];

  for (const dealer of activeDealers) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-auto-sync-secret": secret,
        },
        body: JSON.stringify({ dealerId: dealer.id }),
      });
      const result = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      results.push({
        dealerId: dealer.id,
        dealerName: dealer.name,
        ok: response.ok,
        status: response.status,
        ...result,
      });
    } catch (error) {
      results.push({
        dealerId: dealer.id,
        dealerName: dealer.name,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "자동 동기화 중 오류가 발생했습니다.",
      });
    }
  }

  const failed = results.filter((result) => !result.ok);
  return Response.json(
    {
      message: failed.length
        ? "Salesforce 자동 동기화 중 일부 딜러가 실패했습니다."
        : "Salesforce 자동 동기화가 완료되었습니다.",
      syncedAt: new Date().toISOString(),
      timezone: "Asia/Seoul",
      dealerCount: activeDealers.length,
      failedCount: failed.length,
      results,
    },
    { status: failed.length ? 207 : 200 },
  );
}

export async function GET(request: Request) {
  return runAutoSync(request);
}

export async function POST(request: Request) {
  return runAutoSync(request);
}
