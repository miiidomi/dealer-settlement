import { AppError, type Identity } from "./env.ts";

export type MemberRecord = { id: number; email: string; role: string; active: number | boolean };

export function validateAdmin(rows: MemberRecord[], email: string, expectedId?: number): Identity {
  const normalized = email.trim().toLowerCase();
  const matches = rows.filter(r => r.email.trim().toLowerCase() === normalized);
  if (matches.length !== 1 || matches[0].role !== "admin" || !matches[0].active ||
      (expectedId !== undefined && matches[0].id !== expectedId))
    throw new AppError(403, "사용 가능한 관리자 권한이 없습니다. 사이트 관리자에게 확인해 주세요.");
  return { email: normalized, memberId: matches[0].id, name: normalized };
}

export async function requireAdmin(db: D1Database, email: string, expectedId?: number) {
  const r = await db.prepare("SELECT id,email,role,active FROM dealer_members WHERE lower(trim(email))=? LIMIT 3")
    .bind(email.trim().toLowerCase()).all<MemberRecord>();
  if (!r.success) throw new AppError(503, "관리자 권한을 확인하지 못했습니다.");
  return validateAdmin(r.results, email, expectedId);
}

export function validateRange(start: string, end: string) {
  const pattern = /^(20\d{2})-(0[1-9]|1[0-2])$/;
  if (!pattern.test(start) || !pattern.test(end) || start > end)
    throw new AppError(400, "기간을 YYYY-MM 형식으로 확인해 주세요.");
  const monthIndex = (s: string) => Number(s.slice(0,4)) * 12 + Number(s.slice(5,7));
  if (monthIndex(end) - monthIndex(start) >= 12)
    throw new AppError(400, "한 번에 최대 12개월까지 조회할 수 있습니다.");
  return { start, end };
}

export function assertBrowserOrigin(request: Request, base: string) {
  const origin = request.headers.get("origin");
  if (origin && ![base, "https://chatgpt.com", "https://chat.openai.com"].includes(origin))
    throw new AppError(403, "허용되지 않은 연결입니다.");
}

export function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
}
