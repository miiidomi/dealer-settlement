import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
test('penalty display agrees with eligible payment-month totals and marks missing dates excluded', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const vite = await createServer({ appType: 'custom', configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
  try {
    const { PenaltyTable } = await vite.ssrLoadModule('/app/penalty-table.tsx');
    const base = { id: 1, dealerId: 1, merchantId: 1, rawPaymentDate: null, lastSyncedAt: '2026-10-02', status: '해지완료', amount: 100000 };
    const rows = [{ ...base, salesforceCaseId: 'paid', caseNumber: '0001', paymentDate: '2026-09-30' }, { ...base, id: 2, salesforceCaseId: 'undated', caseNumber: '0002', paymentDate: null }, { ...base, id: 3, salesforceCaseId: 'other-month', caseNumber: '0003', paymentDate: '2026-10-01' }];
    const html = renderToStaticMarkup(React.createElement(PenaltyTable, { rows, merchants: [{ id: 1, name: '테스트 가맹점' }], start: '2026-09', end: '2026-09' }));
    assert.match(html, /딜러 정산 반영 50,000원/);
    assert.match(html, /입금일 확인 필요 · 제외/);
    assert.match(html, /0001/);
    assert.match(html, /0002/);
    assert.doesNotMatch(html, /0003/);
  } finally { await vite.close(); }
});
