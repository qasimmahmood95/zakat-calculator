/**
 * calc.test.js — unit tests for calc.js.
 *
 * Zero dependencies: run with `node calc.test.js`. Exits 0 when all tests
 * pass, 1 otherwise (CI-friendly). Uses a micro test runner instead of a
 * framework so the whole test setup is auditable in one screen.
 */
"use strict";

const assert = require("node:assert");
const Z = require("./calc.js");

let passed = 0;
let failed = 0;
let currentGroup = "";

function group(name) {
  currentGroup = name;
  console.log("\n" + name);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (err) {
    failed++;
    console.error("  ✗ " + name);
    console.error("      " + String(err.message).split("\n").join("\n      "));
  }
}

/** assert.ok(a ~ b) with a tolerance suited to money-in-pounds arithmetic. */
function approx(actual, expected, epsilon) {
  const eps = epsilon === undefined ? 1e-9 : epsilon;
  assert.ok(
    Math.abs(actual - expected) <= eps,
    "expected " + actual + " to be within " + eps + " of " + expected
  );
}

/* ------------------------------------------------------------------ *
 * Input sanitisation
 * ------------------------------------------------------------------ */
group("toNumber — input sanitisation");

test("parses numeric strings", () => assert.strictEqual(Z.toNumber("12.50"), 12.5));
test("passes through positive numbers", () => assert.strictEqual(Z.toNumber(7), 7));
test("empty string becomes 0", () => assert.strictEqual(Z.toNumber(""), 0));
test("garbage becomes 0", () => assert.strictEqual(Z.toNumber("abc"), 0));
test("null/undefined become 0", () => {
  assert.strictEqual(Z.toNumber(null), 0);
  assert.strictEqual(Z.toNumber(undefined), 0);
});
test("negative values become 0 (a typo must never reduce zakat)", () => {
  assert.strictEqual(Z.toNumber(-500), 0);
  assert.strictEqual(Z.toNumber("-3"), 0);
});
test("Infinity and NaN become 0", () => {
  assert.strictEqual(Z.toNumber(Infinity), 0);
  assert.strictEqual(Z.toNumber(NaN), 0);
});

/* ------------------------------------------------------------------ *
 * Rounding
 * ------------------------------------------------------------------ */
group("roundUpToPenny — never round zakat downwards");

test("rounds a third of a penny up", () => assert.strictEqual(Z.roundUpToPenny(614.333333), 614.34));
test("leaves exact pence untouched (no float-noise bump)", () => {
  assert.strictEqual(Z.roundUpToPenny(614.33), 614.33);
  assert.strictEqual(Z.roundUpToPenny(0.1 + 0.2), 0.3);
});
test("rounds any fraction of a penny up, even a tiny one", () =>
  assert.strictEqual(Z.roundUpToPenny(100.001), 100.01));
test("zero and negatives return 0", () => {
  assert.strictEqual(Z.roundUpToPenny(0), 0);
  assert.strictEqual(Z.roundUpToPenny(-5), 0);
});

group("parseProportionPct — user-entered zakatable proportions");

test("blank means missing — returns null, never a guessed proportion", () => {
  assert.strictEqual(Z.parseProportionPct(""), null);
  assert.strictEqual(Z.parseProportionPct(null), null);
  assert.strictEqual(Z.parseProportionPct(undefined), null);
});
test("non-numeric input is treated as missing, not as 0", () =>
  assert.strictEqual(Z.parseProportionPct("abc"), null));
test("numeric strings and numbers parse", () => {
  assert.strictEqual(Z.parseProportionPct("25"), 25);
  assert.strictEqual(Z.parseProportionPct(25.5), 25.5);
});
test("explicit 0 is a valid entry (0%), distinct from blank", () =>
  assert.strictEqual(Z.parseProportionPct(0), 0));
test("clamped to [0, 100]", () => {
  assert.strictEqual(Z.parseProportionPct(250), 100);
  assert.strictEqual(Z.parseProportionPct(-30), 0);
});

/* ------------------------------------------------------------------ *
 * Currency conversion
 * ------------------------------------------------------------------ */
group("convertToGbp — user-supplied rates only");

const RATES = { USD: 0.79, EUR: 0.85, AED: 0.21 };

test("GBP passes through unchanged", () => assert.strictEqual(Z.convertToGbp(1000, "GBP", RATES), 1000));
test("USD converts at the supplied rate", () => approx(Z.convertToGbp(1000, "USD", RATES), 790));
test("AED converts at the supplied rate", () => approx(Z.convertToGbp(500, "AED", RATES), 105));
test("missing rate returns null — never a guessed value", () =>
  assert.strictEqual(Z.convertToGbp(100, "USD", {}), null));
