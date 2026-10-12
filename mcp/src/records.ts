import { AppError, type Env } from './env.ts';
import { assetLifecycleLabel, installationIsFromAsset } from '../../app/asset-lifecycle.ts';
import type { Installation } from '../../app/types.ts';
import { camelRow } from './data.ts';
import { parseSettlementSnapshot } from '../../app/settlement-snapshot.ts';

// Identifiers are fixed in this allowlist. User input is only bound as values.
export const RECORD_SECTIONS = {
  dealerSettings:{table:'dealers',dealerColumn:'r.id',order:'r.id'},
  rules:{table:'dealer_rules',dealerColumn:'r.dealer_id',order:'r.effective_from DESC,r.id DESC'},
  products:{table:'products',productColumn:'r.id',order:'r.id'},
  costs:{table:'product_costs',productColumn:'r.product_id',order:'r.effective_from DESC,r.id DESC'},
  dealerProductCosts:{table:'dealer_product_costs',dealerColumn:'r.dealer_id',productColumn:'r.product_id',order:'r.effective_from DESC,r.id DESC'},
  dealerCategoryCosts:{table:'dealer_category_costs',dealerColumn:'r.dealer_id',order:'r.effective_from DESC,r.id DESC'},
  dealerCommissionRules:{table:'dealer_commission_rules',dealerColumn:'r.dealer_id',productColumn:'r.product_id',order:'r.effective_from DESC,r.id DESC'},
  merchants:{table:'merchants',dealerColumn:'r.dealer_id',merchantColumn:'r.id',order:'r.id'},
  installations:{table:'installations',joinMerchant:true,productColumn:'r.product_id',order:'r.id'},
  billings:{table:'billings',joinMerchant:true,order:'r.billing_month DESC,r.id DESC'},
  payerAccounts:{table:'payer_accounts',joinMerchant:true,order:'r.id'},
  payments:{table:'payments',joinMerchant:true,order:'r.payment_date DESC,r.id DESC'},
  advancePayments:{table:'advance_payments',dealerColumn:'r.dealer_id',order:'r.payment_date DESC,r.id DESC'},
  monthlySettlementStatuses:{table:'monthly_settlement_statuses',dealerColumn:'r.dealer_id',order:'r.settlement_month DESC,r.id DESC'},
  vanSettlements:{table:'van_settlements',dealerColumn:'r.dealer_id',order:'r.settlement_month DESC,r.id DESC'},
  cancellationPenalties:{table:'cancellation_penalties',dealerColumn:'r.dealer_id',merchantColumn:'r.merchant_id',order:'r.id'},
  paymentImports:{table:'payment_imports',dealerColumn:'r.dealer_id',order:'r.created_at DESC,r.id DESC'},
  members:{table:'dealer_members',dealerColumn:'r.dealer_id',order:'r.id'},
  payerSyncControls:{table:'payer_sync_controls',dealerColumn:'r.dealer_id',merchantColumn:'r.merchant_id',order:'r.updated_at DESC,r.dealer_id,r.payer_number'},
} as const;
export type RecordSection=keyof typeof RECORD_SECTIONS;
type Spec={table:string;dealerColumn?:string;merchantColumn?:string;productColumn?:string;joinMerchant?:boolean;order:string};
export async function recordPage(db:D1Database,section:RecordSection,filters:{dealerId?:number;merchantId?:number;productId?:number},offset:number,limit:number) {
  const spec:Spec=RECORD_SECTIONS[section];
  if(!spec) throw new AppError(400,'조회할 자료 종류를 확인해 주세요.');
  const from=`${spec.table} r${spec.joinMerchant?' JOIN merchants m ON m.id=r.merchant_id':''}${spec.productColumn?' LEFT JOIN products product ON product.id='+spec.productColumn:''}`;
  const where:string[]=[],args:unknown[]=[];
  for(const [value,column,label] of [
    [filters.dealerId,spec.joinMerchant?'m.dealer_id':spec.dealerColumn,'딜러'],
    [filters.merchantId,spec.joinMerchant?'r.merchant_id':spec.merchantColumn,'가맹점'],
    [filters.productId,spec.productColumn,'제품'],
  ] as const) {
    if(value===undefined) continue;
    // Common catalog rows belong to no dealer; include them alongside scoped rules.
    if(!column) {
      if(label==='딜러' && ['products','costs'].includes(section)) continue;
      throw new AppError(400,`${section}에는 ${label} 필터를 사용할 수 없습니다.`);
    }
    where.push(`${column}=?`);args.push(value);
  }
  const clause=where.length?' WHERE '+where.join(' AND '):'';
  const selection=section==='monthlySettlementStatuses'
    ? 'r.id,r.dealer_id,r.settlement_month,r.settlement_date,r.paid,r.tax_invoice_issued_at,r.memo,r.created_at,r.updated_at,CASE WHEN r.paid_snapshot IS NOT NULL THEN 1 ELSE 0 END has_paid_snapshot,CASE WHEN r.reviewed_snapshot IS NOT NULL THEN 1 ELSE 0 END has_reviewed_snapshot'
    : 'r.*'+(spec.joinMerchant?',m.name merchant_name':'')+(spec.productColumn?',product.name product_name,product.category product_category':'');
  const results=await db.batch<Record<string,unknown>>([
    db.prepare(`SELECT ${selection} FROM ${from}${clause} ORDER BY ${spec.order} LIMIT ? OFFSET ?`).bind(...args,limit,offset),
    db.prepare(`SELECT COUNT(*) total FROM ${from}${clause}`).bind(...args),
  ]);
  if(results.some(r=>!r.success)) throw new AppError(503,'저장 자료를 조회하지 못했습니다.');
  const totalRows=Number(results[1].results[0]?.total??0);
  return {section,rows:results[0].results.map(r=>{const row=camelRow(r as Record<string,unknown>);if(section!=='installations')return row; const installation=row as Installation;return {...row,ownershipTransfer:installationIsFromAsset(installation)?'Y':'N',assetStatus:assetLifecycleLabel(installation),costExcluded:installationIsFromAsset(installation),unitCostBasis:'저장된 단위 원가입니다. 명의변경의 적용 원가는 0이며 최신 원가 이력 적용값은 get_merchant_details로 확인합니다.'};}),totalRows,
    nextOffset:offset+limit<totalRows?offset+limit:null,scope:filters.dealerId===undefined?'all_dealers':'dealer',
    valueBasis:'사이트 DB 저장 원본값입니다. 계산된 정산금액은 get_settlement를 사용합니다. Salesforce CMS 월청구액 저장값은 VAT 포함일 수 있으며 get_merchant_details는 공급가액으로 정규화합니다.',
    ...(section==='monthlySettlementStatuses'?{snapshotTool:'get_settlement_snapshot'}:{}),
    queriedAt:new Date().toISOString()};
}
export async function savedSnapshot(db:D1Database,dealerId:number,month:string,kind:'paid'|'reviewed',offset:number,limit:number) {
  const row=await db.prepare('SELECT paid_snapshot,reviewed_snapshot FROM monthly_settlement_statuses WHERE dealer_id=? AND settlement_month=?').bind(dealerId,month).first<{paid_snapshot:string|null;reviewed_snapshot:string|null}>();
  const raw=kind==='paid'?row?.paid_snapshot:row?.reviewed_snapshot;
  if(!raw) return {status:'not_persisted',dealerId,month,kind,message:'해당 시점의 산출내역이 저장되지 않았습니다. 현재 값으로 과거 자료를 추정하지 않습니다.'};
  const snapshot=parseSettlementSnapshot(raw);
  if(!snapshot || snapshot.dealerId!==dealerId || snapshot.month!==month) throw new AppError(503,'저장된 산출내역의 형식 또는 딜러·월 연결을 확인해 주세요.');
  return {status:'available',dealerId,month,kind,capturedAt:snapshot.capturedAt,snapshotKind:snapshot.kind,totals:snapshot.totals,
    rows:snapshot.lines.slice(offset,offset+limit),totalRows:snapshot.lines.length,nextOffset:offset+limit<snapshot.lines.length?offset+limit:null};
}
export const COVERAGE={
  availableSections:Object.keys(RECORD_SECTIONS),
  additionalTools:['get_merchant_details','get_settlement_snapshot','get_sync_status','get_settlement','explain_settlement','check_settlement','get_paid_changes','get_payment_imports'],
  unavailable:[
    {section:'paymentImportExceptions',status:'not_persisted',message:'납입 Excel 미매칭·중복 행의 원본 번호와 행별 사유를 DB에 저장하지 않습니다. 업로드 집계와 정상 반영 납입은 조회 가능합니다.'},
    {section:'assetEventHistory',status:'not_persisted',message:'개별 Salesforce 자산 ID 및 전체 전환 이력은 저장하지 않습니다. 설치제품의 자산 집계 상태, 수동 설정, 문의 연결은 조회 가능합니다.'},
    {section:'syncRunHistory',status:'not_persisted',message:'동기화 작업별 성공·실패 로그를 DB에 저장하지 않습니다. get_sync_status에서 레코드별 동기화 시각과 미관측 건수를 확인할 수 있습니다.'},
  ],
  excluded:'OAuth 토큰·클라이언트 비밀값은 업무 데이터가 아니며 반환하지 않습니다.',
};
export async function syncStatus(db:D1Database,dealerId?:number) {
  const sources=[['merchants','merchants r','r.dealer_id'],['installations','installations r JOIN merchants m ON m.id=r.merchant_id','m.dealer_id'],['cancellationPenalties','cancellation_penalties r','r.dealer_id']] as const;
  const results=await db.batch<Record<string,unknown>>(sources.map(([,from,column])=>db.prepare(`SELECT COUNT(*) total,COUNT(r.last_synced_at) observed,MIN(r.last_synced_at) earliest,MAX(r.last_synced_at) latest FROM ${from}${dealerId===undefined?'':` WHERE ${column}=?`}`).bind(...(dealerId===undefined?[]:[dealerId]))));
  if(results.some(r=>!r.success)) throw new AppError(503,'동기화 시각을 조회하지 못했습니다.');
  return {sources:results.map((r,i)=>({...r.results[0],section:sources[i][0]})),
    runHistory:COVERAGE.unavailable[2],meaning:'저장 레코드의 동기화 시각 관측값이며, 전체 동기화 성공이나 실행 이력을 뜻하지 않습니다.',queriedAt:new Date().toISOString()};
}
