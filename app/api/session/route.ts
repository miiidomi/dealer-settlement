import { AccessError, requireAppAccess } from "../access";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const access = await requireAppAccess();
    return Response.json({ userId: access.userId, role: access.role, dealerId: access.dealerId });
  } catch (error) {
    return Response.json({ error: "로그인 상태를 확인할 수 없습니다." }, {
      status: error instanceof AccessError ? error.status : 500,
    });
  }
}
