import type { DashboardData } from "../../app/types.ts";
import { createSettlementCalculator } from "../../app/settlement-calculation.ts";
import { captureSettlementSnapshot, settlementCheck } from "../../app/settlement-snapshot.ts";
import { projectInstallmentSettlement } from "../../app/settlement-snapshot.ts";
import { costOrigin } from "./data.ts";
import { siteLink, type Env } from "./env.ts";

const money=(n:number)=>`${new Intl.NumberFormat("ko-KR").format(n)}원`;
export function freshness(data: DashboardData) {
  const timestamps=[...data.merchants.map(x=>x.lastSyncedAt),...data.installations.map(x=>x.lastSyncedAt),...data.cancellationPenalties.map(x=>x.lastSyncedAt)]
    .filter((x):x is string=>Boolean(x) && Number.isFinite(Date.parse(x!))).sort();
  return {queriedAt:new Date().toISOString(),latestObservedSyncAt:timestamps.at(-1)??null,
    syncMeaning:"사이트 저장 자료 기준입니다. 관측한 최신 레코드 시각이며 전체 동기화 성공을 뜻하지 않습니다."};
}

export function calculationWarnings(data: DashboardData, dealerId: number, start: string, end: string) {
  const calc=createSettlementCalculator(data,dealerId), current=calc.metricsFor(start,end);
  const warnings:{code:string;message:string;impact?:number}[]=[];
  // Do not alter the production formula. Make the known snapshot transition visible.
  if (start===end && !data.monthlySettlementStatuses.some(x=>x.settlementMonth===start && x.paid)) {
    const projected=createSettlementCalculator(projectInstallmentSettlement(data,dealerId,start),dealerId).metricsFor(start,end);
    if (projected.finalSettlement!==current.finalSettlement) warnings.push({code:"payment_transition_changes_total",
      message:"할부구매 정산월 배정 때문에 지급 완료 처리 시 현재 표시액과 달라질 수 있습니다. 사이트에서 반영 근거를 확인해 주세요.",
      impact:projected.finalSettlement-current.finalSettlement});
  }
  if (start!==end) {
    const monthly=current.months.reduce((sum,month)=>sum+calc.metricsFor(month,month).finalSettlement,0);
    if (monthly!==current.finalSettlement) {
      const monthlySupply=current.months.reduce((sum,month)=>sum+calc.metricsFor(month,month).settlementSupply,0);
      const roundingOnly=monthlySupply===current.settlementSupply;
      warnings.push({code:roundingOnly?"period_rounding_difference":"period_aggregation_difference",
        message:roundingOnly?"기간 전체의 VAT 반올림 방식으로 인해 월별 최종 정산액 합계와 차이가 있습니다.":"기간 전체 계산과 월별 정산액 합계가 다릅니다. 할부 반영 기간과 배분 계산 근거를 확인해 주세요.",impact:current.finalSettlement-monthly});
    }
  }
  if (!data.rules.some(r=>r.effectiveFrom.slice(0,7)<=end)) warnings.push({code:"missing_rule",message:"해당 기간에 적용 가능한 딜러 배분 규칙이 없습니다. 0% 적용 여부를 확인해 주세요."});
  if (!data.dealers.find(x=>x.id===dealerId)?.advanceEnabled && current.advance!==0)
    warnings.push({code:"disabled_advance_has_rows",message:"선지급 미사용 설정이지만 저장된 선지급이 계산에 차감됩니다. 기존 자료를 확인해 주세요."});
  return warnings;
}

