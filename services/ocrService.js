/**
 * ocrService.js
 * MVP OCR service for Veldex — image → text → parsed result → form pre-fill
 */

import { searchUexItems } from "./uexApi.js";
import { logger } from "../scripts/utils.js";

// ── State ──────────────────────────────────────────────────────────────────
export let currentOcrImageFile = null;
export let lastOcrResult = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function wordOverlapScore(a, b) {
  const wa = a.toLowerCase().split(/\s+/);
  const wb = b.toLowerCase().split(/\s+/);
  const set = new Set(wb);
  const hits = wa.filter(w => set.has(w)).length;
  return hits / Math.max(wa.length, wb.length, 1);
}

/** "IRON" → "Iron" */
function toTitleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/** Search station cache for best match in text. */
function _detectLocation(text) {
  const upper = text.toUpperCase();
  const stationsRaw = _getStationsCache();
  let bestStation = null;
  let bestScore = 0.3;

  for (const station of stationsRaw) {
    if (upper.includes(station.toUpperCase())) return station;
    const score = wordOverlapScore(text, station);
    if (score > bestScore) { bestScore = score; bestStation = station; }
  }
  return bestStation;
}

// ── Station cache accessor (monkey-patched from inventory.js) ──────────────
let _stationsGetter = () => [];
export function setStationsGetter(fn) { _stationsGetter = fn; }
function _getStationsCache() { return _stationsGetter(); }

// ── Core image functions ───────────────────────────────────────────────────

/** Store image, show preview, fire callback. */
export function handleOcrImage(file, onReady) {
  if (!file || !file.type.startsWith("image/")) return;
  currentOcrImageFile = file;

  const preview      = document.getElementById("ocr-preview");
  const previewWrapper = document.getElementById("ocr-preview-wrapper");

  if (preview && previewWrapper) {
    preview.src = URL.createObjectURL(file);
    previewWrapper.classList.remove("hidden");
  }

  if (typeof onReady === "function") onReady(file);
}

/** Run Tesseract OCR on a File (requires window.Tesseract). */
export async function runOcrOnImage(file, onProgress) {
  if (!window.Tesseract) throw new Error("Tesseract.js non chargé.");

  const result = await window.Tesseract.recognize(file, "eng", {
    logger: m => {
      if (typeof onProgress === "function" && m.status === "recognizing text") {
        onProgress(Math.round((m.progress || 0) * 100));
      }
    }
  });

  return result.data.text;
}

// ── Refinery parsing ────────────────────────────────────────────────────────

/**
 * Detect Star Citizen refinery screen lines.
 *
 * Pattern: ALL_CAPS_NAME  QUALITY(2-4 digits)  QUANTITY_IN_cSCU(1-4 digits)
 * Example: "IRON 865 14"  →  { name:"Iron", quality:865, quantity_cscu:14, quantity_scu:0.14 }
 *
 * IMPORTANT — Unit convention:
 *   The number shown on refinery screens is in cSCU (centièmes de SCU).
 *   quantity_scu = quantity_cscu / 100
 *   So "14" on screen = 0.14 SCU stored in inventory.
 *
 * Excluded keywords (YIELD, TOTAL, …) are NOT treated as material names.
 *
 * @param {string} text — raw OCR text
 * @returns {Array<{
 *   name: string,
 *   quality: number,
 *   quantity_cscu: number,
 *   quantity_scu: number,
 *   unit_type: "SCU",
 *   uexMatch: object|null
 * }>}
 */
export function parseRefineryMaterials(text) {
  const EXCLUDED = new Set([
    "YIELD", "TOTAL", "COST", "TIME", "SCU", "CSCU", "UNIT", "UNITS",
    "REFINERY", "OUTPUT", "INPUT", "RESULT", "MATERIAL", "MATERIALS",
    "THE", "AND", "FOR", "NOT", "ORE", "RAW"
  ]);

  // Pattern: ALL_CAPS_WORD(≥3)  QUALITY(2–4 digits)  QUANTITY_cSCU(1–4 digits)
  const RE = /\b([A-Z]{3,})\s+(\d{2,4})\s+(\d{1,4})\b/g;

  const materials = [];
  let match;

  while ((match = RE.exec(text)) !== null) {
    const rawName      = match[1];
    const quality      = parseInt(match[2], 10);
    const quantity_cscu = parseInt(match[3], 10);

    if (EXCLUDED.has(rawName)) continue;
    if (quality < 0 || quality > 1000) continue;
    if (quantity_cscu <= 0) continue;

    const name         = toTitleCase(rawName);
    const quantity_scu = Math.round(quantity_cscu) / 100;

    // Match against UEX — prefer commodities/resources
    const uexResults = searchUexItems(name);
    const uexMatch   = uexResults.find(r =>
      r.isCommodity || (r.category || "").toLowerCase() === "commodity"
    ) || uexResults[0] || null;

    materials.push({
      name,
      quality,
      quantity_cscu,
      quantity_scu,
      unit_type: "SCU",
      uexMatch
    });
  }

  return materials;
}

// ── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse OCR raw text into structured fields.
 *
 * Returns an object with `mode`:
 *  - "refinery" → minerals_refinery structure (≥2 material lines matched)
 *  - "single"   → standard single-item structure
 */