test("zero/invalid rate is treated as missing", () => {
  assert.strictEqual(Z.convertToGbp(100, "EUR", { EUR: 0 }), null);
  assert.strictEqual(Z.convertToGbp(100, "EUR", { EUR: "abc" }), null);
});

group("totalCash — multi-currency aggregation");

test("sums mixed currencies into GBP", () => {
  const result = Z.totalCash(
    [
      { id: 1, label: "Current account", amount: 5000, currency: "GBP" },
      { id: 2, label: "USD savings", amount: 1000, currency: "USD" },
    ],
    RATES
  );
  approx(result.total, 5790);
  assert.strictEqual(result.missingRates.length, 0);
});
test("flags currencies whose rate is missing and excludes them from the total", () => {
  const result = Z.totalCash(
    [
      { id: 1, amount: 5000, currency: "GBP" },
      { id: 2, amount: 1000, currency: "AED" },
    ],
    {}
  );
  approx(result.total, 5000);
  assert.deepStrictEqual(result.missingRates, ["AED"]);
  assert.strictEqual(result.items[1].missingRate, true);
});
test("empty and missing item lists are fine", () => {
  assert.strictEqual(Z.totalCash([], RATES).total, 0);
  assert.strictEqual(Z.totalCash(undefined, RATES).total, 0);
});

/* ------------------------------------------------------------------ *
 * Precious metals
 * ------------------------------------------------------------------ */
group("gold & silver — purity and valuation");

test("24k gold factor is 1", () => assert.strictEqual(Z.goldPurityFactor(24), 1));
test("22k gold factor is 22/24", () => approx(Z.goldPurityFactor(22), 22 / 24));
test("9k gold factor is 9/24", () => approx(Z.goldPurityFactor(9), 0.375));
test("gold karat is clamped to 24", () => assert.strictEqual(Z.goldPurityFactor(99), 1));
test("sterling silver factor is 0.925", () => approx(Z.silverPurityFactor(925), 0.925));
test("Britannia silver factor is 0.958", () => approx(Z.silverPurityFactor(958), 0.958));

test("weight mode values the metal content: grams x purity x price", () => {
  // 50 g of 22k gold at £100/g of pure gold
  const item = { entryMode: "weight", metal: "gold", grams: 50, purity: 22 };
  approx(Z.metalItemValue(item, 100, 1.2), 50 * (22 / 24) * 100);
});
test("a UK Gold Sovereign valued by weight (CGT-exempt but still zakatable)", () => {
  // Sovereign: 7.988 g of 22k gold. CGT exemption is a UK tax rule and has
  // no effect on zakat — the coin is valued like any other gold.
  const item = { entryMode: "weight", metal: "gold", grams: 7.988, purity: 22 };
  approx(Z.metalItemValue(item, 100, 1.2), 7.988 * (22 / 24) * 100, 1e-6);
});
test("silver weight mode uses the silver price and fineness", () => {
  const item = { entryMode: "weight", metal: "silver", grams: 1000, purity: 925 };
  approx(Z.metalItemValue(item, 100, 1.2), 1000 * 0.925 * 1.2);
});
test("value mode uses the entered value directly", () => {
  const item = { entryMode: "value", metal: "gold", value: 1234.56 };
  assert.strictEqual(Z.metalItemValue(item, 100, 1.2), 1234.56);
});
test("totalMetals sums mixed items", () => {
  const result = Z.totalMetals(
    [
      { id: 1, entryMode: "weight", metal: "gold", grams: 10, purity: 24 },
      { id: 2, entryMode: "value", metal: "silver", value: 250 },
    ],
    100,
    1.2
  );
  approx(result.total, 1000 + 250);
});

/* ------------------------------------------------------------------ *
 * Crypto
 * ------------------------------------------------------------------ */
group("cryptoassets — quantity x manual price");

test("BTC quantity times price", () => {
  const result = Z.totalCrypto([{ id: 1, label: "BTC", quantity: 0.1, price: 50000 }]);
  approx(result.total, 5000);
});
test("multiple assets sum", () => {
  const result = Z.totalCrypto([
    { id: 1, label: "BTC", quantity: 0.5, price: 50000 },
    { id: 2, label: "ETH", quantity: 10, price: 2000 },
  ]);
  approx(result.total, 45000);
});
test("missing price contributes 0 (the tool never fabricates a price)", () => {
  const result = Z.totalCrypto([{ id: 1, label: "BTC", quantity: 2, price: "" }]);
  assert.strictEqual(result.total, 0);
});

