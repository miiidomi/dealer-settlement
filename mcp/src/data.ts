import { resolveInstallationCost } from "../../app/installation-cost.ts";
import { normalizeCmsBillingStart } from "../../app/payer-reconciliation.ts";
import { assetLifecycleLabel, installationIsFromAsset } from "../../app/asset-lifecycle.ts";
import type { DashboardData, Installation } from "../../app/types.ts";
import { AppError, type Identity } from "./env.ts";

const MAX_ROWS = 50000;
const booleanKeys = new Set(["hasPaidSnapshot","hasReviewedSnapshot","active","penaltySettlementEnabled","advanceEnabled","flatCommissionEnabled",
  "vanSettlementEnabled","vanCombineJulyAugust","settlementDirectionVisible","installmentPendingEnabled","directCostAllowed","vatSeparate","unitCostOverridden","isFromAsset","isFromAssetOverride","paid"]);
export function camelRow(row: Record<string,unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key,value]) => {
    const name = key.replace(/_([a-z])/g, (_m,letter:string) => letter.toUpperCase());
    return [name,booleanKeys.has(name) && value !== null ? Boolean(value) : value];
  }));
}
async function all(db: D1Database, query: string, args: unknown[] = []) {
  const r = await db.prepare(query).bind(...args).all<Record<string,unknown>>();
  if (!r.success) throw new AppError(503,"자료를 조회하지 못했습니다.");
  if (r.results.length > MAX_ROWS) throw new AppError(503,"조회 자료가 많습니다. 조회 범위를 조정해야 합니다.");
  return r.results.map(camelRow);
}

export async function listDealers(db: D1Database) {
  return all(db,"SELECT id,name,active,flat_commission_enabled,advance_enabled,van_settlement_enabled,penalty_settlement_enabled FROM dealers ORDER BY id LIMIT 50001");
}
export async function resolveDealer(db: D1Database, selector: string | number) {
  const rows = await listDealers(db);
  const text = String(selector).trim();
  const exact = rows.filter(r => typeof selector === "number" ? r.id === selector : r.name === text);
  const candidates = exact.length ? exact : rows.filter(r => typeof selector === "string" && String(r.name).includes(text));
  if (candidates.length !== 1) throw new AppError(400,candidates.length ? "딜러가 여러 명입니다. 딜러 이름을 정확히 선택해 주세요." : "해당 딜러를 찾지 못했습니다.");
  return Number(candidates[0].id);
}

/** Same normalization and cost precedence as app/api/dashboard/route.ts snapshot(). */
export function normalizeDashboard(data: DashboardData): DashboardData {
  const merchants = new Map(data.merchants.map(r=>[r.id,r]));
  const products = new Map(data.products.map(r=>[r.id,r]));
  const costs = [...data.costs].sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
  const dealerCosts = [...data.dealerProductCosts].sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
  const categories = [...data.dealerCategoryCosts].sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom));
  return {...data, installations:data.installations.map(row=>{
    const normalized = row.source === "salesforce" && (!row.lastSyncedAt || row.lastSyncedAt < "2026-09-05T00:00:00.000Z")
      ? {...row,salesAmount:Math.round(row.salesAmount/1.1)} : row;
    if (installationIsFromAsset(normalized)) return {...normalized,unitCostSnapshot:0,unitCostRegistered:true};
    const date = (normalized.contractInstallAt ?? "").slice(0,10);
    const merchant = merchants.get(row.merchantId), product = products.get(row.productId);
    const dealerCost = dealerCosts.find(c=>c.dealerId===merchant?.dealerId && c.productId===row.productId && c.condition===row.condition && c.effectiveFrom<=date);
    const category = categories.find(c=>c.dealerId===merchant?.dealerId && c.productCategory===product?.category && c.condition===row.condition && c.effectiveFrom<=date);
    const general = costs.find(c=>c.productId===row.productId && c.condition===row.condition && c.effectiveFrom<=date);
    return resolveInstallationCost(normalized, product, dealerCost ?? category ?? general);
  }), payerAccounts:data.payerAccounts.map(r=>normalizeCmsBillingStart(
    r.label === "Salesforce CMS" ? {...r,monthlyCharge:Math.round(r.monthlyCharge/1.1)} : r,
    merchants.get(r.merchantId)?.installDate)),
  advancePayments:data.advancePayments.map(r=>({...r,settlementMonth:r.settlementMonth || r.paymentDate.slice(0,7)}))};
}

