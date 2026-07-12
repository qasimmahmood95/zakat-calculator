/**
 * app.js — UI wiring for the zakat calculator.
 *
 * Responsibilities: render line-item rows, keep the state object in sync with
 * the inputs, and display the summary. ALL arithmetic is delegated to calc.js
 * (window.ZakatCalc) so it stays testable in Node — nothing in this file
 * adds, multiplies or rounds a monetary amount.
 *
 * Privacy: state is autosaved to localStorage under STORAGE_KEY and nowhere
 * else. No network requests are made from this file.
 */
(function () {
  "use strict";

  const Z = window.ZakatCalc;
  const STORAGE_KEY = "zakat-calculator-v1";
  const THEME_KEY = "zakat-theme";

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  let nextId = 1;

  function newId() {
    return nextId++;
  }

  function defaultState() {
    return {
      settings: {
        goldPricePerGram: "",
        silverPricePerGram: "",
        nisabBasis: "silver",
        nisabConvention: "87.48",
        fxRates: { USD: "", EUR: "", AED: "" },
        hawlDate: "",
        timing: "lunar",
      },
      cash: [{ id: newId(), label: "", amount: "", currency: "GBP" }],
      metals: [],
      crypto: [],
      business: [],
      property: [],
      debts: [],
    };
  }

  const SECTIONS = ["cash", "metals", "crypto", "business", "property", "debts"];

  function blankItem(section) {
    switch (section) {
      case "cash": return { id: newId(), label: "", amount: "", currency: "GBP" };
      case "metals": return { id: newId(), label: "", metal: "gold", entryMode: "weight", grams: "", purity: 24, value: "" };
      case "crypto": return { id: newId(), label: "", quantity: "", price: "" };
      case "business": return { id: newId(), label: "", type: "cash", value: "", ownershipPct: 100 };
      case "property": return { id: newId(), label: "", type: "rentalIncome", value: "" };
      case "debts": return { id: newId(), label: "", type: "shortTerm", amount: "" };
    }
  }

  let state = defaultState();

  /* ------------------------------------------------------------------ *
   * Persistence (localStorage only — nothing leaves the browser)
   * ------------------------------------------------------------------ */

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage may be unavailable (private mode) — the app still works */
    }
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 300);
  }

  /**
   * Adopt a plain state object (from localStorage or an imported file),
   * merging it over defaults so missing or newly added fields get sane
   * values and malformed sections are dropped rather than crashing the app.
   * Throws on anything that is not a state-shaped object.
   */
  function adoptState(parsed) {
    if (!parsed || typeof parsed !== "object") throw new Error("not a state object");
    const base = defaultState();
    state = {
      settings: Object.assign(base.settings, parsed.settings || {}),
      cash: Array.isArray(parsed.cash) ? parsed.cash : [],
      metals: Array.isArray(parsed.metals) ? parsed.metals : [],
      crypto: Array.isArray(parsed.crypto) ? parsed.crypto : [],
      business: Array.isArray(parsed.business) ? parsed.business : [],
      property: Array.isArray(parsed.property) ? parsed.property : [],
      debts: Array.isArray(parsed.debts) ? parsed.debts : [],
    };
    state.settings.fxRates = Object.assign({ USD: "", EUR: "", AED: "" }, state.settings.fxRates || {});
    // Continue id numbering above anything adopted, then repair any item
    // that arrived without a usable id (row removal matches by numeric id).
    SECTIONS.forEach(function (s) {
      state[s].forEach(function (item) {
        if (typeof item.id === "number" && Number.isFinite(item.id) && item.id >= nextId) nextId = item.id + 1;
      });
    });
    SECTIONS.forEach(function (s) {
      state[s].forEach(function (item) {
        if (typeof item.id !== "number" || !Number.isFinite(item.id)) item.id = newId();
      });
    });
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      adoptState(JSON.parse(raw));
    } catch (e) {
      /* corrupted storage: start fresh rather than crash */
      state = defaultState();
    }
  }

  /* ------------------------------------------------------------------ *
   * Formatting helpers
   * ------------------------------------------------------------------ */

  const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
  const NUM = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  const CURRENCY_SYMBOL = { GBP: "£", USD: "$", EUR: "€", AED: "AED " };

  const BUSINESS_TYPE_LABEL = {
    cash: "Company cash",
    receivables: "Trade receivables",
    stock: "Stock-in-trade",
    liabilities: "Short-term liabilities (deducted)",
  };
  const PROPERTY_TYPE_LABEL = {
    rentalIncome: "Rental income held at zakat date (zakatable)",
    resale: "Property held for resale (zakatable at market value)",
    income: "Property held for income (not zakatable)",
  };
  const DEBT_TYPE_LABEL = {
    shortTerm: "Short-term — due within 12 months (deducted)",
    longTermYear: "Long-term — next 12 months of instalments (deducted)",
    longTermBalance: "Long-term — remaining balance (shown, NOT deducted)",
  };

  /* ------------------------------------------------------------------ *
   * Row templates
   * Each input/select carries data-section / data-id / data-field so a single
   * delegated listener keeps the state in sync. Fields that change the shape
   * of the row (selects) also carry data-rerender.
   * ------------------------------------------------------------------ */

  function field(section, item, name, labelText, inputHtml) {
    const id = section + "-" + item.id + "-" + name;
    return (
      '<div><label class="label" for="' + id + '">' + labelText + "</label>" +
      inputHtml.replace("%ID%", id) + "</div>"
    );
  }

  function dataAttrs(section, item, name) {
    return 'id="%ID%" data-section="' + section + '" data-id="' + item.id + '" data-field="' + name + '"';
  }

  function numberInput(section, item, name, placeholder, extra) {
    return (
      '<input class="input" type="number" min="0" step="any" inputmode="decimal" ' +
      dataAttrs(section, item, name) + ' value="' + esc(item[name]) + '" placeholder="' + esc(placeholder) + '" ' +
      (extra || "") + " />"
    );
  }

  function textInput(section, item, name, placeholder) {
    return (
      '<input class="input" type="text" ' + dataAttrs(section, item, name) +
      ' value="' + esc(item[name]) + '" placeholder="' + esc(placeholder) + '" />'
    );
  }

  function selectInput(section, item, name, options, rerender) {
    let html = '<select class="input" ' + dataAttrs(section, item, name) + (rerender ? ' data-rerender="1"' : "") + ">";
    options.forEach(function (opt) {
      html += '<option value="' + esc(opt[0]) + '"' + (String(item[name]) === String(opt[0]) ? " selected" : "") + ">" + esc(opt[1]) + "</option>";
    });
    return html + "</select>";
  }

  function removeButton(section, item) {
    return (
      '<button type="button" class="btn-remove no-print" data-remove="' + section + '" data-id="' + item.id +
      '" aria-label="Remove this ' + section + ' item">&#10005;</button>'
    );
  }

  function rowShell(section, item, inner) {
    return (
      '<div class="item-row" data-row="' + section + "-" + item.id + '">' +
      '<div class="col-span-2 grid flex-1 gap-2 sm:col-span-1 sm:grid-cols-2 md:grid-cols-4">' + inner + "</div>" +
      '<div class="col-span-2 justify-self-end sm:col-span-1">' + removeButton(section, item) + "</div></div>"
    );
  }

  function cashRow(item) {
    return rowShell("cash", item,
      field("cash", item, "label", "Description", textInput("cash", item, "label", "e.g. Monzo current account")) +
      field("cash", item, "amount", "Amount", numberInput("cash", item, "amount", "0.00")) +
      field("cash", item, "currency", "Currency", selectInput("cash", item, "currency",
        Z.SUPPORTED_CURRENCIES.map(function (c) { return [c, c]; })))
    );
  }

  function metalsRow(item) {
    const isWeight = item.entryMode !== "value";
    const purityOptions = item.metal === "silver"
      ? [[999, "999 (fine)"], [958, "958 (Britannia)"], [925, "925 (sterling)"], [800, "800"]]
      : [[24, "24k"], [22, "22k (incl. Sovereigns/Britannias)"], [21, "21k"], [18, "18k"], [14, "14k"], [9, "9k"]];
    let inner =
      field("metals", item, "label", "Description", textInput("metals", item, "label", "e.g. wedding set, Sovereign coins")) +
      field("metals", item, "metal", "Metal", selectInput("metals", item, "metal", [["gold", "Gold"], ["silver", "Silver"]], true)) +
      field("metals", item, "entryMode", "Enter by", selectInput("metals", item, "entryMode", [["weight", "Weight & purity"], ["value", "Value (£)"]], true));
    if (isWeight) {
      inner +=
        field("metals", item, "grams", "Weight (g)", numberInput("metals", item, "grams", "0.0")) +
        field("metals", item, "purity", "Purity", selectInput("metals", item, "purity", purityOptions));
    } else {
      inner += field("metals", item, "value", "Value (£)", numberInput("metals", item, "value", "0.00"));
    }
    return rowShell("metals", item, inner);
  }

  function cryptoRow(item) {
    return rowShell("crypto", item,
      field("crypto", item, "label", "Asset", textInput("crypto", item, "label", "e.g. BTC")) +
      field("crypto", item, "quantity", "Quantity", numberInput("crypto", item, "quantity", "0.0")) +
      field("crypto", item, "price", "Price per unit (£)", numberInput("crypto", item, "price", "you must enter this"))
    );
  }

  function businessRow(item) {
    return rowShell("business", item,
      field("business", item, "label", "Description", textInput("business", item, "label", "e.g. company current account")) +
      field("business", item, "type", "Type", selectInput("business", item, "type", [
        ["cash", "Cash"], ["receivables", "Receivables"], ["stock", "Stock-in-trade"], ["liabilities", "Short-term liabilities (deduct)"],
      ])) +
      field("business", item, "value", "Value (£)", numberInput("business", item, "value", "0.00")) +
      field("business", item, "ownershipPct", "Your ownership (%)", numberInput("business", item, "ownershipPct", "100", 'max="100"'))
    );
  }

  function propertyRow(item) {
    return rowShell("property", item,
      field("property", item, "label", "Description", textInput("property", item, "label", "e.g. flat on Mill Road")) +
      field("property", item, "type", "Treatment", selectInput("property", item, "type", [
        ["rentalIncome", "Rental income held at zakat date"], ["resale", "Property held for resale"], ["income", "Property held for income (not zakatable)"],
      ])) +
      field("property", item, "value", "Amount / market value (£)", numberInput("property", item, "value", "0.00"))
    );
  }

  function debtsRow(item) {
    return rowShell("debts", item,
      field("debts", item, "label", "Description", textInput("debts", item, "label", "e.g. credit card, mortgage")) +
      field("debts", item, "type", "Type", selectInput("debts", item, "type", [
        ["shortTerm", "Short-term (due within 12 months)"], ["longTermYear", "Long-term: next 12 months of instalments"], ["longTermBalance", "Long-term: remaining balance (not deducted)"],
      ])) +
      field("debts", item, "amount", "Amount (£)", numberInput("debts", item, "amount", "0.00"))
    );
  }

  const ROW_TEMPLATE = { cash: cashRow, metals: metalsRow, crypto: cryptoRow, business: businessRow, property: propertyRow, debts: debtsRow };

  function renderSection(section) {
    const container = document.querySelector('[data-items="' + section + '"]');
    const items = state[section];
    if (!items.length) {
      container.innerHTML = '<p class="text-sm italic text-slate-400 dark:text-slate-500">Nothing added.</p>';
      return;
    }
    container.innerHTML = items.map(ROW_TEMPLATE[section]).join("");
  }

  /* ------------------------------------------------------------------ *
   * Results rendering
   * ------------------------------------------------------------------ */

  function isBlankItem(section, item) {
    // Skip untouched rows in the breakdown so an empty form shows a clean panel.
    const fields = { cash: ["label", "amount"], metals: ["label", "grams", "value"], crypto: ["label", "quantity", "price"], business: ["label", "value"], property: ["label", "value"], debts: ["label", "amount"] }[section];
    return fields.every(function (f) { return item[f] === "" || item[f] == null; });
  }

  function breakdownLine(label, detail, valueHtml) {
    return (
      '<li class="flex items-baseline justify-between gap-3 py-1">' +
      '<span class="min-w-0"><span class="block truncate">' + label + "</span>" +
      (detail ? '<span class="block text-xs text-slate-500 dark:text-slate-400">' + detail + "</span>" : "") +
      "</span><span class=\"whitespace-nowrap font-medium\">" + valueHtml + "</span></li>"
    );
  }

  function categoryBlock(title, totalHtml, linesHtml) {
    return (
      '<div class="border-b border-slate-200 py-2 dark:border-slate-700">' +
      '<div class="flex items-baseline justify-between"><h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">' + title +
      '</h3><span class="text-xs font-semibold">' + totalHtml + "</span></div>" +
      '<ul class="mt-1">' + linesHtml + "</ul></div>"
    );
  }

  function mutedValue(text) {
    return '<span class="text-slate-400 line-through decoration-slate-400 dark:text-slate-500">' + text + "</span>";
  }

  function renderResults() {
    const r = Z.calculateZakat(state);
    let html = "";
    let anyItems = false;

    // --- Cash
    const cashLines = r.cash.items
      .filter(function (it, i) { return !isBlankItem("cash", state.cash[i]); })
      .map(function (it) {
        anyItems = true;
        const sym = CURRENCY_SYMBOL[it.currency] || "";
        const detail = it.currency === "GBP" ? "" : esc(sym + NUM.format(it.amount) + " " + it.currency);
        const value = it.missingRate
          ? '<span class="text-amber-600 dark:text-amber-400">rate needed</span>'
          : GBP.format(it.gbpValue);
        return breakdownLine(esc(it.label || "Cash"), detail, value);
      }).join("");
    if (cashLines) {
      let warn = "";
      if (r.cash.missingRates.length) {
        warn = '<p class="mt-1 rounded bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">&#9888;&#65039; Enter a ' +
          r.cash.missingRates.map(esc).join(", ") + " &rarr; GBP rate in Settings — these balances are currently excluded.</p>";
      }
      html += categoryBlock("Cash & bank", GBP.format(r.cash.total), cashLines) + warn;
    }

    // --- Metals
    // calc.js returns one result item per input item in the same order, so
    // the source of each line is simply the state item at the same index.
    const metalLines = r.metals.items
      .map(function (it, i) {
        const src = state.metals[i];
        if (isBlankItem("metals", src)) return "";
        anyItems = true;
        const detail = src.entryMode !== "value"
          ? esc(NUM.format(Z.toNumber(src.grams)) + " g · " + src.purity + (src.metal === "silver" ? " silver" : "k gold"))
          : "entered value";
        return breakdownLine(esc(it.label || (it.metal === "silver" ? "Silver" : "Gold")), detail, GBP.format(it.gbpValue));
      }).join("");
    if (metalLines) html += categoryBlock("Gold & silver", GBP.format(r.metals.total), metalLines);

    // --- Crypto
    const cryptoLines = r.crypto.items
      .map(function (it, i) {
        const src = state.crypto[i];
        if (isBlankItem("crypto", src)) return "";
        anyItems = true;
        const detail = esc(NUM.format(Z.toNumber(src.quantity)) + " × " + GBP.format(Z.toNumber(src.price)));
        return breakdownLine(esc(it.label || "Cryptoasset"), detail, GBP.format(it.gbpValue));
      }).join("");
    if (cryptoLines) html += categoryBlock("Cryptoassets", GBP.format(r.crypto.total), cryptoLines);

    // --- Business
    const businessLines = r.business.items
      .filter(function (it, i) { return !isBlankItem("business", state.business[i]); })
      .map(function (it) {
        anyItems = true;
        const detail = esc(BUSINESS_TYPE_LABEL[it.type] + (it.ownershipPct !== 100 ? " · " + it.ownershipPct + "% share" : ""));
        const value = it.deduction ? "−" + GBP.format(it.gbpValue) : GBP.format(it.gbpValue);
        return breakdownLine(esc(it.label || "Business line"), detail, value);
      }).join("");
    if (businessLines) html += categoryBlock("Business (your share, net)", GBP.format(r.business.net), businessLines);

    // --- Property
    const propertyLines = r.property.items
      .filter(function (it, i) { return !isBlankItem("property", state.property[i]); })
      .map(function (it) {
        anyItems = true;
        const value = it.zakatable ? GBP.format(it.gbpValue) : mutedValue(GBP.format(it.gbpValue)) + ' <span class="text-xs text-slate-400">not counted</span>';
        return breakdownLine(esc(it.label || "Property"), esc(PROPERTY_TYPE_LABEL[it.type]), value);
      }).join("");
    if (propertyLines) html += categoryBlock("Investment property", GBP.format(r.property.zakatable), propertyLines);

    // --- Debts
    const debtLines = r.debts.items
      .filter(function (it, i) { return !isBlankItem("debts", state.debts[i]); })
      .map(function (it) {
        anyItems = true;
        const value = it.deductible
          ? "−" + GBP.format(it.gbpValue)
          : mutedValue(GBP.format(it.gbpValue)) + ' <span class="text-xs text-slate-400">not deducted</span>';
        return breakdownLine(esc(it.label || "Debt"), esc(DEBT_TYPE_LABEL[it.type]), value);
      }).join("");
    if (debtLines) html += categoryBlock("Debts & deductions", "−" + GBP.format(r.debts.deductible), debtLines);

    if (!anyItems) {
      html = '<p class="italic text-slate-500 dark:text-slate-400">Add your assets on the left to see an itemised calculation here.</p>';
    }

    // --- Totals
    html +=
      '<dl class="mt-3 space-y-1">' +
      '<div class="flex justify-between"><dt>Total zakatable assets</dt><dd class="font-medium">' + GBP.format(r.grossZakatable) + "</dd></div>" +
      '<div class="flex justify-between"><dt>Deductions</dt><dd class="font-medium">−' + GBP.format(r.totalDeductions) + "</dd></div>" +
      '<div class="flex justify-between border-t border-slate-300 pt-1 text-base font-semibold dark:border-slate-600"><dt>Net zakatable wealth</dt><dd>' + GBP.format(r.netZakatable) + "</dd></div></dl>";

    // --- Nisab comparison
    const basisTag = ' <span class="rounded bg-emerald-100 px-1 text-[10px] font-semibold uppercase text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">chosen</span>';
    html +=
      '<div class="mt-4 rounded-xl bg-slate-100 p-3 dark:bg-slate-900/60">' +
      '<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Nisab comparison</h3>' +
      '<dl class="mt-1 space-y-1 text-sm">' +
      '<div class="flex justify-between"><dt>Silver (' + r.nisab.silverGrams + " g)" + (r.nisab.basis === "silver" ? basisTag : "") + "</dt><dd>" +
      (r.nisab.silver === null ? '<span class="text-amber-600 dark:text-amber-400">enter silver price</span>' : GBP.format(r.nisab.silver)) + "</dd></div>" +
      '<div class="flex justify-between"><dt>Gold (' + r.nisab.goldGrams + " g)" + (r.nisab.basis === "gold" ? basisTag : "") + "</dt><dd>" +
      (r.nisab.gold === null ? '<span class="text-amber-600 dark:text-amber-400">enter gold price</span>' : GBP.format(r.nisab.gold)) + "</dd></div></dl>";
    if (r.meetsNisab === null) {
      html += '<p class="mt-2 text-xs text-amber-700 dark:text-amber-300">Enter the ' + r.nisab.basis + " price in Settings to compare your wealth with the nisab.</p>";
    } else if (r.meetsNisab) {
      html += '<p class="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">Your net wealth is at or above the ' + r.nisab.basis + " nisab &mdash; zakat is due.</p>";
    } else {
      html += '<p class="mt-2 text-xs font-medium text-slate-600 dark:text-slate-300">Your net wealth is below the ' + r.nisab.basis + " nisab &mdash; no zakat is due.</p>";
    }
    html += "</div>";

    // --- Amount due
    const rateLabel = state.settings.timing === "gregorian"
      ? (r.rate * 100).toFixed(3) + "% (Gregorian-adjusted — approximation)"
      : "2.5% (lunar year)";
    const dueText = r.zakatDue === null ? "—" : GBP.format(r.zakatDue);
    html +=
      '<div class="mt-4 rounded-xl bg-emerald-600 p-4 text-white dark:bg-emerald-700">' +
      '<p class="text-xs font-semibold uppercase tracking-wide text-emerald-100">Zakat due at ' + rateLabel + "</p>" +
      '<p class="mt-1 text-3xl font-bold tracking-tight">' + dueText + "</p>" +
      (r.zakatDue !== null && r.zakatDue > 0 ? '<p class="mt-1 text-xs text-emerald-100">Rounded up to the penny so rounding never underpays.</p>' : "") +
      "</div>";

    document.getElementById("results-body").innerHTML = html;

    // Print-only: list the positions applied so a printed summary stands on
    // its own. Dynamic pieces (basis, gram convention, rate) come from the
    // same calculation as the figures above.
    document.getElementById("print-positions").innerHTML =
      '<h3 class="mt-4 border-t border-slate-300 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Positions applied (commonly held views — differences are flagged in the app)</h3>' +
      '<ul class="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-600">' +
      "<li>Nisab: " + r.nisab.basis + " basis, on the " + r.nisab.goldGrams + " g gold / " + r.nisab.silverGrams + " g silver gram convention.</li>" +
      "<li>Rate: " + rateLabel + ". Wealth is assessed as held on the zakat date.</li>" +
      "<li>Gold and silver valued at metal content; whether personal-use jewellery is included depends on madhhab.</li>" +
      "<li>Business: ownership % &times; (cash + receivables + stock &minus; short-term liabilities), floored at zero.</li>" +
      "<li>Property: rental income held at the zakat date zakatable; income-property value excluded; resale property at market value.</li>" +
      "<li>Debts: amounts due within 12 months deducted; remaining long-term balances shown but not deducted.</li>" +
      "<li>Zakat due rounded up to the penny. Educational tool — not a fatwa; consult a scholar for your madhhab.</li>" +
      "</ul>";

    // Screen-reader announcement (persistent live region, debounced by input flow).
    document.getElementById("sr-live").textContent =
      r.zakatDue === null ? "Enter metal prices to compute zakat due." : "Zakat due: " + GBP.format(r.zakatDue);

    // Settings-panel niceties driven by the same calculation.
    document.getElementById("nisab-silver-amount").textContent = r.nisab.silver === null ? "enter silver price" : GBP.format(r.nisab.silver);
    document.getElementById("nisab-gold-amount").textContent = r.nisab.gold === null ? "enter gold price" : GBP.format(r.nisab.gold);
    document.getElementById("nisab-silver-grams").textContent = r.nisab.silverGrams;
    document.getElementById("nisab-gold-grams").textContent = r.nisab.goldGrams;

    // Prefer the true Hijri anniversary (Umm al-Qura via Intl); fall back to
    // the 354-day approximation only where the calendar is unsupported.
    const hawl = state.settings.hawlDate;
    const exact = Z.nextLunarAnniversary(hawl);
    const nextEl = document.getElementById("next-anniversary");
    if (exact) {
      nextEl.textContent =
        "That is " + Z.formatHijri(hawl) + ". Next anniversary: " + exact + " (" + Z.formatHijri(exact) + ").";
    } else {
      const approx = Z.addLunarYear(hawl);
      nextEl.textContent = approx
        ? "Next lunar anniversary ≈ " + approx + " (354-day approximation — this browser lacks Hijri calendar support)."
        : "Pick the date your wealth first reached nisab, or your usual zakat date.";
    }

    document.getElementById("gregorian-warning").classList.toggle("hidden", state.settings.timing !== "gregorian");

    document.getElementById("crypto-date-note").textContent = state.settings.hawlDate
      ? "as at your zakat date (" + state.settings.hawlDate + ")"
      : "as at your zakat date";
  }

  function refresh() {
    renderResults();
    scheduleSave();
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  function bindSettings() {
    const map = [
      ["gold-price", function (v) { state.settings.goldPricePerGram = v; }],
      ["silver-price", function (v) { state.settings.silverPricePerGram = v; }],
      ["fx-usd", function (v) { state.settings.fxRates.USD = v; }],
      ["fx-eur", function (v) { state.settings.fxRates.EUR = v; }],
      ["fx-aed", function (v) { state.settings.fxRates.AED = v; }],
      ["hawl-date", function (v) { state.settings.hawlDate = v; }],
    ];
    map.forEach(function (pair) {
      document.getElementById(pair[0]).addEventListener("input", function (e) {
        pair[1](e.target.value);
        refresh();
      });
    });
    document.querySelectorAll('input[name="nisab-basis"]').forEach(function (radio) {
      radio.addEventListener("change", function (e) {
        state.settings.nisabBasis = e.target.value;
        refresh();
      });
    });
    document.querySelectorAll('input[name="timing"]').forEach(function (radio) {
      radio.addEventListener("change", function (e) {
        state.settings.timing = e.target.value;
        refresh();
      });
    });
    document.querySelectorAll('input[name="nisab-convention"]').forEach(function (radio) {
      radio.addEventListener("change", function (e) {
        state.settings.nisabConvention = e.target.value;
        refresh();
      });
    });
  }

  function populateSettings() {
    document.getElementById("gold-price").value = state.settings.goldPricePerGram;
    document.getElementById("silver-price").value = state.settings.silverPricePerGram;
    document.getElementById("fx-usd").value = state.settings.fxRates.USD;
    document.getElementById("fx-eur").value = state.settings.fxRates.EUR;
    document.getElementById("fx-aed").value = state.settings.fxRates.AED;
    document.getElementById("hawl-date").value = state.settings.hawlDate;
    document.querySelectorAll('input[name="nisab-basis"]').forEach(function (radio) {
      radio.checked = radio.value === state.settings.nisabBasis;
    });
    document.querySelectorAll('input[name="timing"]').forEach(function (radio) {
      radio.checked = radio.value === state.settings.timing;
    });
    document.querySelectorAll('input[name="nisab-convention"]').forEach(function (radio) {
      radio.checked = radio.value === state.settings.nisabConvention;
    });
  }

  function bindItemEvents() {
    document.addEventListener("click", function (e) {
      const addBtn = e.target.closest("[data-add]");
      if (addBtn) {
        const section = addBtn.getAttribute("data-add");
        state[section].push(blankItem(section));
        renderSection(section);
        refresh();
        // Focus the first field of the new row for keyboard users.
        const rows = document.querySelectorAll('[data-items="' + section + '"] [data-row]');
        const last = rows[rows.length - 1];
        if (last) { const first = last.querySelector("input,select"); if (first) first.focus(); }
        return;
      }
      const removeBtn = e.target.closest("[data-remove]");
      if (removeBtn) {
        const section = removeBtn.getAttribute("data-remove");
        const id = Number(removeBtn.getAttribute("data-id"));
        state[section] = state[section].filter(function (item) { return item.id !== id; });
        renderSection(section);
        refresh();
      }
    });

    ["input", "change"].forEach(function (evName) {
      document.addEventListener(evName, function (e) {
        const el = e.target;
        if (!el.dataset || !el.dataset.section) return;
        const section = el.dataset.section;
        const id = Number(el.dataset.id);
        const item = state[section].find(function (it) { return it.id === id; });
        if (!item) return;
        if (item[el.dataset.field] === el.value) return; // change after input: no-op
        item[el.dataset.field] = el.value;
        if (el.dataset.rerender) renderSection(section); // metal/entry-mode switch alters the row's fields
        refresh();
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Theme, print, clear
   * ------------------------------------------------------------------ */

  function bindChrome() {
    const toggle = document.getElementById("theme-toggle");
    function syncPressed() {
      toggle.setAttribute("aria-pressed", String(document.documentElement.classList.contains("dark")));
    }
    syncPressed();
    toggle.addEventListener("click", function () {
      const dark = document.documentElement.classList.toggle("dark");
      try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch (e) {}
      syncPressed();
    });

    // Print in light mode regardless of theme, restoring afterwards.
    let wasDark = false;
    window.addEventListener("beforeprint", function () {
      document.getElementById("print-date-line").textContent =
        "Generated " + new Date().toISOString().slice(0, 10) + " from figures entered by the user · qasimmahmood95.github.io/zakat-calculator";
      wasDark = document.documentElement.classList.contains("dark");
      if (wasDark) document.documentElement.classList.remove("dark");
    });
    window.addEventListener("afterprint", function () {
      if (wasDark) document.documentElement.classList.add("dark");
    });
    document.getElementById("print-btn").addEventListener("click", function () { window.print(); });

    document.getElementById("clear-btn").addEventListener("click", function () {
      if (!window.confirm("Clear everything you have entered? This wipes the autosaved data from this browser.")) return;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      nextId = 1;
      state = defaultState();
      populateSettings();
      SECTIONS.forEach(renderSection);
      renderResults();
    });
  }

  /* ------------------------------------------------------------------ *
   * Export / import — a JSON file saved to and read from the user's own
   * device. No upload, no clipboard, no third party: the Blob download and
   * FileReader below are the whole data path.
   * ------------------------------------------------------------------ */

  function bindDataTransfer() {
    document.getElementById("export-btn").addEventListener("click", function () {
      const payload = {
        app: "zakat-calculator",
        schema: 1,
        exported: new Date().toISOString().slice(0, 10),
        state: state,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "zakat-data-" + payload.exported + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    const fileInput = document.getElementById("import-file");
    document.getElementById("import-btn").addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (!parsed || parsed.app !== "zakat-calculator" || typeof parsed.state !== "object") {
            throw new Error("not a zakat-calculator export");
          }
          if (!window.confirm("Importing replaces everything currently entered. Continue?")) {
            fileInput.value = "";
            return;
          }
          adoptState(parsed.state);
          populateSettings();
          SECTIONS.forEach(renderSection);
          refresh();
        } catch (e) {
          window.alert("Could not import this file — it does not look like an export from this tool.");
        }
        fileInput.value = "";
      };
      reader.readAsText(file);
    });
  }

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */

  // Persistent, visually hidden live region for screen readers (re-rendering
  // the results panel would otherwise recreate any live region inside it).
  const live = document.createElement("div");
  live.id = "sr-live";
  live.setAttribute("aria-live", "polite");
  live.className = "sr-only";
  document.body.appendChild(live);

  loadState();
  populateSettings();
  SECTIONS.forEach(renderSection);
  bindSettings();
  bindItemEvents();
  bindChrome();
  bindDataTransfer();
  renderResults();
})();
