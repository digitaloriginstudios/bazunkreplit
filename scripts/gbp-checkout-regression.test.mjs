import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateFees,allocate,minor} from '../artifacts/api-server/src/lib/marketplaceFees.ts';
const item=(priceMinor,sellerType='private',quantity=1)=>({id:1,quantity,priceMinor,sellerType,businessRate:5,title:'Test',image:null,sellerEmail:'test@example.invalid',category:'test'});
test('GBP private checkout includes protection and delivery',()=>{const q=calculateFees([item(1000)],6,100,399);assert.equal(q.currency,'GBP');assert.equal(q.totalMinor,1559);assert.equal(q.units[0].sellerNetMinor,1000);});
test('business checkout charges five percent seller fee and universal protection',()=>{const q=calculateFees([item(2000,'business',2)],6,100,399);assert.equal(q.totalMinor,4739);assert.equal(q.units.reduce((s,u)=>s+u.sellerFeeMinor,0),200);assert.equal(q.units.reduce((s,u)=>s+u.buyerTotalMinor,0),q.totalMinor);});
test('mixed sellers preserve integer penny allocations',()=>{const q=calculateFees([item(999),item(1234,'business',3)],6,100,399);for(const key of ['buyerTotalMinor','deliveryMinor','protectionMinor'])assert.ok(q.units.every(u=>Number.isSafeInteger(u[key])));assert.equal(q.units.reduce((s,u)=>s+u.buyerTotalMinor,0),q.totalMinor);assert.equal(q.units.reduce((s,u)=>s+u.protectionMinor,0),q.buyerProtectionMinor);assert.deepEqual(allocate(2,[1,1,1]),[1,1,0]);assert.throws(()=>minor(-1));});
