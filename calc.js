/**
 * calc.js — all zakat calculation logic for the zakat calculator.
 *
 * Design rules for this file:
 *  - Pure functions only: no DOM access, no network, no Date.now() surprises.
 *    Everything is deterministic given its inputs, so it can be unit-tested
 *    with plain Node (`node calc.test.js`).
 *  - All monetary values are in GBP. Currency conversion happens at the edge
 *    (convertToGbp) using user-supplied rates — this tool never fetches data.
 *  - Where a rule involves scholarly difference, the position applied is the
 *    commonly held view; the comment says so and the UI/README flag it.
 *
 * Loaded two ways:
 *  - Browser: attaches itself to `window.ZakatCalc`.
 *  - Node (tests): exported via `module.exports`.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ZakatCalc = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  /**
   * Nisab thresholds in grams.
   *
   * The classical measures are 20 mithqal of gold and 200 dirhams of silver.
   * Converting those to grams is itself a point of difference: this tool uses
   * the widely used 4.374 g/mithqal convention, giving 87.48 g gold and
   * 612.36 g silver. Another common convention (4.25 g/mithqal) gives
   * 85 g / 595 g, which produces a slightly LOWER threshold. Both are in
   * respectable use; the difference rarely changes whether zakat is due.
   * Flagged in the UI and README.
   */
  const NISAB_GOLD_GRAMS = 87.48;
  const NISAB_SILVER_GRAMS = 612.36;

  /**
   * Both gram conventions, keyed by their gold figure. "87.48" (4.374 g per
   * mithqal) is the default; "85" (4.25 g per mithqal) is offered as a
   * selectable alternative since both are in respectable institutional use.
   */
  const NISAB_CONVENTIONS = {
    "87.48": { gold: 87.48, silver: 612.36 },
    "85": { gold: 85, silver: 595 },
  };

  /**
   * Length of the lunar (Hijri) year in days.
   * 12 lunar months average 354.367 days (354 days 8h 48m). A civil Hijri
   * year is 354 or 355 days. Used for the "next anniversary" estimate and
   * for the Gregorian rate adjustment below.
   */
  const LUNAR_YEAR_DAYS = 354.367;

  /** The zakat rate on monetary wealth: one quarter of one tenth (2.5%). */
  const RATE_LUNAR = 0.025;

  /**
   * Adjusted rate for people who pay on a fixed *Gregorian* date every year.
   *
   * A Gregorian year (365.25 days) is ~11 days longer than a lunar year, so a
   * fixed Gregorian date means slightly fewer zakat payments over a lifetime.
   * Some zakat institutions approximate a correction by scaling the rate:
   *   2.5% x (365.25 / 354.367) ≈ 2.577%
   * This is an approximation, not a substitute for tracking a Hijri date —
   * flagged as such wherever it is offered.
   */
  const RATE_GREGORIAN = RATE_LUNAR * (365.25 / LUNAR_YEAR_DAYS);

  /** Currencies the cash section accepts. Rates are user-supplied GBP per 1 unit. */
  const SUPPORTED_CURRENCIES = ["GBP", "USD", "EUR", "AED"];

  /* ------------------------------------------------------------------ *
   * Small numeric helpers
   * ------------------------------------------------------------------ */

  /**
   * Coerce arbitrary form input to a usable non-negative number.
   * Anything non-numeric, non-finite, or negative becomes 0 — a wrong entry
   * should never silently *reduce* someone's zakat via a negative amount.
   */
  function toNumber(value) {
    const n = typeof value === "string" ? parseFloat(value) : Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Round a GBP amount UP to the penny.
   * Zakat due is rounded up rather than half-even so that rounding can never
   * cause an underpayment. The small epsilon absorbs float noise so that an
   * exact value like 614.33 is not bumped to 614.34.
   */
  function roundUpToPenny(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.ceil(n * 100 - 1e-7) / 100;
  }

  /**
   * Parse a user-entered zakatable proportion (%), used by the investments
   * and pensions sections. Returns null when the field is blank or unusable
   * (undefined/null/""/non-numeric) — the caller must EXCLUDE the item and
   * FLAG it rather than guess (same policy as missing FX rates and metal
   * prices: this tool never fabricates numbers). Otherwise clamps to
   * [0, 100]. An explicit 0 is a valid entry meaning 0%.
   *
   * Contrast with business ownershipPct (blank = 100): an unstated ownership
   * share naturally reads as "wholly mine" — a fact about the user. A fund's
   * zakatable-assets proportion is a fact about the fund that the user must
   * look up; defaulting it would fabricate a number.
   */
  function parseProportionPct(raw) {
    if (raw === undefined || raw === null || raw === "") return null;
    const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(Math.max(n, 0), 100);
  }

  /* ------------------------------------------------------------------ *
   * Currency conversion
   * ------------------------------------------------------------------ */

  /**
   * Convert an amount to GBP using user-supplied rates (GBP per 1 unit of
   * the foreign currency). Returns `null` — never a guessed value — when the
   * needed rate is missing, so the UI can tell the user to supply it.
   */
  function convertToGbp(amount, currency, fxRates) {
    const amt = toNumber(amount);
    if (currency === "GBP" || !currency) return amt;
    const rate = toNumber(fxRates && fxRates[currency]);
    if (rate === 0) return null; // missing or invalid rate
    return amt * rate;
  }

  /* ------------------------------------------------------------------ *
   * Precious metals
   * ------------------------------------------------------------------ */

  /** Fraction of pure gold by karat (24k = pure). Clamped to [0, 24]. */
  function goldPurityFactor(karat) {
    const k = Math.min(Math.max(toNumber(karat), 0), 24);
    return k / 24;
  }

  /** Fraction of pure silver by fineness (999 = pure, 925 = sterling). */
  function silverPurityFactor(fineness) {
    const f = Math.min(Math.max(toNumber(fineness), 0), 1000);
    return f / 1000;
  }

  /**
   * Zakatable value of one metal item, in GBP.
   *
   * Two entry modes:
   *  - "weight": grams x purity x user-supplied price per gram of pure metal.
   *    This values the *metal content*, the commonly held basis for zakat on
   *    gold and silver (rather than retail/replacement value, which includes
   *    workmanship).
   *  - "value": the user enters a value directly (e.g. a hallmarked item they
   *    have had appraised, or a coin trading above melt).
   *
   * Note: whether personal-USE jewellery is zakatable at all is a madhhab
   * difference (see UI note). This function values whatever it is given; the
   * decision about what to include rests with the user.
   */
  function metalItemValue(item, goldPricePerGram, silverPricePerGram) {
    if (!item) return 0;
    if (item.entryMode === "value") return toNumber(item.value);
    const grams = toNumber(item.grams);
    if (item.metal === "silver") {
      return grams * silverPurityFactor(item.purity) * toNumber(silverPricePerGram);
    }
    return grams * goldPurityFactor(item.purity) * toNumber(goldPricePerGram);
  }

  /* ------------------------------------------------------------------ *
   * Category totals
   * Each returns { items: [...per-item results], ...totals } so the UI can
   * show an itemised breakdown without re-implementing any arithmetic.
   * ------------------------------------------------------------------ */

  /** Cash & bank balances (multi-currency). */
  function totalCash(items, fxRates) {
    const out = { items: [], total: 0, missingRates: [] };
    (items || []).forEach(function (item) {
      const gbp = convertToGbp(item.amount, item.currency, fxRates);
      const entry = {
        id: item.id,
        label: item.label || "",
        currency: item.currency || "GBP",
        amount: toNumber(item.amount),
        gbpValue: gbp === null ? 0 : gbp,
        missingRate: gbp === null,
      };
      if (gbp === null) {
        if (out.missingRates.indexOf(item.currency) === -1) out.missingRates.push(item.currency);
      } else {
        out.total += gbp;
      }
      out.items.push(entry);
    });
    return out;
  }

  /** Gold & silver. */
  function totalMetals(items, goldPricePerGram, silverPricePerGram) {
    const out = { items: [], total: 0 };
    (items || []).forEach(function (item) {
      const value = metalItemValue(item, goldPricePerGram, silverPricePerGram);
      out.items.push({ id: item.id, label: item.label || "", metal: item.metal || "gold", gbpValue: value });
      out.total += value;
    });
    return out;
  }

  /** Cryptoassets: quantity x user-supplied GBP price. No API calls, ever. */
  function totalCrypto(items) {
    const out = { items: [], total: 0 };
    (items || []).forEach(function (item) {
      const value = toNumber(item.quantity) * toNumber(item.price);
      out.items.push({ id: item.id, label: item.label || "", gbpValue: value });
      out.total += value;
    });
    return out;
  }

  /**
   * Business assets (owner-managed limited company).
   *
   * Position applied (commonly held view — a scholarly-difference area, see
   * UI note and README): the shareholder owes zakat on their ownership share
   * of the company's zakatable current assets — cash, trade receivables and
   * stock-in-trade — net of the company's short-term liabilities. Fixed
   * assets (plant, vehicles, premises) are not zakatable.
   *
   * Ownership: `ownershipPct` blank/undefined means wholly owned (100%);
   * an explicit 0 means 0. Clamped to [0, 100].
   *
   * The company-level net is floored at 0: a company's excess liabilities do
   * not offset the owner's *personal* zakatable wealth.
   */
  function totalBusiness(items) {
    const out = { items: [], assets: 0, liabilities: 0, net: 0 };
    (items || []).forEach(function (item) {
      let pct = item.ownershipPct === undefined || item.ownershipPct === null || item.ownershipPct === ""
        ? 100
        : toNumber(item.ownershipPct);
      pct = Math.min(pct, 100);
      const share = pct / 100;
      const value = toNumber(item.value) * share;
      const isLiability = item.type === "liabilities";
      out.items.push({
        id: item.id,
        label: item.label || "",
        type: item.type || "cash",
        ownershipPct: pct,
        gbpValue: value,
        deduction: isLiability,
      });
      if (isLiability) out.liabilities += value;
      else out.assets += value;
    });
    out.net = Math.max(0, out.assets - out.liabilities);
    return out;
  }

  /**
   * Investment property.
   *
   * Position applied (commonly held view):
   *  - "rentalIncome": rent saved up and still held at the zakat date is
   *    zakatable like any other cash. (The UI warns against double-counting
   *    rent already included in a bank balance above.)
   *  - "resale": property acquired with the intention of resale is trade
   *    stock — zakatable at market value.
   *  - "income": property held to generate income (or for personal use) is
   *    NOT itself zakatable. It is accepted as input and reported with
   *    zakatable = 0 so the breakdown shows the rule being applied.
   * Where intention changed after purchase, scholars differ on when the
   * property becomes trade stock — flagged in the UI.
   */
  function totalProperty(items) {
    const out = { items: [], zakatable: 0, excluded: 0 };
    (items || []).forEach(function (item) {
      const value = toNumber(item.value);
      const isZakatable = item.type === "rentalIncome" || item.type === "resale";
      out.items.push({
        id: item.id,
        label: item.label || "",
        type: item.type || "rentalIncome",
        gbpValue: value,
        zakatable: isZakatable,
      });
      if (isZakatable) out.zakatable += value;
      else out.excluded += value;
    });
    return out;
  }

  /**
   * Listed shares, funds & ISAs (stocks-and-shares ISAs, ETFs, unit trusts,
   * directly held listed shares). Cash ISAs are ordinary savings and belong
   * in the cash section; dividends already received and held are cash too.
   *
   * Position applied (a scholarly-difference area — see UI note and README):
   *  - "trading": bought with the intention of resale — trade stock,
   *    zakatable at full market value.
   *  - "longTermFull": held long-term; zakat on the full market value —
   *    the simpler, more cautious approach.
   *  - "longTermProportion": held long-term; zakat on the holding's share of
   *    the company's/fund's zakatable assets. The proportion (%) is entered
   *    BY THE USER — some institutions publish proxy percentages, but this
   *    tool never bakes one in. A blank proportion EXCLUDES the holding from
   *    the totals and flags it (missingProportion), like a missing FX rate.
   * Any unrecognised treatment falls back to full market value, so a
   * malformed import can never silently understate zakat.
   *
   * `excluded` accumulates the non-zakatable remainder of proportion items
   * (market value − zakatable share) so the figure is available to show.
   */
  function totalInvestments(items) {
    const out = { items: [], zakatable: 0, excluded: 0, missingProportion: false };
    (items || []).forEach(function (item) {
      const marketValue = toNumber(item.value);
      const treatment = item.treatment === "longTermFull" || item.treatment === "longTermProportion"
        ? item.treatment
        : "trading";
      let appliedPct = 100;
      let missing = false;
      if (treatment === "longTermProportion") {
        const pct = parseProportionPct(item.zakatablePct);
        if (pct === null) { missing = true; appliedPct = null; }
        else appliedPct = pct;
      }
      const zakatableValue = missing ? 0 : marketValue * (appliedPct / 100);
      out.items.push({
        id: item.id,
        label: item.label || "",
        treatment: treatment,
        marketValue: marketValue,
        appliedPct: appliedPct,          // 100 for trading/longTermFull; null when missing
        gbpValue: zakatableValue,        // the amount the breakdown line shows
        missingProportion: missing,
      });
      if (missing) out.missingProportion = true;
      else {
        out.zakatable += zakatableValue;
        out.excluded += marketValue - zakatableValue;
      }
    });
    return out;
  }

  /**
   * Pensions (workplace DC, SIPPs, defined benefit).
   *
   * Position applied (a significant scholarly-difference area — both DC
   * positions are stated neutrally in the UI and README; the user picks per
   * pot):
   *  - "dcAnnual": the pot is owned wealth invested on the user's behalf —
   *    zakat annually on pot value × a USER-ENTERED zakatable proportion
   *    (%). Blank proportion: excluded and flagged, never guessed.
   *  - "dcDeferred": the view that there is no effective access until
   *    retirement, so zakat falls due on access/receipt — the pot is
   *    recorded and shown EXCLUDED (like income property).
   *  - "db": a defined-benefit scheme promises a future income rather than
   *    a pot the user owns — not zakatable until amounts are received.
   *    Recorded, excluded.
   * Any unrecognised type is excluded (recorded, not counted) — the tool
   * will not invent a zakatable treatment. Employer-vs-personal
   * contributions and unvested amounts are out of granular scope (stated
   * in the UI).
   */
  function totalPensions(items) {
    const out = { items: [], zakatable: 0, excluded: 0, missingProportion: false };
    (items || []).forEach(function (item) {
      const potValue = toNumber(item.value);
      const type = item.type || "dcAnnual";
      const isAnnual = type === "dcAnnual";
      let appliedPct = null;
      let missing = false;
      let zakatableValue = 0;
      if (isAnnual) {
        const pct = parseProportionPct(item.zakatablePct);
        if (pct === null) missing = true;
        else { appliedPct = pct; zakatableValue = potValue * (pct / 100); }
      }
      out.items.push({
        id: item.id,
        label: item.label || "",
        type: type,
        potValue: potValue,
        appliedPct: appliedPct,
        // dcAnnual: the zakatable slice; excluded types: the full pot, so
        // the UI strikes it through exactly like income property.
        gbpValue: isAnnual ? zakatableValue : potValue,
        zakatable: isAnnual && !missing,
        missingProportion: missing,
      });
      if (missing) out.missingProportion = true;
      else if (isAnnual) {
        out.zakatable += zakatableValue;
        out.excluded += potValue - zakatableValue;
      } else {
        out.excluded += potValue;
      }
    });
    return out;
  }

  /**
   * Debts & deductions.
   *
   * Position applied (a known difference-of-opinion area — both positions are
   * stated in the UI and README):
   *  - "shortTerm": liabilities due within the coming year (bills, tax due,
   *    credit cards, money borrowed) — deducted in full.
   *  - "longTermYear": the next 12 months of instalments on long-term debt
   *    (e.g. a mortgage) — deducted, per the commonly held view.
   *  - "longTermBalance": the remaining long-term balance beyond 12 months —
   *    NOT deducted by this tool. It is shown in the breakdown so the user
   *    following the (minority) full-deduction view can see the figure and
   *    take it to a scholar.
   */
  function totalDeductions(items) {
    const out = { items: [], deductible: 0, excluded: 0 };
    (items || []).forEach(function (item) {
      const amount = toNumber(item.amount);
      const isDeductible = item.type === "shortTerm" || item.type === "longTermYear";
      out.items.push({
        id: item.id,
        label: item.label || "",
        type: item.type || "shortTerm",
        gbpValue: amount,
        deductible: isDeductible,
      });
      if (isDeductible) out.deductible += amount;
      else out.excluded += amount;
    });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Nisab & hawl
   * ------------------------------------------------------------------ */

  /**
   * Both nisab thresholds in GBP, from user-supplied prices per gram.
   * Returns null for a threshold whose price is missing — the UI must then
   * ask for the price rather than compare against a fabricated number.
   * `convention` selects the gram convention ("87.48" or "85"); anything
   * unrecognised falls back to the default rather than throwing.
   */
  function nisabThresholds(goldPricePerGram, silverPricePerGram, convention) {
    const grams = NISAB_CONVENTIONS[convention] || NISAB_CONVENTIONS["87.48"];
    const gold = toNumber(goldPricePerGram);
    const silver = toNumber(silverPricePerGram);
    return {
      gold: gold > 0 ? grams.gold * gold : null,
      silver: silver > 0 ? grams.silver * silver : null,
      goldGrams: grams.gold,
      silverGrams: grams.silver,
    };
  }

  /**
   * Hijri calendar support, via the JavaScript built-in Umm al-Qura calendar
   * (`Intl.DateTimeFormat` with `islamic-umalqura`) — no dependency, works in
   * Node and every modern browser.
   *
   * Integrity note (surfaced in the UI): Umm al-Qura is a *calculated* civil
   * calendar. Actual moon sighting in your locality can differ from it by a
   * day or two, so dates shown from it are a strong estimate, not a ruling
   * on when your hawl completes.
   *
   * All Hijri functions parse ISO "YYYY-MM-DD" input in UTC (so results do
   * not shift with the user's timezone) and return null on invalid input or
   * when the environment lacks the calendar — callers must fall back (the UI
   * falls back to addLunarYear) rather than assume support.
   */

  function parseIsoUtc(isoDate) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
    const d = new Date(isoDate + "T00:00:00Z");
    return isNaN(d.getTime()) ? null : d;
  }

  function hijriFormatter(options) {
    return new Intl.DateTimeFormat(
      "en-u-ca-islamic-umalqura",
      Object.assign({ timeZone: "UTC" }, options)
    );
  }

  /**
   * The Hijri (Umm al-Qura) date of a Gregorian ISO date, as numbers:
   * { year, month (1–12), day }. Returns null on invalid input or missing
   * calendar support.
   */
  function hijriParts(isoDate) {
    const d = parseIsoUtc(isoDate);
    if (!d) return null;
    try {
      const parts = hijriFormatter({ year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
      const num = function (type) {
        const p = parts.find(function (x) { return x.type === type; });
        return p ? parseInt(p.value, 10) : NaN;
      };
      const out = { year: num("year"), month: num("month"), day: num("day") };
      if (![out.year, out.month, out.day].every(Number.isFinite)) return null;
      return out;
    } catch (e) {
      return null;
    }
  }

  /**
   * Human-readable Hijri date, e.g. "27 Muharram 1448 AH".
   * Assembled from parts so the ordering is stable across locales/engines.
   */
  function formatHijri(isoDate) {
    const d = parseIsoUtc(isoDate);
    if (!d) return null;
    try {
      const parts = hijriFormatter({ year: "numeric", month: "long", day: "numeric" }).formatToParts(d);
      const get = function (type) {
        const p = parts.find(function (x) { return x.type === type; });
        return p ? p.value : null;
      };
      const day = get("day"), month = get("month"), year = get("year");
      if (!day || !month || !year) return null;
      return day + " " + month + " " + year + " AH";
    } catch (e) {
      return null;
    }
  }

  /**
   * The TRUE next zakat anniversary: the same Hijri day and month in the
   * following Hijri year, converted back to a Gregorian ISO date.
   *
   * Intl can only convert Gregorian→Hijri, so the reverse is found by
   * scanning Gregorian dates 340–390 days ahead (a Hijri year is 354 or 355
   * days, so the window comfortably brackets the target month) for the one
   * whose Hijri representation matches.
   *
   * Day-30 edge case: if the anniversary falls on the 30th of a month that
   * has only 29 days in the following year, the last existing day of that
   * month (the 29th) is used — the anniversary cannot land in a different
   * month. Returns null when the calendar is unavailable.
   */
  function nextLunarAnniversary(isoDate) {
    const start = hijriParts(isoDate);
    const base = parseIsoUtc(isoDate);
    if (!start || !base) return null;
    const targetYear = start.year + 1;
    let lastDayOfMonthIso = null;
    let lastDaySeen = 0;
    for (let offset = 340; offset <= 390; offset++) {
      const d = new Date(base.getTime());
      d.setUTCDate(d.getUTCDate() + offset);
      const iso = d.toISOString().slice(0, 10);
      const h = hijriParts(iso);
      if (!h) return null;
      if (h.year !== targetYear || h.month !== start.month) continue;
      if (h.day === start.day) return iso;
      if (h.day > lastDaySeen) {
        lastDaySeen = h.day;
        lastDayOfMonthIso = iso;
      }
    }
    return lastDayOfMonthIso;
  }

  /**
   * Approximate next anniversary: the given date plus 354 days. Kept as the
   * FALLBACK for environments without Intl calendar support — prefer
   * nextLunarAnniversary. Parsing is done in UTC so the result does not
   * shift with the user's timezone. Returns null for missing/invalid input.
   */
  function addLunarYear(isoDate) {
    const d = parseIsoUtc(isoDate);
    if (!d) return null;
    d.setUTCDate(d.getUTCDate() + 354);
    return d.toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------------ *
   * The full calculation
   * ------------------------------------------------------------------ */

  /**
   * Compute the complete zakat summary from the app state.
   *
   * @param {object} state — see app.js for the shape; only the fields used
   *   here matter: state.settings {goldPricePerGram, silverPricePerGram,
   *   nisabBasis: "gold"|"silver", fxRates, timing: "lunar"|"gregorian"} and
   *   the eight item arrays.
   * @returns a summary object with per-category itemisation, totals, nisab
   *   comparison and the amount due. `zakatDue` is null when the chosen
   *   nisab threshold cannot be computed (missing metal price) — the tool
   *   refuses to declare an amount due without a real threshold.
   */
  function calculateZakat(state) {
    const s = (state && state.settings) || {};
    const goldPrice = toNumber(s.goldPricePerGram);
    const silverPrice = toNumber(s.silverPricePerGram);

    const cash = totalCash(state.cash, s.fxRates || {});
    const metals = totalMetals(state.metals, goldPrice, silverPrice);
    const crypto = totalCrypto(state.crypto);
    const business = totalBusiness(state.business);
    const property = totalProperty(state.property);
    const investments = totalInvestments(state.investments);
    const pensions = totalPensions(state.pensions);
    const debts = totalDeductions(state.debts);

    const grossZakatable = cash.total + metals.total + crypto.total + business.net
      + property.zakatable + investments.zakatable + pensions.zakatable;
    // Personal deductions cannot push zakatable wealth below zero.
    const netZakatable = Math.max(0, grossZakatable - debts.deductible);

    const convention = NISAB_CONVENTIONS[s.nisabConvention] ? s.nisabConvention : "87.48";
    const thresholds = nisabThresholds(goldPrice, silverPrice, convention);
    const basis = s.nisabBasis === "gold" ? "gold" : "silver";
    const applied = thresholds[basis];

    // Zakat is due when net zakatable wealth REACHES the nisab (>=), i.e.
    // owning exactly the nisab obligates zakat.
    const meetsNisab = applied === null ? null : netZakatable >= applied;

    const rate = s.timing === "gregorian" ? RATE_GREGORIAN : RATE_LUNAR;

    let zakatDue;
    if (applied === null) zakatDue = null; // can't judge without a threshold
    else if (!meetsNisab) zakatDue = 0;
    else zakatDue = roundUpToPenny(netZakatable * rate);

    return {
      cash: cash,
      metals: metals,
      crypto: crypto,
      business: business,
      property: property,
      investments: investments,
      pensions: pensions,
      debts: debts,
      grossZakatable: grossZakatable,
      totalDeductions: debts.deductible,
      netZakatable: netZakatable,
      nisab: {
        gold: thresholds.gold,
        silver: thresholds.silver,
        goldGrams: thresholds.goldGrams,
        silverGrams: thresholds.silverGrams,
        convention: convention,
        basis: basis,
        applied: applied,
      },
      meetsNisab: meetsNisab,
      rate: rate,
      zakatDue: zakatDue,
    };
  }

  return {
    NISAB_GOLD_GRAMS: NISAB_GOLD_GRAMS,
    NISAB_SILVER_GRAMS: NISAB_SILVER_GRAMS,
    NISAB_CONVENTIONS: NISAB_CONVENTIONS,
    LUNAR_YEAR_DAYS: LUNAR_YEAR_DAYS,
    RATE_LUNAR: RATE_LUNAR,
    RATE_GREGORIAN: RATE_GREGORIAN,
    SUPPORTED_CURRENCIES: SUPPORTED_CURRENCIES,
    toNumber: toNumber,
    roundUpToPenny: roundUpToPenny,
    parseProportionPct: parseProportionPct,
    convertToGbp: convertToGbp,
    goldPurityFactor: goldPurityFactor,
    silverPurityFactor: silverPurityFactor,
    metalItemValue: metalItemValue,
    totalCash: totalCash,
    totalMetals: totalMetals,
    totalCrypto: totalCrypto,
    totalBusiness: totalBusiness,
    totalProperty: totalProperty,
    totalInvestments: totalInvestments,
    totalPensions: totalPensions,
    totalDeductions: totalDeductions,
    nisabThresholds: nisabThresholds,
    hijriParts: hijriParts,
    formatHijri: formatHijri,
    nextLunarAnniversary: nextLunarAnniversary,
    addLunarYear: addLunarYear,
    calculateZakat: calculateZakat,
  };
});
