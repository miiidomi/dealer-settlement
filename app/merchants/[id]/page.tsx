import MerchantDetail from "./merchant-detail";
import { requireAccessUser } from "../../cloudflare-auth";

export const dynamic = "force-dynamic";

export default async function MerchantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAccessUser();
  return <MerchantDetail merchantId={Number(id)} />;
}
