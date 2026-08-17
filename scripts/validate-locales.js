#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const EXPECTED_LOCALES = [
  "en", "de", "fr", "es", "pt-BR", "pt-PT", "it", "nl", "pl", "cs",
  "sk", "hu", "ro", "bg", "el", "hr", "sl", "sr", "et", "lv",
  "lt", "fi", "sv", "da", "no", "tr", "ru", "uk", "ar", "he",
  "hi", "id", "ms", "th", "vi", "ko", "ja", "zh-CN", "zh-TW"
];

const PLACEHOLDER_REGEX = /(?:\${[^{}]+})|(?:{{[^{}]+}})|(?:{[^{}]+})|(?:%[0-9]*\$?[sdf])/g;

function extractPlaceholders(val) {
  if (typeof val !== "string") return [];
  const matches = val.match(PLACEHOLDER_REGEX);
  if (!matches) return [];
  return [...matches].sort();
}

function flatten(obj, prefix = "") {
  let res = {};
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return res;
  }
  for (const k of Object.keys(obj)) {
    const fullKey = prefix ? prefix + "." + k : k;
    if (typeof obj[k] === "object" && obj[k] !== null && !Array.isArray(obj[k])) {
      Object.assign(res, flatten(obj[k], fullKey));
    } else {
      res[fullKey] = obj[k];
    }
  }
  return res;
}

function validateLocales(i18nDir, options = {}) {
  const dir = i18nDir || path.resolve(__dirname, "..", "i18n");
  const enPath = path.join(dir, "en.json");

  if (!fs.existsSync(enPath)) {
    return {
      success: false,
      error: `Canonical source locale not found: ${enPath}`,
      results: []
    };
  }

  let enRaw;
  let enData;
  try {
    enRaw = fs.readFileSync(enPath, "utf8");
    if (enRaw.startsWith("\uFEFF")) {
      return { success: false, error: `en.json contains UTF-8 BOM`, results: [] };
    }
    enData = JSON.parse(enRaw);
  } catch (err) {
    return {
      success: false,
      error: `Failed to parse en.json: ${err.message}`,
      results: []
    };
  }

  const enFlat = flatten(enData);
  const enKeys = Object.keys(enFlat).sort();
  const results = [];
  let allPassed = true;

  for (const code of EXPECTED_LOCALES) {
    const filePath = path.join(dir, `${code}.json`);
    const row = {
      locale: code,
      keyCount: 0,
      missing: 0,
      extra: 0,
      typeErrors: 0,
      placeholderErrors: 0,
      status: "FAIL",
      details: []
    };

    if (!fs.existsSync(filePath)) {
      row.details.push(`File missing: ${filePath}`);
      row.missing = enKeys.length;
      results.push(row);
      allPassed = false;
      continue;
    }

    let raw;
    let data;
    try {
      raw = fs.readFileSync(filePath, "utf8");
      if (raw.startsWith("\uFEFF")) {
        row.details.push("File contains UTF-8 BOM");
      }
      data = JSON.parse(raw);
    } catch (err) {
      row.details.push(`JSON parse error: ${err.message}`);
      results.push(row);
      allPassed = false;
      continue;
    }

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      row.details.push("Root value is not a JSON object");
      results.push(row);
      allPassed = false;
      continue;
    }

    const targetFlat = flatten(data);
    const targetKeys = Object.keys(targetFlat).sort();
    row.keyCount = targetKeys.length;

    const missingKeys = enKeys.filter(k => !(k in targetFlat));
    const extraKeys = targetKeys.filter(k => !(k in enFlat));
    row.missing = missingKeys.length;
    row.extra = extraKeys.length;

    if (missingKeys.length > 0) {
      row.details.push(`Missing keys: ${missingKeys.slice(0, 5).join(", ")}${missingKeys.length > 5 ? "..." : ""}`);
    }
    if (extraKeys.length > 0) {
      row.details.push(`Extra keys: ${extraKeys.slice(0, 5).join(", ")}${extraKeys.length > 5 ? "..." : ""}`);
    }

    let typeErrors = 0;
    let placeholderErrors = 0;

    for (const k of enKeys) {
      if (k in targetFlat) {
        const enVal = enFlat[k];
        const targetVal = targetFlat[k];

        if (typeof enVal !== typeof targetVal) {
          typeErrors++;
          if (row.details.length < 5) {
            row.details.push(`Type mismatch at ${k}: expected ${typeof enVal}, got ${typeof targetVal}`);
          }
        } else if (typeof enVal === "string") {
          const enPh = extractPlaceholders(enVal);
          const targetPh = extractPlaceholders(targetVal);
          if (enPh.join(",") !== targetPh.join(",")) {
            placeholderErrors++;
            if (row.details.length < 5) {
              row.details.push(`Placeholder mismatch at ${k}: expected [${enPh.join(", ")}], got [${targetPh.join(", ")}]`);
            }
          }
        }
      }
    }

    row.typeErrors = typeErrors;
    row.placeholderErrors = placeholderErrors;

    const isOk = row.missing === 0 &&
                 row.extra === 0 &&
                 row.typeErrors === 0 &&
                 row.placeholderErrors === 0 &&
                 row.details.length === 0;

    row.status = isOk ? "PASS" : "FAIL";
    if (!isOk) allPassed = false;
    results.push(row);
  }

  return {
    success: allPassed,
    expectedCount: EXPECTED_LOCALES.length,
    enKeyCount: enKeys.length,
    results
  };
}

function printReport(validation) {
  if (validation.error) {
    console.error(`ERROR: ${validation.error}`);
    return;
  }

  console.log(`Canonical en.json key count: ${validation.enKeyCount}\n`);
  console.log("| Locale | Key Count | Missing | Extra | Type Errors | Placeholder Errors | Status |");
  console.log("|---|---|---|---|---|---|---|");

  for (const r of validation.results) {
    console.log(`| ${r.locale.padEnd(6)} | ${String(r.keyCount).padEnd(9)} | ${String(r.missing).padEnd(7)} | ${String(r.extra).padEnd(5)} | ${String(r.typeErrors).padEnd(11)} | ${String(r.placeholderErrors).padEnd(18)} | ${r.status} |`);
    if (r.details && r.details.length > 0 && r.status === "FAIL") {
      for (const d of r.details) {
        console.log(`    -> ${d}`);
      }
    }
  }

  console.log(`\nTotal locales checked: ${validation.results.length} / ${validation.expectedCount}`);
  if (validation.success) {
    console.log("ALL 39 LOCALES PASS");
  } else {
    console.error("VALIDATION FAILED");
  }
}

if (require.main === module) {
  const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "..", "i18n");
  const result = validateLocales(targetDir);
  printReport(result);
  if (!result.success) {
    process.exit(1);
  }
}

module.exports = {
  EXPECTED_LOCALES,
  PLACEHOLDER_REGEX,
  extractPlaceholders,
  flatten,
  validateLocales,
  printReport
};