/* ------------------------------------------------------------------ *
 * Business assets
 * ------------------------------------------------------------------ */
group("business assets — share of zakatable current assets");

test("100% owner: cash + receivables + stock, minus short-term liabilities", () => {
  const result = Z.totalBusiness([
    { id: 1, type: "cash", value: 20000 },
    { id: 2, type: "receivables", value: 8000 },
    { id: 3, type: "stock", value: 12000 },
    { id: 4, type: "liabilities", value: 5000 },
  ]);
  approx(result.assets, 40000);
  approx(result.liabilities, 5000);
  approx(result.net, 35000);
});
test("ownership percentage scales every line", () => {
  const result = Z.totalBusiness([
    { id: 1, type: "cash", value: 20000, ownershipPct: 50 },
    { id: 2, type: "stock", value: 10000, ownershipPct: 50 },
    { id: 3, type: "liabilities", value: 5000, ownershipPct: 50 },
  ]);
  approx(result.net, (20000 + 10000 - 5000) * 0.5);
});
test("blank ownership means wholly owned; explicit 0 means 0", () => {
  approx(Z.totalBusiness([{ id: 1, type: "cash", value: 100, ownershipPct: "" }]).net, 100);
  approx(Z.totalBusiness([{ id: 1, type: "cash", value: 100 }]).net, 100);
  approx(Z.totalBusiness([{ id: 1, type: "cash", value: 100, ownershipPct: 0 }]).net, 0);
});
test("ownership is capped at 100%", () => {
  approx(Z.totalBusiness([{ id: 1, type: "cash", value: 100, ownershipPct: 250 }]).net, 100);
});
test("company liabilities floor at 0 — they never offset personal wealth", () => {
  const result = Z.totalBusiness([
    { id: 1, type: "cash", value: 1000 },
    { id: 2, type: "liabilities", value: 9000 },
  ]);
  assert.strictEqual(result.net, 0);
});

/* ------------------------------------------------------------------ *
 * Investment property
 * ------------------------------------------------------------------ */
group("investment property — intention determines treatment");

test("rental income held at the zakat date is zakatable", () => {
  const result = Z.totalProperty([{ id: 1, type: "rentalIncome", value: 3000 }]);
  approx(result.zakatable, 3000);
});
test("property held for resale is trade stock — zakatable at market value", () => {
  const result = Z.totalProperty([{ id: 1, type: "resale", value: 250000 }]);
  approx(result.zakatable, 250000);
});
test("property held for income is NOT zakatable — recorded but excluded", () => {
  const result = Z.totalProperty([{ id: 1, type: "income", value: 250000 }]);
  assert.strictEqual(result.zakatable, 0);
  approx(result.excluded, 250000);
  assert.strictEqual(result.items[0].zakatable, false);
});

/* ------------------------------------------------------------------ *
 * Shares, funds & ISAs
 * ------------------------------------------------------------------ */
group("shares, funds & ISAs — treatment determines the zakatable value");

test("trading: full market value is zakatable", () => {
  const r = Z.totalInvestments([{ id: 1, treatment: "trading", value: 10000 }]);
  approx(r.zakatable, 10000);
  approx(r.excluded, 0);
});
test("long-term at full market value (the more cautious approach)", () => {
  approx(Z.totalInvestments([{ id: 1, treatment: "longTermFull", value: 8000 }]).zakatable, 8000);
});
test("long-term proportion: market value × the USER-entered %", () => {
  const r = Z.totalInvestments([{ id: 1, treatment: "longTermProportion", value: 10000, zakatablePct: 25 }]);
  approx(r.zakatable, 2500);
  approx(r.excluded, 7500);
  assert.strictEqual(r.items[0].appliedPct, 25);
  assert.strictEqual(r.missingProportion, false);
});
test("blank proportion: excluded and FLAGGED — the tool never assumes one", () => {
  const r = Z.totalInvestments([{ id: 1, treatment: "longTermProportion", value: 10000, zakatablePct: "" }]);
  assert.strictEqual(r.zakatable, 0);
  assert.strictEqual(r.excluded, 0); // unknown split: counted nowhere until entered
  assert.strictEqual(r.missingProportion, true);
  assert.strictEqual(r.items[0].missingProportion, true);
  assert.strictEqual(r.items[0].gbpValue, 0);
});
test("explicit 0% is respected (not treated as missing)", () => {
  const r = Z.totalInvestments([{ id: 1, treatment: "longTermProportion", value: 10000, zakatablePct: 0 }]);
  assert.strictEqual(r.zakatable, 0);
  approx(r.excluded, 10000);
  assert.strictEqual(r.missingProportion, false);
});
test("proportion above 100 clamps to 100", () => {
  const r = Z.totalInvestments([{ id: 1, treatment: "longTermProportion", value: 10000, zakatablePct: 250 }]);
  approx(r.zakatable, 10000);
  assert.strictEqual(r.items[0].appliedPct, 100);
});
test("a stray proportion on a trading/full-value item is ignored", () => {
  approx(Z.totalInvestments([{ id: 1, treatment: "trading", value: 1000, zakatablePct: 25 }]).zakatable, 1000);
  approx(Z.totalInvestments([{ id: 1, treatment: "longTermFull", value: 1000, zakatablePct: 25 }]).zakatable, 1000);
});
test("unknown treatment falls back to full market value — never silently understates", () => {
  const r = Z.totalInvestments([{ id: 1, treatment: "mystery", value: 100 }]);
  approx(r.zakatable, 100);
  assert.strictEqual(r.items[0].treatment, "trading");
});
test("mixed holdings sum and split correctly", () => {
  const r = Z.totalInvestments([
    { id: 1, treatment: "trading", value: 5000 },
    { id: 2, treatment: "longTermFull", value: 3000 },
    { id: 3, treatment: "longTermProportion", value: 10000, zakatablePct: 25 },
  ]);
  approx(r.zakatable, 10500);   // 5000 + 3000 + 2500
  approx(r.excluded, 7500);
});
test("empty and missing item lists are fine", () => {
  assert.strictEqual(Z.totalInvestments([]).zakatable, 0);
  assert.strictEqual(Z.totalInvestments(undefined).zakatable, 0);
});