export function settlementSummary(data: DashboardData, dealerId: number, start: string, end: string, env: Pick<Env,"SITE_BASE_URL">) {
  const calc=createSettlementCalculator(data,dealerId), m=calc.metricsFor(start,end);
  const dealer=calc.selectedDealer!;
  return {
    answer:calc.dealerMerchants.length?`${dealer.name} ${start===end?start:`${start}~${end}`} 현재 계산 기준 최종 정산액은 ${money(m.finalSettlement)}입니다.`
      :`${dealer.name}의 등록된 가맹점 자료가 없습니다. 정산금액을 확정하기 전에 자료를 확인해 주세요.`,
    period:{startMonth:start,endMonth:end,paymentBasis:"납입일",installationBasis:"설치일",penaltyBasis:"위약금 입금일"},
    totals:{paymentRevenue:m.paymentRevenue,purchaseRevenue:m.purchaseRevenue,installmentRevenue:m.installmentRevenue,
      vanFeeRevenue:m.vanFeeRevenue,penaltyRevenue:m.penaltyRevenue,revenue:m.revenue,dealerProfit:m.dealerProfit,
      dealerCost:m.dealerCost,settlementSupply:m.settlementSupply,settlementVat:m.settlementVat,
      settlementWithVat:m.settlementWithVat,advance:m.advance,finalSettlement:m.finalSettlement},
    calculationSteps:[
      {formula:"정산 공급가액 = 딜러 수익 − 딜러 원가",values:`${money(m.dealerProfit)} − ${money(m.dealerCost)} = ${money(m.settlementSupply)}`},
      {formula:"정산 VAT = 정산 공급가액 × 10%, 반올림",values:money(m.settlementVat)},
      {formula:"최종 정산액 = 정산 공급가액 + VAT − 선지급",values:`${money(m.settlementSupply)} + ${money(m.settlementVat)} − ${money(m.advance)} = ${money(m.finalSettlement)}`},
    ],
    calculationBasis:{payment:"납입 공급가액 × 납입일 기준 수익 배분율, 건별 반올림. 정액 수당 딜러는 해당 설치제품 수당을 적용합니다.",cost:"수량 × 설치일 유효 원가 × 원가 분담율, 건별 반올림. 정액 수당 딜러는 구매 제품 원가를 전액 반영합니다.",installment:"대금책정·영업수수료의 입금상태 및 정산월을 확인합니다. 이미 정산월에 배정된 금액은 해당 월에 반영됩니다.",purchase:"현재 사이트의 구매수익 산식은 등록 원가 × 수량을 사용합니다.",van:"해당 정산월에 등록된 VAN피와 딜러 설정을 적용합니다.",penalty:"위약금 정산 사용 시 해지완료 상태 및 입금일을 확인하고, 위약금의 50%를 건별 반올림해 딜러 수익으로 반영합니다."},
    why:dealer.flatCommissionEnabled ? "이 딜러는 조건에 맞는 정액 수당 규칙을 사용합니다. 구매 제품 원가 등은 별도로 반영됩니다."
      :"수익 배분율과 원가 분담율은 각 항목의 기준일에 유효한 딜러 규칙을 적용합니다.",
    dealerSettings:{flatCommission:dealer.flatCommissionEnabled,vanSettlement:dealer.vanSettlementEnabled,
      penaltySettlement:dealer.penaltySettlementEnabled,advance:dealer.advanceEnabled},
    counts:{merchants:calc.dealerMerchants.length,payments:m.rangePayments.length,installations:m.rangeInstallations.length,
      vanRecords:m.rangeVanSettlements.length,penalties:m.rangePenalties.length},
    calcWarnings:calculationWarnings(data,dealerId,start,end),dataStatus:!calc.dealerMerchants.length?"no_merchant_data":m.rangePayments.length||m.rangeInstallations.length||m.rangeVanSettlements.length||m.rangePenalties.length||m.rangeAdvances.length||m.settledCarryoverRevenue?"available":"no_period_activity",
    ...freshness(data),siteUrl:siteLink(env),
  };
}

