import type { DashboardData } from "./types";
import { monthsBetween, payerActiveInMonth } from "./types";
import { installmentPendingBreakdown, installmentRevenue as eligibleInstallmentRevenue, installmentSettledRevenueForPeriod } from "./installment-settlement";
import { penaltySummary } from "./salesforce-settlement";

/** One calculation for the screen and server-side payment snapshots. */
export function createSettlementCalculator(data: DashboardData, dealerId: number) {
    const dealerMerchants = data.merchants.filter(
      (merchant) => merchant.dealerId === dealerId,
    );
    const merchantIds = new Set(dealerMerchants.map((merchant) => merchant.id));
    const payers = data.payerAccounts.filter((payer) =>
      merchantIds.has(payer.merchantId),
    );
    const billingPayers = payers.filter(
      (payer) => payer.billingType !== "installment",
    );
    const payerById = new Map(payers.map((payer) => [payer.id, payer]));
    const productById = new Map(
      data.products.map((product) => [product.id, product]),
    );
    const selectedDealer = data.dealers.find((dealer) => dealer.id === dealerId);
    const usesFlatCommission =
      selectedDealer?.flatCommissionEnabled === true;
    const usesVanSettlement = selectedDealer?.vanSettlementEnabled !== false;
    const ruleFor = (date: string) =>
      data.rules
        .filter(
          (rule) =>
            rule.dealerId === dealerId &&
            rule.effectiveFrom.slice(0, 7) <= date.slice(0, 7),
        )
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    const rentalAmountFor = (
      installation: DashboardData["installations"][number],
      fallbackMonth: string,
    ) => {
      if (installation.salesAmount > 0) return installation.salesAmount;
      const installMonth =
        (installation.contractInstallAt || fallbackMonth).slice(0, 7) ||
        fallbackMonth;
      const payer = billingPayers.find(
        (item) =>
          item.merchantId === installation.merchantId &&
            payerActiveInMonth(item, installMonth),
      );
      return payer ? payer.monthlyCharge : 0;
    };
    const commissionRuleFor = (
      installation: DashboardData["installations"][number],
      fallbackMonth: string,
    ) => {
      const installedAt = (installation.contractInstallAt || fallbackMonth).slice(
        0,
        10,
      );
      const rentalAmount = rentalAmountFor(installation, fallbackMonth);
      const productCategory = productById.get(installation.productId)?.category;
      return data.dealerCommissionRules
        .filter(
          (rule) =>
            rule.dealerId === dealerId &&
            (rule.targetType === "product"
              ? rule.productId === installation.productId
              : rule.productCategory === productCategory) &&
            rule.condition === installation.condition &&
            rule.rentalAmount === rentalAmount &&
            rule.contractTermMonths === installation.contractTermMonths &&
            rule.effectiveFrom <= installedAt,
        )
        .sort(
          (a, b) =>
            Number(b.targetType === "product") - Number(a.targetType === "product") ||
            b.effectiveFrom.localeCompare(a.effectiveFrom),
        )[0];
    };
    const metricsFor = (start: string, end: string) => {
      const months = monthsBetween(start, end);
      const rangePayments = data.payments.filter(
        (payment) =>
          merchantIds.has(payment.merchantId) &&
          payment.paymentDate.slice(0, 7) >= start &&
          payment.paymentDate.slice(0, 7) <= end,
      );
      const billingRangePayments = data.payments.filter(
        (payment) =>
          merchantIds.has(payment.merchantId) &&
          payment.billingMonth >= start &&
          payment.billingMonth <= end,
      );
      const settlementPayments = rangePayments.filter(
        (payment) =>
          payerById.get(payment.payerAccountId)?.billingType !== "installment",
      );
      const billingSettlementPayments = billingRangePayments.filter(
        (payment) =>
          payerById.get(payment.payerAccountId)?.billingType !== "installment",
      );
      const rangeInstallations = data.installations.filter((item) => {
        const installMonth = (item.contractInstallAt || "").slice(0, 7);
        return (
          merchantIds.has(item.merchantId) &&
          installMonth >= start &&
          installMonth <= end
        );
      });
      const rangeAdvances = data.advancePayments.filter(
        (item) =>
          item.dealerId === dealerId &&
          item.settlementMonth >= start &&
          item.settlementMonth <= end,
      );
      const rangeVanSettlements = usesVanSettlement
        ? data.vanSettlements.filter(
            (item) =>
              item.dealerId === dealerId &&
              item.settlementMonth >= start &&
              item.settlementMonth <= end,
          )
        : [];
      const expected = billingPayers.reduce(
        (sum, payer) =>
          sum +
          months.filter((monthValue) => payerActiveInMonth(payer, monthValue))
            .length *
            payer.monthlyCharge,
        0,
      );
      const paid = settlementPayments.reduce(
        (sum, payment) => sum + payment.supplyAmount,
        0,
      );
      const vat = settlementPayments.reduce(
        (sum, payment) => sum + payment.vatAmount,
        0,
      );
      const billedPaid = billingSettlementPayments.reduce(
        (sum, payment) => sum + payment.supplyAmount,
        0,
      );
      const paymentRevenue = paid;
      const cost = rangeInstallations.reduce(
        (sum, item) => sum + item.quantity * item.unitCostSnapshot,
        0,
      );
      const installmentRevenue = rangeInstallations
        .filter((item) => item.transactionClassification === "할부구매")
        .reduce((sum, item) => sum + eligibleInstallmentRevenue(item), 0);
      const settledCarryoverRevenue = data.installations
        .filter(
          (item) =>
            merchantIds.has(item.merchantId) &&
            item.transactionClassification === "할부구매",
        )
        .reduce(
          (sum, item) =>
            sum + installmentSettledRevenueForPeriod(item, start, end),
          0,
        );
      const totalInstallmentRevenue = installmentRevenue + settledCarryoverRevenue;
      const installmentPendingSummary = installmentPendingBreakdown(
        rangeInstallations.filter(
          (item) => item.transactionClassification === "할부구매",
        ),
      );
      const purchaseRevenue = rangeInstallations
        .filter((item) => item.transactionClassification === "구매")
        .reduce((sum, item) => sum + item.salesAmount * item.quantity, 0);
      const vanFeeRevenue = rangeVanSettlements.reduce(
        (sum, item) => sum + item.vanFee,
        0,
      );
      const penalty = penaltySummary(data.cancellationPenalties.filter(row => merchantIds.has(row.merchantId) && row.dealerId === dealerId), selectedDealer?.penaltySettlementEnabled === true, start, end);
      const revenue =
        paymentRevenue + purchaseRevenue + totalInstallmentRevenue + vanFeeRevenue + penalty.revenue;
      const dealerCost = rangeInstallations.reduce((sum, item) => {
        if (usesFlatCommission)
          return item.transactionClassification === "구매"
            ? sum + item.quantity * item.unitCostSnapshot
            : sum;
        const rule = ruleFor(
          item.contractInstallAt || end,
        );
        return (
          sum +
          Math.round(
            (item.quantity *
              item.unitCostSnapshot *
              (rule?.costShareRate ?? 0)) /
              100,
          )
        );
      }, 0);
      const flatCommissionRevenue = usesFlatCommission
        ? rangeInstallations
            .filter(
              (item) =>
                !["구매", "할부구매", "무상"].includes(
                  item.transactionClassification ?? "",
                ),
            )
            .reduce((sum, item) => {
              const rule = commissionRuleFor(item, end);
              return sum + (rule?.commissionAmount ?? 0) * item.quantity;
            }, 0)
        : 0;
      const dealerProfitFromPayments = usesFlatCommission
        ? flatCommissionRevenue
        : settlementPayments.reduce(
            (sum, payment) =>
              sum +
              Math.round(
                  (payment.supplyAmount *
                  (ruleFor(payment.paymentDate)?.profitShareRate ?? 0)) /
                  100,
              ),
            0,
          );
      const dealerProfitFromInstallments = rangeInstallations
        .filter((item) => item.transactionClassification === "할부구매")
        .reduce((sum, item) => {
          if (usesFlatCommission) return sum;
          return (
            sum +
              Math.round(
                ((eligibleInstallmentRevenue(item) + installmentSettledRevenueForPeriod(item, start, end)) *
                  (ruleFor(item.contractInstallAt || end)
                    ?.profitShareRate ?? 0)) /
                  100,
              )
          );
        }, 0);
      const dealerProfitFromSettledCarryover = data.installations
        .filter(
          (item) =>
            merchantIds.has(item.merchantId) &&
            item.transactionClassification === "할부구매" &&
            !rangeInstallations.some((candidate) => candidate.id === item.id),
        )
        .reduce((sum, item) => {
          const revenue = installmentSettledRevenueForPeriod(item, start, end);
          return sum + Math.round((revenue * (ruleFor(item.contractInstallAt || end)?.profitShareRate ?? 0)) / 100);
        }, 0);
      const dealerProfitFromPurchases = rangeInstallations
        .filter((item) => item.transactionClassification === "구매")
        .reduce((sum, item) => {
          if (usesFlatCommission) return sum;
          return (
            sum +
            Math.round(
              ((item.salesAmount * item.quantity) *
                (ruleFor(item.contractInstallAt || end)
                  ?.profitShareRate ?? 0)) /
                100,
            )
          );
        }, 0);
      const dealerProfitFromVanFees = rangeVanSettlements.reduce(
        (sum, item) =>
          usesFlatCommission
            ? sum
            : sum +
              Math.round(
                (item.vanFee *
                  (ruleFor(item.settlementMonth)?.profitShareRate ?? 0)) /
                  100,
              ),
        0,
      );
      const dealerProfit =
        dealerProfitFromPayments +
        dealerProfitFromPurchases +
        dealerProfitFromInstallments +
        dealerProfitFromSettledCarryover +
        dealerProfitFromVanFees + penalty.dealerProfit;
      const advance = rangeAdvances.reduce((sum, item) => sum + item.amount, 0);
      const settlementSupply = dealerProfit - dealerCost;
      const settlementVat = Math.round(settlementSupply * 0.1);
      const settlementWithVat = settlementSupply + settlementVat;
      const finalSettlement = settlementWithVat - advance;
      return {
        months,
        rangePenalties: penalty.rows,
        penaltyRevenue: penalty.revenue,
        penaltyDealerProfit: penalty.dealerProfit,
        rangePayments: settlementPayments,
        billingRangePayments: billingSettlementPayments,
        rangeInstallations,
        rangeAdvances,
        rangeVanSettlements,
        usesVanSettlement,
        expected,
        paid,
        billedPaid,
        vat,
        cost,
        paymentRevenue,
        purchaseRevenue,
        installmentRevenue: totalInstallmentRevenue,
        settledCarryoverRevenue,
        installmentPending: installmentPendingSummary,
        vanFeeRevenue,
        flatCommissionRevenue,
        revenue,
        dealerCost,
        dealerProfit,
        advance,
        settlementSupply,
        settlementVat,
        settlementWithVat,
        finalSettlement,
      };
    };
    return { dealerMerchants, merchantIds, billingPayers, selectedDealer, usesVanSettlement, ruleFor, commissionRuleFor, metricsFor };
}