/* ------------------------------------------------------------------ *
 * Pensions
 * ------------------------------------------------------------------ */
group("pensions — both DC positions offered; DB excluded until received");

test("DC annual: pot value × the USER-entered zakatable proportion", () => {
  const r = Z.totalPensions([{ id: 1, type: "dcAnnual", value: 40000, zakatablePct: 25 }]);
  approx(r.zakatable, 10000);
  approx(r.excluded, 30000);
  assert.strictEqual(r.items[0].zakatable, true);
});
test("DC annual with a blank proportion: excluded and FLAGGED, never guessed", () => {
  const r = Z.totalPensions([{ id: 1, type: "dcAnnual", value: 40000, zakatablePct: "" }]);
  assert.strictEqual(r.zakatable, 0);
  assert.strictEqual(r.excluded, 0);
  assert.strictEqual(r.missingProportion, true);
  assert.strictEqual(r.items[0].missingProportion, true);
});
test("DC annual proportion clamps to 100", () => {
  const r = Z.totalPensions([{ id: 1, type: "dcAnnual", value: 40000, zakatablePct: 150 }]);
  approx(r.zakatable, 40000);
  assert.strictEqual(r.items[0].appliedPct, 100);
});
test("DC annual explicit 0% is respected", () => {
  const r = Z.totalPensions([{ id: 1, type: "dcAnnual", value: 40000, zakatablePct: 0 }]);
  assert.strictEqual(r.zakatable, 0);
  approx(r.excluded, 40000);
  assert.strictEqual(r.missingProportion, false);
});
test("DC deferred (zakat on access/receipt): recorded, shown excluded", () => {
  const r = Z.totalPensions([{ id: 1, type: "dcDeferred", value: 20000 }]);
  assert.strictEqual(r.zakatable, 0);
  approx(r.excluded, 20000);
  assert.strictEqual(r.items[0].zakatable, false);
  approx(r.items[0].gbpValue, 20000); // full pot, for struck-through display
});
test("defined benefit: not zakatable until received — recorded, excluded", () => {
  const r = Z.totalPensions([{ id: 1, type: "db", value: 60000 }]);
  assert.strictEqual(r.zakatable, 0);
  approx(r.excluded, 60000);
  assert.strictEqual(r.items[0].zakatable, false);
});
test("a stray proportion on an excluded type is ignored", () => {
  const r = Z.totalPensions([{ id: 1, type: "db", value: 60000, zakatablePct: 50 }]);
  assert.strictEqual(r.zakatable, 0);
  approx(r.excluded, 60000);
});
test("unknown type is excluded — the tool will not invent a treatment", () => {
  const r = Z.totalPensions([{ id: 1, type: "mystery", value: 1000 }]);
  assert.strictEqual(r.zakatable, 0);
  approx(r.excluded, 1000);
});
test("mixed pots split correctly", () => {
  const r = Z.totalPensions([
    { id: 1, type: "dcAnnual", value: 40000, zakatablePct: 25 },
    { id: 2, type: "dcDeferred", value: 20000 },
    { id: 3, type: "db", value: 100000 },
  ]);
  approx(r.zakatable, 10000);
  approx(r.excluded, 150000);  // 30000 remainder + 20000 + 100000
});
test("empty and missing item lists are fine", () => {
  assert.strictEqual(Z.totalPensions([]).zakatable, 0);
  assert.strictEqual(Z.totalPensions(undefined).zakatable, 0);
});

