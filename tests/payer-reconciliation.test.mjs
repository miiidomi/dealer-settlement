import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ensurePayerSyncControlsSql, blockPayerSyncSql, cmsPayerUpsertSql,
  paymentImportReason, resolveCmsMerchant } from '../app/payer-reconciliation.ts';

test('CMS refresh preserves manually edited, deleted and other merchant payer records', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE payer_accounts (id INTEGER PRIMARY KEY, merchant_id INTEGER,
      payer_number TEXT UNIQUE, label TEXT, monthly_charge INTEGER, billing_type TEXT,
      installment_months INTEGER, start_month TEXT, end_month TEXT, active INTEGER);
      INSERT INTO payer_accounts VALUES
      (1,1,'edited','Salesforce CMS',700,'rental',NULL,'2026-01',NULL,1),
      (2,1,'deleted','Salesforce CMS',800,'rental',NULL,'2026-01',NULL,0),
      (3,2,'other','Salesforce CMS',900,'rental',NULL,'2026-01',NULL,1),
      (4,1,'refresh','Salesforce CMS',100,'rental',NULL,'2026-01',NULL,1);`);
    db.exec(ensurePayerSyncControlsSql);
    db.prepare(blockPayerSyncSql).run(1,'edited',1,'edited','2026-10-07');
    db.prepare(blockPayerSyncSql).run(1,'deleted',1,'deleted','2026-10-07');
    const refresh = db.prepare(cmsPayerUpsertSql);
    for (const number of ['edited','deleted','other','refresh'])
      refresh.run(1,number,500,'2026-10',1,number,1,number);
    assert.deepEqual(db.prepare('SELECT monthly_charge,active FROM payer_accounts ORDER BY id').all()
      .map(row => [row.monthly_charge,row.active]), [[700,1],[800,0],[900,1],[500,1]]);
  } finally { db.close(); }
});

test('payment import identifies inactive, ambiguous and invalid rows while accepting valid refunds', () => {
  const row = {rowNumber:2,payerNumber:'12-34',paymentDate:'2026-09-30',billingMonth:'2026-09',amount:-11000};
  const active = {payerNumber:'1234',active:true};
  assert.equal(paymentImportReason(row,[active]),null);
  assert.ok(paymentImportReason(row,[{...active,active:false}]));
  assert.ok(paymentImportReason(row,[active,active]));
  assert.ok(paymentImportReason({...row,paymentDate:'2026-02-30'},[active]));
  assert.ok(paymentImportReason({...row,amount:NaN},[active]));
});

test('CMS matching does not cross dealer scope or guess ambiguous business numbers', () => {
  const account = {Id:'001000000000001',BusinessNumber__c:'123-45-67890',ManagingFranchise__c:'our-dealer'};
  const merchants = [{id:1,dealerId:2,salesforceId:account.Id,businessNumber:'1234567890'},
    {id:2,dealerId:1,salesforceId:null,businessNumber:'1234567890'}];
  assert.equal(resolveCmsMerchant(account,1,merchants,[account],[],'our-dealer').merchant.id,2);
  assert.equal(resolveCmsMerchant(account,1,merchants,[account,{...account,Id:'001000000000002'}],[],'our-dealer').merchant,null);
  assert.equal(resolveCmsMerchant(account,1,merchants,[account],[],'other-dealer').merchant,null);
});
