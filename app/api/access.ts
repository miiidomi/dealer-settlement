import { eq, sql } from "drizzle-orm";
import { getAccessUser } from "../cloudflare-auth";
import { getDb } from "../../db";
import { dealerMembers, merchants } from "../../db/schema";

export type AppAccess = {
  userId: string;
  email: string;
  displayName: string;
  role: "admin" | "dealer" | "viewer";
  dealerId: number | null;
};

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function requireAppAccess(): Promise<AppAccess> {
  const user = await getAccessUser();
  if (!user) throw new AccessError(401, "로그인이 필요합니다.");
  const db = getDb();
  const matches = await db.select().from(dealerMembers)
    .where(sql`lower(${dealerMembers.email}) = ${user.email}`).limit(2);
  if (matches.length > 1) throw new AccessError(403, "중복된 로그인 이메일입니다. 관리자에게 문의해주세요.");
  let [member] = matches;

  if (!member) {
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      role: "viewer",
      dealerId: null,
    };
  } else if (member.active && member.userId !== user.id) {
    [member] = await db.update(dealerMembers).set({ userId: user.id }).where(eq(dealerMembers.id, member.id)).returning();
  }

  if (!member.active) throw new AccessError(403, "사용이 중지된 계정입니다.");
  return { userId: user.id, email: user.email, displayName: user.displayName, role: member.role, dealerId: member.dealerId };
}

export async function requireMerchantAccess(access: AppAccess, merchantId: number) {
  if (access.role === "viewer")
    throw new AccessError(403, "열람 계정은 데이터를 변경할 수 없습니다.");
  const db = getDb();
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
  if (!merchant || (access.role === "dealer" && merchant.dealerId !== access.dealerId)) {
    throw new AccessError(403, "이 가맹점에 접근할 수 없습니다.");
  }
  return merchant;
}

export function assertAdmin(access: AppAccess) {
  if (access.role !== "admin") throw new AccessError(403, "관리자만 변경할 수 있습니다.");
}
