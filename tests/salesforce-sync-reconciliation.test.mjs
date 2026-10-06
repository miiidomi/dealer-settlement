import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const source = readFileSync(new URL('../app/salesforce-sync-reconciliation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { obsoleteInstallationsSql, validateSalesforcePage } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE merchants (id INTEGER PRIMARY KEY, dealer_id INTEGER, salesforce_id TEXT);
    CREATE TABLE installations (id INTEGER PRIMARY KEY, merchant_id INTEGER, source TEXT,
      salesforce_line_item_id TEXT, salesforce_case_id TEXT, last_synced_at TEXT);
    INSERT INTO merchants VALUES (103,1,'001TJ0000160t7KYAQ'), (104,2,'other');`);
  return db;
}

test('complete presence reconciliation removes replaced rows and protects manual, other dealer and newer sync data', () => {
  const db = fixture();
  const insert = db.prepare('INSERT INTO installations VALUES (?, ?, ?, ?, ?, ?)');
  for (const row of [
    [1,103,'salesforce','old-1','case','2026-09-11'],
    [2,103,'salesforce','current-17','case','2026-10-02'],
    [3,103,'manual','manual','case','2026-09-11'],
    [4,104,'salesforce','other-dealer','case','2026-09-11'],
    [5,103,'salesforce','newer-sync','case','2026-10-03'],
    [6,103,'salesforce','present-unimportable','case','2026-09-11'],
  ]) insert.run(...row);
  const statement = db.prepare(obsoleteInstallationsSql);
  assert.equal(statement.run(1,'2026-10-02',JSON.stringify(['current-17','present-unimportable'])).changes, 1);
  assert.deepEqual(db.prepare('SELECT id FROM installations ORDER BY id').all().map(r=>r.id), [2,3,4,5,6]);
  assert.equal(statement.run(1,'2026-10-02',JSON.stringify(['current-17','present-unimportable'])).changes, 0);
  assert.equal(statement.run(1,'2026-10-02','[]').changes, 2);
  db.close();
});

test('partial or invalid Salesforce pages cannot authorize reconciliation', () => {
  for (const page of [null, {}, {records:[],done:false}, {records:[],done:false,nextRecordsUrl:'https://other/'},
    {records:[{}],done:true}, {records:[],done:'true'}]) assert.throws(() => validateSalesforcePage(page));
  validateSalesforcePage({records:[],done:true});
  validateSalesforcePage({records:[{Id:'current'}],done:false,nextRecordsUrl:'/services/data/v67.0/query/page'});
});

test('one-time Cheongna repair removes exactly the five verified obsolete rows', () => {
  const db = fixture();
  const oldIds = ['a0yTJ00000OLxQgYAL','a0yTJ00000OLxQhYAL','a0yTJ00000OLxQiYAL','a0yTJ00000OM36PYAT','a0yTJ00000OM36RYAT'];
  const insert = db.prepare('INSERT INTO installations VALUES (?, ?, ?, ?, ?, ?)');
  oldIds.forEach((id,index)=>insert.run(index+1,103,'salesforce',id,'500TJ000011NLQtYAO','2026-09-11'));
  insert.run(6,103,'salesforce','a0yTJ00000PCB69YAH','500TJ000011NLQtYAO','2026-10-02');
  insert.run(7,104,'salesforce',oldIds[0],'500TJ000011NLQtYAO','2026-09-11');
  insert.run(8,103,'manual',oldIds[1],'500TJ000011NLQtYAO','2026-09-11');
  const repair = readFileSync(new URL('../drizzle/0023_reconcile_cheongna_installations.sql',import.meta.url),'utf8');
  db.exec(repair);
  assert.deepEqual(db.prepare('SELECT id FROM installations ORDER BY id').all().map(r=>r.id),[6,7,8]);
  db.exec(repair);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM installations').get().n,3);
  db.close();
});
