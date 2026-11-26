import test from "node:test";
import assert from "node:assert/strict";
import {shippingCountry,listingShipping,shipsToCountry} from "../artifacts/api-server/src/lib/listingShipping.ts";
test("domestic coverage",()=>{assert.equal(shipsToCountry("domestic","UK","GB"),true);assert.equal(shipsToCountry("domestic","UK","US"),false)});
test("regional coverage",()=>{assert.equal(shipsToCountry("eu-only","FR","IE"),true);assert.equal(shipsToCountry("eu-only","FR","GB"),false);assert.equal(shipsToCountry("regions:GB,US","GB","US"),true)});
test("legacy and unknown coverage",()=>{const s=listingShipping(null,null,null,JSON.stringify({ships_from:"USA",ships_to:"worldwide"}));assert.equal(shippingCountry(s.shipOrigin),"US");assert.equal(shipsToCountry(s.shipZone,s.shipOrigin,"GB"),true);assert.equal(shipsToCountry(null,null,"GB"),false)});
