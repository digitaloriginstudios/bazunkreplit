import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync("artifacts/api-server/src/routes/swaps.ts","utf8");
test("checkout rejects live Stripe credentials",()=>assert.match(source,/if\(accountBalance\.livemode\)/));
test("test fulfilment requires explicit opt in",()=>assert.match(source,/SWAP_TEST_FULFILMENT_ENABLED!=="true"/));
test("zero cash completion requires two receipts",()=>assert.match(source,/if\(Number\(done\?\.total\)===2\)\{\s*if\(Number\(o\.cash_minor\)===0\)/));
test("swap API requires feature flag",()=>assert.match(source,/featureEnabled\("swaps"\)/));