/* ------------------------------------------------------------------ *
 * Debts & deductions
 * ------------------------------------------------------------------ */
group("debts — short-term deductible, long-term balance flagged not deducted");

test("short-term liabilities deduct in full", () => {
  const result = Z.totalDeductions([{ id: 1, type: "shortTerm", amount: 1500 }]);
  approx(result.deductible, 1500);
});
test("next 12 months of long-term instalments deduct (commonly held view)", () => {
  const result = Z.totalDeductions([{ id: 1, type: "longTermYear", amount: 4800 }]);
  approx(result.deductible, 4800);
});
test("remaining long-term balance is shown but NOT deducted", () => {
  const result = Z.totalDeductions([{ id: 1, type: "longTermBalance", amount: 180000 }]);
  assert.strictEqual(result.deductible, 0);
  approx(result.excluded, 180000);
  assert.strictEqual(result.items[0].deductible, false);
});
test("mixed debts split correctly", () => {
  const result = Z.totalDeductions([
    { id: 1, type: "shortTerm", amount: 1500 },
    { id: 2, type: "longTermYear", amount: 4800 },
    { id: 3, type: "longTermBalance", amount: 180000 },
  ]);
  approx(result.deductible, 6300);
  approx(result.excluded, 180000);
});

/* ------------------------------------------------------------------ *
 * Nisab
 * ------------------------------------------------------------------ */
group("nisab — thresholds and basis");

test("87.48 g gold and 612.36 g silver at the entered prices", () => {
  const t = Z.nisabThresholds(100, 1.2);
  approx(t.gold, 8748);
  approx(t.silver, 734.832);
});
test("missing prices give null thresholds — no fabricated numbers", () => {
  const t = Z.nisabThresholds("", 1.2);
  assert.strictEqual(t.gold, null);
  approx(t.silver, 734.832);
});
test("silver threshold is lower than gold at realistic prices (why many advise it)", () => {
  const t = Z.nisabThresholds(100, 1.2);
  assert.ok(t.silver < t.gold);
});
test("the 85 g / 595 g convention is selectable", () => {
  const t = Z.nisabThresholds(100, 1.2, "85");
  approx(t.gold, 8500);
  approx(t.silver, 714);
  assert.strictEqual(t.goldGrams, 85);
  assert.strictEqual(t.silverGrams, 595);
});
test("default and unknown conventions use 87.48 g / 612.36 g", () => {
  [undefined, "nonsense"].forEach((conv) => {
    const t = Z.nisabThresholds(100, 1.2, conv);
    approx(t.gold, 8748);
    assert.strictEqual(t.goldGrams, 87.48);
    assert.strictEqual(t.silverGrams, 612.36);
  });
});

/* ------------------------------------------------------------------ *
 * Hawl / dates
 * ------------------------------------------------------------------ */
group("hawl — lunar year arithmetic");

test("lunar year constant is ~354.37 days", () => approx(Z.LUNAR_YEAR_DAYS, 354.367, 0.01));
test("next anniversary is 354 days later", () =>
  assert.strictEqual(Z.addLunarYear("2026-01-01"), "2026-12-21"));
test("crosses year boundaries correctly", () =>
  assert.strictEqual(Z.addLunarYear("2026-07-03"), "2027-06-22"));
test("handles leap years (2024-02-29 + 354 days)", () =>
  // 306 days remain in leap-year 2024 after Feb 29, then 48 into 2025 -> Feb 17.
  assert.strictEqual(Z.addLunarYear("2024-02-29"), "2025-02-17"));
test("invalid or empty input returns null", () => {
  assert.strictEqual(Z.addLunarYear(""), null);
  assert.strictEqual(Z.addLunarYear("not-a-date"), null);
  assert.strictEqual(Z.addLunarYear(null), null);
});

group("hijri — Umm al-Qura conversion via built-in Intl");

