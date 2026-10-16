import assert from 'node:assert/strict';
import test from 'node:test';
import { merchantPaymentStatus } from '../app/merchant-payment-status.ts';

const payer = {id:15,merchantId:55,billingType:'rental',active:true,startMonth:'2026-07',endMonth:null,monthlyCharge:25000};
const payment = (billingMonth, supplyAmount=25000, extra={}) => ({payerAccountId:15,merchantId:55,billingMonth,supplyAmount,...extra});
const status = (end, payments, payers=[payer]) => merchantPaymentStatus(55,end,payers,payments);

test('Doran: October view checks fully paid September, November view checks unpaid October', () => {
  const payments=['2026-07','2026-08','2026-09'].map(m=>payment(m));
  assert.equal(status('2026-10',payments).status,'납부완료');
  assert.deepEqual(status('2026-11',payments),{billingMonth:'2026-10',expected:25000,unpaid:25000,status:'미납'});
});
test('partial payments are unpaid until the full supply amount is received', () => {
  assert.equal(status('2026-11',[payment('2026-10',20000)]).status,'미납');
  assert.equal(status('2026-11',[payment('2026-10',20000),payment('2026-10',5000)]).status,'납부완료');
});
test('billing month controls status even when paid in a different month', () => {
  assert.equal(status('2026-11',[payment('2026-10',25000,{paymentDate:'2026-11-15'})]).status,'납부완료');
  assert.equal(status('2026-11',[payment('2026-09',50000),payment('2026-11')]).status,'미납');
});
test('no applicable charge gives none, including free products and CMS installation month', () => {
  assert.equal(status('2026-11',[],[]).status,'없음');
  assert.equal(status('2026-11',[],[{...payer,monthlyCharge:0}]).status,'없음');
  assert.equal(status('2026-07',[]).status,'없음');
  assert.equal(status('2026-11',[],[{...payer,endMonth:'2026-09'}]).status,'없음');
  assert.equal(status('2026-11',[],[{...payer,billingType:'installment'}]).status,'없음');
});
test('January view checks the preceding December', () => {
  assert.equal(status('2027-01',[payment('2026-12')]).status,'납부완료');
  assert.equal(status('2027-01',[]).billingMonth,'2026-12');
});
test('overpayments to another payer or merchant cannot hide an unpaid charge', () => {
  const other={...payer,id:16};
  assert.equal(status('2026-11',[payment('2026-10',50000)],[payer,other]).unpaid,25000);
  assert.equal(status('2026-11',[payment('2026-10',25000,{merchantId:56})]).status,'미납');
});
test('refunds reduce the net paid amount', () => {
  assert.equal(status('2026-11',[payment('2026-10'),payment('2026-10',-1000)]).unpaid,1000);
});
