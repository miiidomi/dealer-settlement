import MerchantDetail from "./merchant-detail";
import { requireChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function MerchantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireChatGPTUser(`/merchants/${id}`);
  return <MerchantDetail merchantId={Number(id)} />;
}