test("the environment supports the islamic-umalqura calendar (CI must fail loudly if not)", () => {
  assert.notStrictEqual(Z.hijriParts("2026-01-01"), null);
});
test("anchor: 2025-06-26 was 1 Muharram 1447 (Islamic New Year)", () => {
  assert.deepStrictEqual(Z.hijriParts("2025-06-26"), { year: 1447, month: 1, day: 1 });
});
test("anchor: 2025-03-30 was 1 Shawwal 1446 (Eid al-Fitr)", () => {
  assert.deepStrictEqual(Z.hijriParts("2025-03-30"), { year: 1446, month: 10, day: 1 });
});
test("formatHijri renders day, month name, year and era", () => {
  assert.strictEqual(Z.formatHijri("2025-06-26"), "1 Muharram 1447 AH");
});
test("invalid input returns null from all hijri functions", () => {
  ["", "not-a-date", null].forEach((bad) => {
    assert.strictEqual(Z.hijriParts(bad), null);
    assert.strictEqual(Z.formatHijri(bad), null);
    assert.strictEqual(Z.nextLunarAnniversary(bad), null);
  });
});

group("hijri — true next anniversary (same Hijri day+month, next year)");

test("anchor: one Hijri year after 1 Muharram 1447 is 2026-06-16 (1 Muharram 1448)", () => {
  assert.strictEqual(Z.nextLunarAnniversary("2025-06-26"), "2026-06-16");
  assert.deepStrictEqual(Z.hijriParts("2026-06-16"), { year: 1448, month: 1, day: 1 });
});
test("property: the anniversary lands on the same Hijri day and month, year + 1", () => {
  ["2026-01-05", "2026-03-20", "2026-07-12", "2026-11-30"].forEach((iso) => {
    const start = Z.hijriParts(iso);
    const next = Z.hijriParts(Z.nextLunarAnniversary(iso));
    assert.strictEqual(next.year, start.year + 1, iso);
    assert.strictEqual(next.month, start.month, iso);
    // day matches exactly, except a day-30 start may clamp to 29 (see below)
    assert.ok(next.day === start.day || (start.day === 30 && next.day === 29), iso);
  });
});
test("property: a Hijri year is 354 or 355 days", () => {
  ["2026-01-05", "2026-03-20", "2026-07-12"].forEach((iso) => {
    const next = Z.nextLunarAnniversary(iso);
    const days = Math.round((Date.parse(next) - Date.parse(iso)) / 86400000);
    assert.ok(days === 354 || days === 355, iso + " -> " + next + " (" + days + " days)");
  });
});
test("day-30 edge: an anniversary on the 30th clamps to the month's last day, never a different month", () => {
  // Find a date falling on the 30th of a Hijri month within the next 90 days
  // of a fixed start (30-day months occur in any 90-day window).
  let probe = null;
  for (let i = 0; i < 90; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    const iso = d.toISOString().slice(0, 10);
    if (Z.hijriParts(iso).day === 30) { probe = iso; break; }
  }
  assert.ok(probe, "no Hijri 30th found in the scan window");
  const start = Z.hijriParts(probe);
  const next = Z.hijriParts(Z.nextLunarAnniversary(probe));
  assert.strictEqual(next.year, start.year + 1);
  assert.strictEqual(next.month, start.month);
  assert.ok(next.day === 30 || next.day === 29, "clamped day was " + next.day);
});
test("addLunarYear remains as the 354-day fallback", () => {
  assert.strictEqual(Z.addLunarYear("2026-01-01"), "2026-12-21");
});

group("rates — lunar vs fixed-Gregorian-date adjustment");

test("lunar rate is 2.5%", () => assert.strictEqual(Z.RATE_LUNAR, 0.025));
test("Gregorian-adjusted rate is ~2.577% (2.5% x 365.25/354.367)", () => {
  approx(Z.RATE_GREGORIAN, 0.025 * (365.25 / 354.367));
  approx(Z.RATE_GREGORIAN, 0.02577, 0.00001);
});

/* ------------------------------------------------------------------ *
 * calculateZakat — integration
 * ------------------------------------------------------------------ */
group("calculateZakat — full worked example (mirrors the README)");

/**
 * Worked example. All prices are EXAMPLES, as in the UI placeholders:
 * gold £100/g, silver £1.20/g, USD→GBP 0.79.
 *
 *   Cash:      £5,000 + $1,000 x 0.79                     =  £5,790.00
 *   Gold:      50 g of 22k at £100/g -> 50 x 22/24 x 100  =  £4,583.33
 *   Crypto:    0.1 BTC at £50,000                          =  £5,000.00
 *   Business:  50% of (20,000 + 10,000 - 5,000)            = £12,500.00
 *   Property:  rental income held £3,000 (building itself
 *              held for income: excluded)                  =  £3,000.00
 *   Gross                                                  = £30,873.33
 *   Debts:     1,500 short-term + 4,800 instalments        = -£6,300.00
 *              (mortgage balance £180,000: NOT deducted)
 *   Net                                                    = £24,573.33
 *   Silver nisab: 612.36 x 1.20 = £734.83 -> nisab met
 *   Zakat due: 24,573.33... x 2.5% = 614.3333 -> £614.34 (rounded up)
 */
