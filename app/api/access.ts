import { eq, or } from "drizzle-orm";
import { getChatGPTUser } from "../chatgpt-auth";
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
  const user = await getChatGPTUser();
  if (!user) throw new AccessError(401, "로그인이 필요합니다.");
  const db = getDb();
  let [member] = await db.select().from(dealerMembers).where(or(
    eq(dealerMembers.userId, user.id),
    eq(dealerMembers.email, user.email.toLowerCase()),
  )).limit(1);

  if (!member) {
    const existing = await db.select({ id: dealerMembers.id }).from(dealerMembers).limit(1);
    if (!existing.length) {
      [member] = await db.insert(dealerMembers).values({
        userId: user.id,
        email: user.email.toLowerCase(),
        role: "admin",
        dealerId: null,
      }).returning();
    } else {
      return {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role: "viewer",
        dealerId: null,
      };
    }
  } else if (member.userId.startsWith("pending:")) {
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
