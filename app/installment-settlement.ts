export type InstallmentComponent = "FIXING" | "INCENTIVE";

export type InstallmentPaymentFields = {
  id?: number;
  salesforceLineItemId?: string | null;
  fixing: number;
  incentive: number;
  fixingPaymentStatus?: string | null;
  fixingPaymentDate?: string | null;
  incentivePaymentStatus?: string | null;
  incentivePaymentDate?: string | null;
  fixingSettlementMonth?: string | null;
  incentiveSettlementMonth?: string | null;
};

export function componentAmount(
  item: InstallmentPaymentFields,
  component: InstallmentComponent,
) {
  return component === "FIXING" ? Math.max(0, item.fixing || 0) : Math.max(0, item.incentive || 0);
}

export function componentStatus(
  item: InstallmentPaymentFields,
  component: InstallmentComponent,
) {
  return component === "FIXING"
    ? item.fixingPaymentStatus ?? null
    : item.incentivePaymentStatus ?? null;
}

export function componentSettlementMonth(
  item: InstallmentPaymentFields,
  component: InstallmentComponent,
) {
  return component === "FIXING"
    ? item.fixingSettlementMonth ?? null
    : item.incentiveSettlementMonth ?? null;
}

export function isComponentEligible(
  item: InstallmentPaymentFields,
  component: InstallmentComponent,
) {
  const amount = componentAmount(item, component);
  if (amount <= 0 || componentSettlementMonth(item, component)) return false;
  return componentStatus(item, component) === "입금완료";
}

export function isComponentPending(
  item: InstallmentPaymentFields,
  component: InstallmentComponent,
) {
  return (
    componentAmount(item, component) > 0 &&
    componentStatus(item, component) !== "입금완료" &&
    !componentSettlementMonth(item, component)
  );
}

export function installmentRevenue(item: InstallmentPaymentFields) {
  return (["FIXING", "INCENTIVE"] as InstallmentComponent[]).reduce(
    (sum, component) =>
      sum + (isComponentEligible(item, component) ? componentAmount(item, component) : 0),
    0,
  );
}

export function installmentPending(item: InstallmentPaymentFields) {
  return (["FIXING", "INCENTIVE"] as InstallmentComponent[]).reduce(
    (sum, component) =>
      sum + (isComponentPending(item, component) ? componentAmount(item, component) : 0),
    0,
  );
}

export function installmentSettledRevenueForPeriod(
  item: InstallmentPaymentFields,
  start: string,
  end: string,
) {
  return (["FIXING", "INCENTIVE"] as InstallmentComponent[]).reduce(
    (sum, component) => {
      const settlementMonth = componentSettlementMonth(item, component);
      return settlementMonth && settlementMonth >= start && settlementMonth <= end
        ? sum + componentAmount(item, component)
        : sum;
    },
    0,
  );
}

export function installmentPendingBreakdown(items: InstallmentPaymentFields[]) {
  const rows = items.filter((item) => installmentPending(item) > 0);
  const uniqueRows = [...new Map(rows.map((item) => [item.salesforceLineItemId || `local:${item.id ?? rows.indexOf(item)}`, item])).values()];
  const uniqueFixingItems = [...new Map(items.filter((item) => isComponentPending(item, "FIXING")).map((item) => [item.salesforceLineItemId || `local:${item.id ?? items.indexOf(item)}`, item])).values()];
  const uniqueIncentiveItems = [...new Map(items.filter((item) => isComponentPending(item, "INCENTIVE")).map((item) => [item.salesforceLineItemId || `local:${item.id ?? items.indexOf(item)}`, item])).values()];
  return {
    rows: uniqueRows,
    totalCount: uniqueRows.length,
    totalAmount: uniqueRows.reduce((sum, item) => sum + installmentPending(item), 0),
    fixingCount: uniqueFixingItems.length,
    fixingAmount: uniqueFixingItems.reduce((sum, item) => sum + componentAmount(item, "FIXING"), 0),
    incentiveCount: uniqueIncentiveItems.length,
    incentiveAmount: uniqueIncentiveItems.reduce((sum, item) => sum + componentAmount(item, "INCENTIVE"), 0),
  };
}

export const salesforcePaymentFieldMap = {
  fixingPaymentStatus: "FixingPaymentStatus__c",
  fixingPaymentDate: "FixingPaymentDate__c",
  incentivePaymentStatus: "IncentivePaymentStatus__c",
  incentivePaymentDate: "IncentivePaymentDate__c",
} as const;

/** The API route uses this mapping when reading the four Salesforce fields. */
export function mapSalesforcePaymentFields() {
  return {
    fixingPaymentStatus: salesforcePaymentFieldMap.fixingPaymentStatus,
    fixingPaymentDate: salesforcePaymentFieldMap.fixingPaymentDate,
    incentivePaymentStatus: salesforcePaymentFieldMap.incentivePaymentStatus,
    incentivePaymentDate: salesforcePaymentFieldMap.incentivePaymentDate,
  } as const;
}