function workedExampleState() {
  return {
    settings: {
      goldPricePerGram: 100,
      silverPricePerGram: 1.2,
      nisabBasis: "silver",
      fxRates: { USD: 0.79, EUR: 0.85, AED: 0.21 },
      timing: "lunar",
    },
    cash: [
      { id: 1, label: "Current account", amount: 5000, currency: "GBP" },
      { id: 2, label: "USD savings", amount: 1000, currency: "USD" },
    ],
    metals: [{ id: 3, label: "Gold jewellery", entryMode: "weight", metal: "gold", grams: 50, purity: 22 }],
    crypto: [{ id: 4, label: "BTC", quantity: 0.1, price: 50000 }],
    business: [
      { id: 5, label: "Company cash", type: "cash", value: 20000, ownershipPct: 50 },
      { id: 6, label: "Stock", type: "stock", value: 10000, ownershipPct: 50 },
      { id: 7, label: "Trade creditors", type: "liabilities", value: 5000, ownershipPct: 50 },
    ],
    property: [
      { id: 8, label: "Rent saved", type: "rentalIncome", value: 3000 },
      { id: 9, label: "Buy-to-let flat", type: "income", value: 250000 },
    ],
    debts: [
      { id: 10, label: "Credit card", type: "shortTerm", amount: 1500 },
      { id: 11, label: "Mortgage — next 12 months", type: "longTermYear", amount: 4800 },
      { id: 12, label: "Mortgage — remaining balance", type: "longTermBalance", amount: 180000 },
    ],
  };
}

test("gross zakatable wealth", () => {
  const r = Z.calculateZakat(workedExampleState());
  approx(r.grossZakatable, 30873.333333, 1e-4);
});
test("deductions and net", () => {
  const r = Z.calculateZakat(workedExampleState());
  approx(r.totalDeductions, 6300);
  approx(r.netZakatable, 24573.333333, 1e-4);
});
test("nisab comparison on the silver basis", () => {
  const r = Z.calculateZakat(workedExampleState());
  approx(r.nisab.silver, 734.832);
  approx(r.nisab.applied, 734.832);
  assert.strictEqual(r.nisab.basis, "silver");
  assert.strictEqual(r.meetsNisab, true);
});
test("zakat due at 2.5%, rounded up to the penny", () => {
  const r = Z.calculateZakat(workedExampleState());
  assert.strictEqual(r.zakatDue, 614.34);
});
test("switching to the gold basis raises the threshold but wealth still exceeds it", () => {
  const state = workedExampleState();
  state.settings.nisabBasis = "gold";
  const r = Z.calculateZakat(state);
  approx(r.nisab.applied, 8748);
  assert.strictEqual(r.meetsNisab, true);
});
test("the excluded property and mortgage balance are reported, not counted", () => {
  const r = Z.calculateZakat(workedExampleState());
  approx(r.property.excluded, 250000);
  approx(r.debts.excluded, 180000);
});

group("calculateZakat — nisab boundaries and edge cases");

function simpleState(cashGbp, overrides) {
  const state = {
    settings: Object.assign(
      { goldPricePerGram: 100, silverPricePerGram: 1, nisabBasis: "silver", fxRates: {}, timing: "lunar" },
      overrides || {}
    ),
    cash: [{ id: 1, amount: cashGbp, currency: "GBP" }],
    metals: [], crypto: [], business: [], property: [], debts: [],
  };
  return state;
}