export function parseOcrText(text) {

  // ── 1. Try refinery mode ──────────────────────────────────────────────────
  const materials = parseRefineryMaterials(text);

  if (materials.length >= 2) {
    const location_name = _detectLocation(text);

    // Extract YIELD line: "YIELD 53 cSCU" or "YIELD 53 SCU"
    let total_yield_cscu = null;
    const yieldMatch = text.match(/YIELD\s+(\d+)/i);
    if (yieldMatch) {
      total_yield_cscu = parseInt(yieldMatch[1], 10);
    } else {
      // Fallback: sum of all material quantities (in cSCU)
      total_yield_cscu = materials.reduce((sum, m) => sum + m.quantity_cscu, 0);
    }
    const total_yield_scu = Math.round(total_yield_cscu) / 100;

    /**
     * TODO Veldex 0.2+ : persist OCR mineral batch and materials in Supabase.
     * Structure ready — create an `ocr_mineral_batches` table or extend
     * `inventory_entries` with a batch_id grouping column.
     */
    const parsed = {
      // ── Metadata ──────────────────────────────────────────
      type: "minerals_refinery",
      source: "ocr_refinery",
      mode: "refinery",            // kept for UI branching
      // ── Quantities ────────────────────────────────────────
      total_yield_cscu,
      total_yield_scu,
      unit_type: "SCU",
      // ── Materials ─────────────────────────────────────────
      materials,
      // ── Context ───────────────────────────────────────────
      location_name,
      raw_text: text,
      created_at: new Date().toISOString()
    };

    lastOcrResult = parsed;
    return parsed;
  }

  // ── 2. Single-item fallback ───────────────────────────────────────────────
  const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const upper = text.toUpperCase();

  let unit_type = null;
  if (/\bSCU\b/.test(upper))   unit_type = "scu";
  else if (/\bUNITS?\b/.test(upper)) unit_type = "unit";

  let quantity = null;
  for (const pat of [
    /(?:qty|quantity)[:\s]+(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*SCU/i,
    /(\d+(?:[.,]\d+)?)\s*units?/i,
    /(?:qty|quantit[éey])\D{0,4}(\d+(?:[.,]\d+)?)/i,
  ]) {
    const m = text.match(pat);
    if (m) { quantity = parseFloat(m[1].replace(",", ".")); break; }
  }

  let quality = null;
  for (const pat of [
    /(?:quality|qualit[éy]|qual)[:\s.]+(\d{1,4})/i,
    /\bQ[:\s]+(\d{1,4})\b/i,
  ]) {
    const m = text.match(pat);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v >= 0 && v <= 1000) { quality = v; break; }
    }
  }

  const location_name = _detectLocation(text);

  const ignoredWords = new Set([
    "the","a","an","of","and","or","at","in","to","for",
    "qty","quantity","quality","scu","unit","units","station",
    "location","loc","trade","cargo","mining"
  ]);

  const candidateLines = lines.filter(line => {
    if (line.length < 3) return false;
    if (line.toLowerCase().split(/\s+/).every(w => ignoredWords.has(w))) return false;
    if (/^\d+(?:[.,]\d+)?$/.test(line)) return false;
    return true;
  });

  let itemMatches = [];
  for (const line of candidateLines) {
    const cleaned = line.replace(/[^a-zA-Z0-9\s-]/g, " ").trim();
    if (cleaned.length < 3) continue;
    const results = searchUexItems(cleaned);
    if (results.length > 0) itemMatches.push(...results.slice(0, 3));
  }

  const seen = new Set();
  const uniqueMatches = itemMatches.filter(item => {
    const key = String(item.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const isResourceHint = unit_type === "scu" || quality !== null ||
    /\b(mineral|ore|resource|cargo)\b/i.test(text);

  uniqueMatches.sort((a, b) => {
    const aR = a.isCommodity || (a.category || "").toLowerCase() === "commodity";
    const bR = b.isCommodity || (b.category || "").toLowerCase() === "commodity";
    if (isResourceHint && aR && !bR) return -1;
    if (isResourceHint && !aR && bR) return 1;
    return 0;
  });

  const topMatches = uniqueMatches.slice(0, 3);
  const itemName   = topMatches.length > 0 ? topMatches[0].name : null;

  const fieldsFound = [itemName, quantity, unit_type, quality, location_name].filter(Boolean).length;
  const confidence  = fieldsFound >= 4 ? "high" : fieldsFound >= 2 ? "medium" : "low";

  const parsed = {
    type: "single_item",
    source: "ocr_single",
    mode: "single",
    itemName, quantity, unit_type, quality, location_name,
    confidence, raw_text: text, topMatches,
    created_at: new Date().toISOString()
  };

  lastOcrResult = parsed;
  return parsed;
}

// ── Apply to form (single mode) ─────────────────────────────────────────────

/**
 * Apply single-mode OCR result to the existing inventory form.
 * For refinery mode, use per-row [Ajouter] buttons instead.
 */
export async function applyOcrResultToForm(result, selectItemById) {
  if (!result) return;

  const { quantity, unit_type, quality, location_name, topMatches } = result;
  const bestItem = topMatches && topMatches.length > 0 ? topMatches[0] : null;

  if (bestItem && typeof selectItemById === "function") {
    await selectItemById(bestItem);
  }

  setTimeout(() => {
    const qtyInput     = document.getElementById("uex-quantity");
    const unitInput    = document.getElementById("uex-unit-type");
    const qualityInput = document.getElementById("uex-quality");
    const locInput     = document.getElementById("uex-location");

    if (qtyInput && quantity !== null)    qtyInput.value    = quantity;
    if (unitInput && unit_type)           unitInput.value   = unit_type.toLowerCase();
    if (qualityInput && quality !== null) qualityInput.value = quality;
    if (locInput && location_name)        locInput.value    = location_name;
  }, 350);
}