export function costOrigin(data: DashboardData, row: Installation) {
  if (installationIsFromAsset(row)) return "기존 자산 사용 · 원가 제외";
  const merchant=data.merchants.find(x=>x.id===row.merchantId), product=data.products.find(x=>x.id===row.productId);
  const date=(row.contractInstallAt??"").slice(0,10);
  if (row.unitCostOverridden) return "사이트 설치제품 직접 입력";
  if (product?.directCostAllowed) return "직접 입력 원가 미등록";
  if (data.dealerProductCosts.some(x=>x.dealerId===merchant?.dealerId && x.productId===row.productId && x.condition===row.condition && x.effectiveFrom<=date)) return "딜러별 제품 원가 이력";
  if (data.dealerCategoryCosts.some(x=>x.dealerId===merchant?.dealerId && x.productCategory===product?.category && x.condition===row.condition && x.effectiveFrom<=date)) return "딜러별 제품군 원가 이력";
  if (data.costs.some(x=>x.productId===row.productId && x.condition===row.condition && x.effectiveFrom<=date)) return "공통 제품 원가 이력";
  return row.unitCostRegistered ? "기존 설치제품 저장 원가" : "원가 미등록";
}

export async function loadDashboard(db: D1Database, dealerId: number, identity: Identity): Promise<DashboardData> {
  // All queries in one D1 batch use one transaction. No writes are issued to the settlement DB.
  const tableQueries: [keyof DashboardData,string,unknown[]][] = [
    ["dealers","SELECT * FROM dealers WHERE id=? ORDER BY id",[dealerId]],
    ["rules","SELECT * FROM dealer_rules WHERE dealer_id=? ORDER BY effective_from DESC,id",[dealerId]],
    ["products","SELECT * FROM products ORDER BY id",[]],
    ["costs","SELECT * FROM product_costs ORDER BY effective_from DESC,id",[]],
    ["dealerProductCosts","SELECT * FROM dealer_product_costs WHERE dealer_id=? ORDER BY effective_from DESC,id",[dealerId]],
    ["dealerCategoryCosts","SELECT * FROM dealer_category_costs WHERE dealer_id=? ORDER BY effective_from DESC,id",[dealerId]],
    ["dealerCommissionRules","SELECT * FROM dealer_commission_rules WHERE dealer_id=? ORDER BY effective_from DESC,id",[dealerId]],
    ["merchants","SELECT * FROM merchants WHERE dealer_id=? ORDER BY install_date DESC,id",[dealerId]],
    ["installations","SELECT i.* FROM installations i JOIN merchants m ON m.id=i.merchant_id WHERE m.dealer_id=? ORDER BY i.id",[dealerId]],
    ["billings","SELECT b.* FROM billings b JOIN merchants m ON m.id=b.merchant_id WHERE m.dealer_id=? ORDER BY b.billing_month DESC,b.id DESC",[dealerId]],
    ["payerAccounts","SELECT p.* FROM payer_accounts p JOIN merchants m ON m.id=p.merchant_id WHERE m.dealer_id=? ORDER BY p.id",[dealerId]],
    ["payments","SELECT p.* FROM payments p JOIN merchants m ON m.id=p.merchant_id WHERE m.dealer_id=? ORDER BY p.payment_date DESC,p.id DESC",[dealerId]],
    ["advancePayments","SELECT * FROM advance_payments WHERE dealer_id=? ORDER BY payment_date DESC,id DESC",[dealerId]],
    ["monthlySettlementStatuses","SELECT * FROM monthly_settlement_statuses WHERE dealer_id=? ORDER BY settlement_month DESC,id DESC",[dealerId]],
    ["vanSettlements","SELECT * FROM van_settlements WHERE dealer_id=? ORDER BY settlement_month DESC,van_company",[dealerId]],
    ["cancellationPenalties","SELECT * FROM cancellation_penalties WHERE dealer_id=? ORDER BY id",[dealerId]],
  ];
  const results = await db.batch(tableQueries.map(([,query,args])=>db.prepare(`${query} LIMIT 50001`).bind(...args)));
  const data: Record<string,unknown> = {access:{userId:String(identity.memberId),email:identity.email,displayName:identity.name,role:"admin",dealerId:null},members:[]};
  results.forEach((result,i)=>{
    if (!result.success || result.results.length > MAX_ROWS) throw new AppError(503,"자료를 완전하게 조회하지 못했습니다. 데이터 상태를 확인해 주세요.");
    data[tableQueries[i][0]]=result.results.map(r=>camelRow(r as Record<string,unknown>));
  });
  if (!(data.dealers as unknown[]).length) throw new AppError(404,"딜러를 찾지 못했습니다.");
  return normalizeDashboard(data as unknown as DashboardData);
}

