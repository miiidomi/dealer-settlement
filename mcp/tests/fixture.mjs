import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export const identity={memberId:1,email:'admin@example.test',name:'관리자'};
export const month='2026-09';
export function fixture() {
  return {access:{userId:'1',email:identity.email,displayName:identity.name,role:'admin',dealerId:null},
    dealers:[{id:1,name:'테스트 딜러',active:true,flatCommissionEnabled:false,vanSettlementEnabled:false,penaltySettlementEnabled:true,advanceEnabled:true}],
    rules:[{id:1,dealerId:1,effectiveFrom:'2025-01-01',costShareRate:50,profitShareRate:50,vatSeparate:true}],
    merchants:[{id:1,dealerId:1,name:'테스트 가맹점',businessNumber:'1234567890',installDate:'2026-09-10',lastSyncedAt:'2026-10-06T05:00:00.000Z'}],
    products:[{id:1,name:'테스트 제품',category:'포스',active:true,directCostAllowed:false}],
    installations:[{id:1,merchantId:1,productId:1,quantity:1,unitCostSnapshot:50000,unitCostOverridden:false,unitCostRegistered:true,condition:'신품',source:'manual',
      transactionClassification:'임대',contractInstallAt:'2026-09-10',fixing:0,incentive:0,fixingSettlementMonth:null,incentiveSettlementMonth:null,
      fixingPaymentStatus:null,incentivePaymentStatus:null,fixingPaymentDate:null,incentivePaymentDate:null,salesAmount:100000,contractTermMonths:36}],
    payerAccounts:[{id:1,merchantId:1,payerNumber:'1000050871',label:'수동',billingType:'rental',active:true,startMonth:month,endMonth:null,monthlyCharge:100000}],
    payments:[{id:1,merchantId:1,payerAccountId:1,paymentDate:'2026-09-20',billingMonth:'2026-08',supplyAmount:100000,vatAmount:10000,grossAmount:110000,sourceFile:'fixture.xlsx'}],
    costs:[],dealerProductCosts:[],dealerCategoryCosts:[],dealerCommissionRules:[],cancellationPenalties:[],
    advancePayments:[],vanSettlements:[],monthlySettlementStatuses:[],billings:[],members:[]};
}
export function d1(sql='',readonly=false) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(sql);
  const queries=[];
  const db={sqlite,queries,prepare(query){
    queries.push(query);
    if(readonly && !/^SELECT\b/i.test(query)) throw Error('Settlement DB mutation blocked by test');
    const build=(values=[])=>({bind(...args){return build(args)},
      async all(){return {success:true,results:sqlite.prepare(query).all(...values)}},
      async first(){return sqlite.prepare(query).get(...values)??null},
      async run(){return {success:true,results:[],meta:sqlite.prepare(query).run(...values)}}});
    return build();
  },async batch(statements){return Promise.all(statements.map(s=>s.all()))}};
  return db;
}
export function testEnv(data=fixture()) {
  const DB=d1(readFileSync(new URL('./fixture-schema.sql',import.meta.url),'utf8'));
  const tables={dealers:'dealers',rules:'dealer_rules',merchants:'merchants',products:'products',installations:'installations',payerAccounts:'payer_accounts',payments:'payments',
    costs:'product_costs',dealerProductCosts:'dealer_product_costs',dealerCategoryCosts:'dealer_category_costs',dealerCommissionRules:'dealer_commission_rules',
    cancellationPenalties:'cancellation_penalties',advancePayments:'advance_payments',vanSettlements:'van_settlements',monthlySettlementStatuses:'monthly_settlement_statuses',billings:'billings',members:'dealer_members'};
  for(const [key,table] of Object.entries(tables)) for(const row of data[key]) {
    const columns=Object.keys(row).filter(k=>k!=='unitCostRegistered');
    const snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
    DB.sqlite.prepare(`INSERT INTO ${table}(${columns.map(snake).join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(k=>typeof row[k]==='boolean'?Number(row[k]):row[k]??null));
  }
  DB.sqlite.prepare('INSERT INTO dealer_members(id,email,role,active) VALUES(?,?,?,?)').run(1,identity.email,'admin',1);
  const originalPrepare=DB.prepare.bind(DB);DB.prepare=query=>{
    if(!/^SELECT\b/i.test(query)) throw Error('Settlement DB mutation blocked by test');
    return originalPrepare(query);
  };
  return {DB,MCP_META:d1(readFileSync(new URL('../schema.sql',import.meta.url),'utf8')),
    PUBLIC_BASE_URL:'https://mcp.example.test',SITE_BASE_URL:'https://site.example.test',
    ACCESS_TEAM_DOMAIN:'dealer-settlement.cloudflareaccess.com',ACCESS_CLIENT_ID:'fixture',ACCESS_CLIENT_SECRET:'fixture-only',ACCESS_ISSUER:'https://issuer.example.test'};
}