test("wealth exactly at nisab IS zakatable (nisab is the obligating minimum)", () => {
  // silver at £1/g -> threshold exactly £612.36
  const r = Z.calculateZakat(simpleState(612.36));
  assert.strictEqual(r.meetsNisab, true);
  assert.strictEqual(r.zakatDue, Z.roundUpToPenny(612.36 * 0.025));
});
test("a penny below nisab: nothing due", () => {
  const r = Z.calculateZakat(simpleState(612.35));
  assert.strictEqual(r.meetsNisab, false);
  assert.strictEqual(r.zakatDue, 0);
});
test("the 85/595 convention can change whether zakat is due at the margin", () => {
  // £600 with silver at £1/g: below the 612.36 g threshold, but at or above 595 g.
  const def = Z.calculateZakat(simpleState(600));
  assert.strictEqual(def.meetsNisab, false);
  const alt = Z.calculateZakat(simpleState(600, { nisabConvention: "85" }));
  assert.strictEqual(alt.meetsNisab, true);
  assert.strictEqual(alt.nisab.convention, "85");
  approx(alt.nisab.applied, 595);
});
test("missing metal price: zakatDue is null, never a guess", () => {
  const r = Z.calculateZakat(simpleState(10000, { silverPricePerGram: "" }));
  assert.strictEqual(r.nisab.applied, null);
  assert.strictEqual(r.meetsNisab, null);
  assert.strictEqual(r.zakatDue, null);
});
test("Gregorian timing applies the ~2.577% adjusted rate", () => {
  const r = Z.calculateZakat(simpleState(10000, { timing: "gregorian" }));
  assert.strictEqual(r.rate, Z.RATE_GREGORIAN);
  assert.strictEqual(r.zakatDue, Z.roundUpToPenny(10000 * Z.RATE_GREGORIAN));
});
test("deductions cannot make net wealth negative", () => {
  const state = simpleState(1000);
  state.debts = [{ id: 2, type: "shortTerm", amount: 5000 }];
  const r = Z.calculateZakat(state);
  assert.strictEqual(r.netZakatable, 0);
  assert.strictEqual(r.zakatDue, 0);
});
test("a completely empty state computes zeros without throwing", () => {
  const r = Z.calculateZakat({ settings: { goldPricePerGram: 100, silverPricePerGram: 1 } });
  assert.strictEqual(r.netZakatable, 0);
  assert.strictEqual(r.zakatDue, 0);
});

group("calculateZakat — investments & pensions integration");

/**
 * Alongside (NOT replacing) the main worked example:
 *   Cash:                                        £5,000.00
 *   Investments: trading £2,000 + long-term-full £1,000
 *                + 25% of £10,000 fund           £5,500.00
 *   Pensions:    25% of £40,000 DC pot          £10,000.00
 *                (DB scheme £60,000: excluded)
 *   Gross = net (no debts)                      £20,500.00
 *   Silver nisab: 612.36 × 1.20 = £734.83 — met
 *   Zakat due: 20,500 × 2.5% = £512.50
 */
function investmentsPensionsState() {
  return {
    settings: { goldPricePerGram: 100, silverPricePerGram: 1.2, nisabBasis: "silver", fxRates: {}, timing: "lunar" },
    cash: [{ id: 1, label: "Current account", amount: 5000, currency: "GBP" }],
    metals: [], crypto: [], business: [], property: [],
    investments: [
      { id: 2, label: "Trading shares", treatment: "trading", value: 2000 },
      { id: 3, label: "Index fund (full value)", treatment: "longTermFull", value: 1000 },
      { id: 4, label: "Index fund (proportion)", treatment: "longTermProportion", value: 10000, zakatablePct: 25 },
    ],
    pensions: [
      { id: 5, label: "Workplace DC pot", type: "dcAnnual", value: 40000, zakatablePct: 25 },
      { id: 6, label: "Old DB scheme", type: "db", value: 60000 },
    ],
    debts: [],
  };
}

test("investments and pensions feed grossZakatable", () => {
  const r = Z.calculateZakat(investmentsPensionsState());
  approx(r.investments.zakatable, 5500);
  approx(r.pensions.zakatable, 10000);
  approx(r.grossZakatable, 20500);
});
test("zakat due on the combined wealth, to the penny", () => {
  const r = Z.calculateZakat(investmentsPensionsState());
  assert.strictEqual(r.zakatDue, 512.5);
});
test("excluded amounts are reported, not counted", () => {
  const r = Z.calculateZakat(investmentsPensionsState());
  approx(r.investments.excluded, 7500);   // 75% of the proportion fund
  approx(r.pensions.excluded, 90000);     // 30,000 DC remainder + 60,000 DB
});
test("a missing proportion surfaces through the summary and adds nothing", () => {
  const state = investmentsPensionsState();
  state.investments = [{ id: 2, treatment: "longTermProportion", value: 10000, zakatablePct: "" }];
  state.pensions = [];
  const r = Z.calculateZakat(state);
  assert.strictEqual(r.investments.missingProportion, true);
  approx(r.grossZakatable, 5000);
});
test("states saved before this feature (no investments/pensions keys) still compute", () => {
  const r = Z.calculateZakat({
    settings: { goldPricePerGram: 100, silverPricePerGram: 1 },
    cash: [{ id: 1, amount: 1000, currency: "GBP" }],
  });
  assert.strictEqual(r.investments.zakatable, 0);
  assert.strictEqual(r.pensions.zakatable, 0);
  approx(r.grossZakatable, 1000);
});

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */
console.log("\n" + "-".repeat(50));
console.log(passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