/** A merchant is Y when at least one saved installation effectively reuses an asset.
 * The manual override (including false) takes precedence, exactly as in the site. */
export const ownershipTransferSql = "COALESCE(i.is_from_asset_override,i.is_from_asset,0)=1";
export function installationDetails(data: DashboardData, row: Installation) {
  const product=data.products.find(x=>x.id===row.productId);
  return {...row,productName:product?.name??null,productCategory:product?.category??null,
    ownershipTransfer:installationIsFromAsset(row)?"Y":"N",assetStatus:assetLifecycleLabel(row),
    ownershipTransferSource:row.isFromAssetOverride==null?"Salesforce 동기화·저장값":"사이트 수동 설정",
    costExcluded:installationIsFromAsset(row),costOrigin:costOrigin(data,row)};
}
export async function searchMerchants(db: D1Database, query: string, dealerId: number | undefined, offset: number, limit: number, ownershipTransfer?: "Y"|"N") {
  const escaped=query.trim().replace(/[\\%_]/g,"\\$&");
  const args: unknown[]=[`%${escaped}%`,`%${escaped}%`];
  let where="(m.name LIKE ? ESCAPE '\\' OR m.business_number LIKE ? ESCAPE '\\')";
  const exists=`EXISTS (SELECT 1 FROM installations i WHERE i.merchant_id=m.id AND ${ownershipTransferSql})`;
  if (dealerId !== undefined) {where+=" AND m.dealer_id=?";args.push(dealerId);}
  if (ownershipTransfer!==undefined) where+=` AND ${ownershipTransfer==="N"?"NOT ":""}${exists}`;
  const rows=await all(db,`SELECT m.*,d.name dealer_name,CASE WHEN ${exists} THEN 'Y' ELSE 'N' END ownership_transfer,
    (SELECT COUNT(*) FROM installations i WHERE i.merchant_id=m.id AND ${ownershipTransferSql}) ownership_transfer_installation_count
    FROM merchants m JOIN dealers d ON d.id=m.dealer_id WHERE ${where} ORDER BY m.id LIMIT ? OFFSET ?`,[...args,limit+1,offset]);
  return {rows:rows.slice(0,limit),nextOffset:rows.length>limit?offset+limit:null,
    ownershipTransferMeaning:"저장된 설치제품 중 명의변경=Y가 1건 이상이면 가맹점을 Y로 표시합니다. 기존 자산의 명변됨 상태와는 별개입니다."};
}

export async function paymentImportRows(db: D1Database, dealerId: number, offset: number, limit: number) {
  return all(db,"SELECT id,file_name,total_rows,matched_rows,unmatched_rows,duplicate_rows,created_at FROM payment_imports WHERE dealer_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",[dealerId,limit+1,offset]);
}