export function explanationRows(data: DashboardData,dealerId:number,start:string,end:string,env:Pick<Env,"SITE_BASE_URL">,merchantId?:number) {
  const calc=createSettlementCalculator(data,dealerId),metrics=calc.metricsFor(start,end);
  const merchants=new Map(data.merchants.map(x=>[x.id,x])),products=new Map(data.products.map(x=>[x.id,x]));
  const rows:Record<string,unknown>[]=[];
  for (const month of metrics.months) {
    for (const row of captureSettlementSnapshot(data,dealerId,month,new Date().toISOString()).lines) {
      let id: number|undefined;
      const [kind,key]=row.key.split(":");
      if (kind==="installation") id=data.installations.find(x=>x.id===Number(key))?.merchantId;
      if (kind==="payment") id=data.payments.find(x=>x.id===Number(key))?.merchantId;
      if (kind==="penalty") id=data.cancellationPenalties.find(x=>x.salesforceCaseId===key)?.merchantId;
      if (merchantId!==undefined && id!==merchantId) continue;
      const installation=kind==="installation"?data.installations.find(x=>x.id===Number(key)):undefined;
      const payment=kind==="payment"?data.payments.find(x=>x.id===Number(key)):undefined;
      rows.push({month,key:row.key,merchantId:id??null,merchantName:row.merchantName,item:row.label,
        fields:row.fields,source:installation?.source==="salesforce"?"Salesforce 문의제품":payment?"사이트 납입 Excel":kind==="penalty"?"Salesforce 해지 문의":"사이트 저장 자료",
        ...(installation?{costOrigin:costOrigin(data,installation),product:products.get(installation.productId)?.name,
          sourceFields:installation.source==="salesforce"?{fixing:"Fixing__c",incentive:"Incentive__c",fixingStatus:"FixingPaymentStatus__c",incentiveStatus:"IncentivePaymentStatus__c",installDate:"ContractInstall_Dt__c"}:null}:{}),
        ...(payment?{grossAmount:payment.grossAmount,supplyAmount:payment.supplyAmount,vatAmount:payment.vatAmount,
          billingMonth:payment.billingMonth,paymentDate:payment.paymentDate,sourceFile:payment.sourceFile,
          why:"납입일의 월에 공급가액을 반영합니다. 청구월 기준 납입 합계와 다를 수 있습니다."}:{}),
        siteUrl:siteLink(env,id)});
    }
  }
  const exclusionCandidates=data.installations.filter(x=>calc.merchantIds.has(x.merchantId) && (merchantId===undefined||x.merchantId===merchantId)
    && x.transactionClassification==="할부구매" && (x.contractInstallAt??"").slice(0,7)<=end);
  for (const row of exclusionCandidates) {
    const amounts=[{name:"대금책정",amount:row.fixing,status:row.fixingPaymentStatus,assigned:row.fixingSettlementMonth},
      {name:"영업수수료",amount:row.incentive,status:row.incentivePaymentStatus,assigned:row.incentiveSettlementMonth}];
    for (const part of amounts) {
      let reason:string|null=null;
      if (part.amount<=0) reason="금액이 0원 이하라 수익 대상에서 제외합니다.";
      else if (!part.assigned && part.status!=="입금완료") reason="입금완료 상태가 아니어서 반영을 보류합니다.";
      else if (part.assigned && (part.assigned<start||part.assigned>end)) reason=`이미 ${part.assigned} 정산월에 배정되어 현재 기간에 다시 반영하지 않습니다.`;
      else if (!part.assigned && (row.contractInstallAt??"").slice(0,7)<start)
        reason="과거 설치 건에 입금완료 값이 있지만 정산월이 아직 배정되지 않았습니다. 지급 완료 전후 이월 반영을 확인해야 합니다.";
      if (reason) rows.push({month:null,key:`excluded:${row.id}:${part.name}`,merchantId:row.merchantId,
        merchantName:merchants.get(row.merchantId)?.name,item:part.name,amount:part.amount,status:part.status,
        why:reason,sourceFields:part.name==="대금책정"?"Fixing__c / FixingPaymentStatus__c":"Incentive__c / IncentivePaymentStatus__c",
        siteUrl:siteLink(env,row.merchantId)});
    }
  }
  return rows;
}

