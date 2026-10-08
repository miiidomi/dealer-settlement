import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ appType: 'custom', configFile: false, root,
  resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { createSettlementCalculator } = await vite.ssrLoadModule('/app/settlement-calculation.ts');
const { captureSettlementSnapshot, settlementCheck } = await vite.ssrLoadModule('/app/settlement-snapshot.ts');
function fixture() {
  return { access: { role: 'admin' }, dealers: [{ id: 1, flatCommissionEnabled: false }],
    merchants: [{ id: 1, dealerId: 1 }], products: [{ id: 1, category: '포스' }],
    rules: [{ dealerId: 1, effectiveFrom: '2025-01-01', profitShareRate: 50, costShareRate: 50 }],
    installations: [{ id: 1, merchantId: 1, productId: 1, quantity: 2, condition: '신품',
      transactionClassification: '구매', contractInstallAt: '2026-09-01', salesAmount: 100000,
      unitCostSnapshot: 60000, unitCostOverridden: true, fixing: 0, incentive: 0 }],
    costs: [], dealerProductCosts: [], dealerCategoryCosts: [], billings: [], members: [],
    payerAccounts: [], payments: [], dealerCommissionRules: [], cancellationPenalties: [],
    advancePayments: [], vanSettlements: [], monthlySettlementStatuses: [] };
}
const metrics = data => createSettlementCalculator(data, 1).metricsFor('2026-09', '2026-09');
test('purchase income uses sales; direct supply cost is deducted once at the configured share', () => {
  const result = metrics(fixture());
  assert.equal(result.purchaseRevenue, 200000); assert.equal(result.cost, 120000);
  assert.equal(result.dealerProfit, 100000); assert.equal(result.dealerCost, 60000);
  assert.equal(result.settlementSupply, 40000); assert.equal(result.finalSettlement, 44000);
});
test('a cost-only purchase creates no income and still records installation expense', () => {
  const data = fixture(); data.installations[0].salesAmount = 0;
  const result = metrics(data);
  assert.equal(result.purchaseRevenue, 0); assert.equal(result.cost, 120000);
  assert.equal(result.settlementSupply, -60000);
});
test('direct and registered costs add together without treating either as income', () => {
  const data = fixture();
  data.installations.push({ ...data.installations[0], id: 2, quantity: 1,
    unitCostOverridden: false, unitCostSnapshot: 30000, salesAmount: 50000 });
  const result = metrics(data);
  assert.equal(result.cost, 150000); assert.equal(result.purchaseRevenue, 250000);
  assert.equal(result.settlementSupply, 50000);
});
test('cost edits preserve sales income and trigger payment snapshot review', () => {
  const data = fixture(); const old = captureSettlementSnapshot(data, 1, '2026-09', '2026-10-08T01:18:00.000Z');
  data.installations[0].unitCostSnapshot = 80000;
  const result = metrics(data); assert.equal(result.purchaseRevenue, 200000);
  assert.equal(result.cost, 160000); assert.equal(result.settlementSupply, 20000);
  const check = settlementCheck({ paid: true, dealerId: 1, settlementMonth: '2026-09',
    paidSnapshot: JSON.stringify(old), reviewedSnapshot: null }, captureSettlementSnapshot(data, 1, '2026-09', '2026-10-08T01:18:00.000Z'));
  assert.equal(check.state, 'changed'); assert.equal(check.difference, -22000);
});
test('other months and dealers do not enter the selected installation cost', () => {
  const data = fixture();
  data.installations.push({ ...data.installations[0], id: 2, contractInstallAt: '2026-10-01' });
  data.merchants.push({ id: 2, dealerId: 2 });
  data.installations.push({ ...data.installations[0], id: 3, merchantId: 2 });
  assert.equal(metrics(data).cost, 120000);
});
