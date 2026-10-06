import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../app/salesforce-settlement.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { penaltyPaymentDate, penaltySummary } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('text deposit dates are validated without guessing missing components', () => {
  for (const value of ['2026-9-2', '2026.09.02', '2026/9/2', '20260902', '2026년 9월 2일']) assert.equal(penaltyPaymentDate(value), '2026-09-02');
  for (const value of ['', null, '2026-02-30', '2026-13-01', '9/2', '2026-09', '미입금']) assert.equal(penaltyPaymentDate(value), null);
});
test('penalty counts completed cases once in payment month and splits 50 percent', () => {
  const row = (id, status, amount, date) => ({ salesforceCaseId: id, merchantId: 1, status, amount, paymentDate: date });
  const rows = [row('a','해지완료',100000,'2026-09-30'), row('a','해지완료',100000,'2026-09-30'), row('b','해지완료(미회수)',200000,'2026-10-01'), row('c','진행중',900000,'2026-09-01'), row('d','해지완료',300000,null), row('e','해지완료',0,'2026-09-01')];
  assert.equal(penaltySummary(rows, false, '2026-01', '2026-12').revenue, 0);
  assert.equal(penaltySummary(rows, true, '2026-09', '2026-09').revenue, 100000);
  assert.equal(penaltySummary(rows, true, '2026-09', '2026-09').dealerProfit, 50000);
  assert.equal(penaltySummary(rows, true, '2026-10', '2026-10').dealerProfit, 100000);
  assert.equal(penaltySummary(rows, true, '2026-01', '2026-12').dealerProfit, 150000);
  assert.equal(penaltySummary([row('a','접수',100000,'2026-09-30')], true, '2026-09', '2026-09').dealerProfit, 0);
});