export function settlementIssues(data:DashboardData,dealerId:number,start:string,end:string,env:Pick<Env,"SITE_BASE_URL">) {
  const calc=createSettlementCalculator(data,dealerId),m=calc.metricsFor(start,end);
  const merchants=new Map(data.merchants.map(x=>[x.id,x])),products=new Map(data.products.map(x=>[x.id,x]));
  const issues:Record<string,unknown>[]=[];
  for (const row of m.rangeInstallations) {
    if (!row.unitCostRegistered) issues.push({code:"cost_unregistered",merchantId:row.merchantId,merchantName:merchants.get(row.merchantId)?.name,
      product:products.get(row.productId)?.name,why:"설치일에 적용할 원가가 등록되지 않았습니다.",
      action:"제품·신품/중고·설치일과 적용 딜러를 확인해 원가를 등록합니다.",siteUrl:siteLink(env,row.merchantId)});
    if (calc.selectedDealer?.flatCommissionEnabled && !["구매","할부구매","무상"].includes(row.transactionClassification??"") && !calc.commissionRuleFor(row,end))
      issues.push({code:"commission_rule_unmatched",merchantId:row.merchantId,merchantName:merchants.get(row.merchantId)?.name,
        product:products.get(row.productId)?.name,why:"제품·상태·임대료·약정기간에 맞는 수당 규칙이 없습니다.",
        action:"해당 딜러의 수당 규칙과 설치제품 조건을 확인합니다.",siteUrl:siteLink(env,row.merchantId)});
  }
  for (const merchant of data.merchants) {
    if (!data.payerAccounts.some(x=>x.merchantId===merchant.id && x.active)) issues.push({code:"no_active_payer",merchantId:merchant.id,merchantName:merchant.name,
      why:"사이트에 사용 중인 납부자번호가 없습니다. Salesforce CMS 원본의 누락을 확정한 것은 아닙니다.",
      action:"임대료 청구 대상인지 확인하고 CMS 동기화 결과나 수동 번호를 확인합니다.",siteUrl:siteLink(env,merchant.id)});
  }
  const numbers=new Map<string,number[]>();
  for (const payer of data.payerAccounts.filter(x=>x.active)) {
    const number=payer.payerNumber.replace(/[\s\u200B-\u200D\uFEFF-]/g,"");
    numbers.set(number,[...(numbers.get(number)??[]),payer.merchantId]);
  }
  for (const [number,ids] of numbers) if (ids.length>1) issues.push({code:"duplicate_payer",payerNumber:number,merchantIds:ids,
    why:"공백·하이픈을 제외한 번호가 중복됩니다.",action:"가맹점별 납부자번호를 확인합니다."});
  if (calc.selectedDealer?.vanSettlementEnabled && !m.rangeVanSettlements.length)
    issues.push({code:"van_data_not_recorded",why:"해당 기간의 VAN 실적이 없습니다. 실적이 없었는지 등록이 빠졌는지 확인이 필요합니다.",action:"월별 VAN사 실적을 확인합니다.",siteUrl:siteLink(env)});
  return {issues,pendingInstallments:{count:m.installmentPending.totalCount,amount:m.installmentPending.totalAmount,
    meaning:"미입금 할부구매는 오류로 단정하지 않고 입금 대기 자료로 구분합니다."},calcWarnings:calculationWarnings(data,dealerId,start,end)};
}

export function paidChanges(data:DashboardData,dealerId:number,month:string) {
  const status=data.monthlySettlementStatuses.find(x=>x.settlementMonth===month);
  const current=captureSettlementSnapshot(data,dealerId,month,new Date().toISOString());
  const check=settlementCheck(status,current);
  const messages:Record<string,string>={unpaid:"지급 완료로 저장된 정산이 아닙니다.",missing:"지급 당시 산출내역이 없어 변경 여부를 비교할 수 없습니다.",changed:"지급 후 산출내역에 변경이 있습니다.",unchanged:"최근 확인 기준 산출내역과 현재 산출내역이 같습니다."};
  return {answer:messages[check.state],state:check.state,paidAt:status?.settlementDate??null,
    originalAmount:check.original?.totals.finalSettlement??null,currentAmount:current.totals.finalSettlement,
    differenceFromPayment:check.difference,differencesSinceReview:check.differences,
    differencesSincePayment:check.originalDifferences,originalCapturedAt:check.original?.capturedAt??null,
    why:"지급 당시 저장된 산출내역과 현재 계산을 비교합니다. 차액은 자동 지급·차감하지 않습니다."};
}
