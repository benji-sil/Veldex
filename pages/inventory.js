import { supabase } from "../services/supabase.js";
import { $, formatUnit, showFormError, showFormSuccess, escapeHtml, showToast, logger } from "../scripts/utils.js";
import { store } from "../scripts/store.js";
import { showView } from "../scripts/router.js";
import { showAlert, showConfirm } from "../components/modal.js";
import { fetchUexItemsByCategory, fetchUexItemAttributes, normalizeUexAttributes, buildVeldexItem, fetchAllUexItems, searchUexItems, fetchUexStations, searchUexStations, fetchUexCommodities, buildVeldexCommodity } from "../services/uexApi.js";
import { detectVeldexItemFamily } from "../config/itemTypes.js";
import { handleOcrImage, runOcrOnImage, parseOcrText, applyOcrResultToForm, setStationsGetter } from "../services/ocrService.js";

const triggerReload = () => window.dispatchEvent(new Event("reload-all-data"));

/**
 * Manually upserts an inventory entry by checking for an identical row first.
 * Identical rows match on: item_name, item_category, component_size, component_class, 
 * component_grade, location_name, owner_user_id, corporation_id, quality, unit_type, visibility.
 * 
 * If found: updates quantity and updated_at.
 * If not found: inserts new row.
 */
async function upsertInventoryEntry(payload) {
  const identityFields = [
    "item_name", "item_category", "component_size", "component_class",
    "component_grade", "location_name", "owner_user_id", "corporation_id",
    "quality", "unit_type", "visibility"
  ];

  // 1. Build query to check for existing row
  let query = supabase.from("inventory_entries").select("id, quantity");

  for (const field of identityFields) {
    const val = payload[field];
    if (val === null || val === undefined) {
      query = query.is(field, null);
    } else {
      query = query.eq(field, val);
    }
  }

  const { data: existingRows, error: fetchError } = await query.maybeSingle();

  if (fetchError) {
    logger.error("Inventory", "Fetch error:", fetchError);
    return { error: fetchError };
  }

  if (existingRows) {
    // 2. Existing row found -> UPDATE
    const newQty = (parseFloat(existingRows.quantity) || 0) + (parseFloat(payload.quantity) || 0);
    
    return await supabase
      .from("inventory_entries")
      .update({
        quantity: Number.isInteger(newQty) ? newQty : parseFloat(newQty.toFixed(3)),
        updated_at: new Date().toISOString()
      })
      .eq("id", existingRows.id)
      .select();
  } else {
    // 3. No existing row -> INSERT
    return await supabase
      .from("inventory_entries")
      .insert([payload])
      .select();
  }
}

let currentSelectedUexItem = null;
let editingEntryId = null;

// ── User/Corporation context ─────────────────────────────────────────────────
/**
 * Returns { userId, corporationId } from the global store populated at login.
 * corporationId falls back to userId when the user has no corporation yet.
 * TODO Veldex: replace fallback corporationId = user.id with real current
 *              corporation id from corporation_members/currentCorporation
 *              once RLS is enabled.
 */
async function getCurrentUserContext() {
  // 1. Get User
  let user = store.currentUser;
  if (!user) {
    const { data: { user: authUser }, error } = await supabase.auth.getUser();
    if (error || !authUser) {
      logger.error("Inventory", "No authenticated user found.");
      return null;
    }
    user = authUser;
  }

  const userId = user.id;
  let corporationId = store.currentCorporationId;

  // 2. Fetch real UUID from corporation_members ONLY if store is missing it
  if (!corporationId) {
    const { data: membership } = await supabase
      .from("corporation_members")
      .select("corporation_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (membership && membership.corporation_id) {
      corporationId = membership.corporation_id;
      store.currentCorporationId = corporationId;
    }
  }

  if (!corporationId) {
    logger.error("Inventory", "Missing currentCorporationId", { currentUser: user, currentCorporationId: corporationId });
    showToast("No corporation selected or loaded. Cannot add inventory.", "error");
    return null;
  }


  return { userId, corporationId };
}

export const UNIT_MINERALS = [
  "jacluium", "carinite", "aphorite", "glacosite", "dolivine",
  "beradom", "feynmaline", "hadanite", "janalite", "saldynium"
];

export const SCU_MINERALS = [
  "agricium", "aluminium", "aslarite", "beryl", "bexalite",
  "borase", "copper", "corundum", "gold", "hephaestanite",
  "ice", "iron", "laranite", "lindinium", "quartz",
  "quantainium", "riccite", "sadaryx", "savrilum", "silicon",
  "stileron", "taranite", "tin", "titanium", "torite", "tungsten"
];

export function getUnitTypeForMineral(mineralName) {
  if (!mineralName) return "";
  const key = mineralName.trim().toLowerCase();
  if (UNIT_MINERALS.includes(key)) return "unit";
  if (SCU_MINERALS.includes(key)) return "scu";
  return "scu";
}










function isResourceOrMineral(item) {
  if (!item) return false;

  const cat = (item.item_category || item.category || "").toLowerCase();

  const exclusions = [
    "arms", "personal weapons", "weapons", "coolers", "shields",
    "power plants", "quantum drives", "mining modules", "mining lasers",
    "salvage", "paints", "liveries", "hats", "jackets", "torso", "helmets", "backpacks"
  ];
  if (exclusions.includes(cat)) return false;

  if (item.isCommodity === true) return true;
  if (cat === "commodity") return true;
  if ((item.type || "").toLowerCase() === "resource" && item.isCommodity === true) return true;

  return false;
}

function highlightMatch(text, query) {
  if (!text) return '';
  if (!query) return escapeHtml(text);
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return escapeHtml(text);
  const before = text.substring(0, idx);
  const match = text.substring(idx, idx + query.length);
  const after = text.substring(idx + query.length);
  return `${escapeHtml(before)}<span class="text-cyan-400 font-bold">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

function renderItemHeader(veldexItem, catOverride) {
  const catStr = catOverride || [veldexItem.item_category, veldexItem.item_section].filter(Boolean).join(' / ');
  const catHtml = catStr
    ? `<p class="text-[13px] text-accent font-display font-bold uppercase tracking-widest mt-1">${escapeHtml(catStr)}</p>`
    : '';
  const manuHtml = veldexItem.manufacturer
    ? `<p class="text-[13px] text-muted font-sans mt-1 opacity-80">${escapeHtml(veldexItem.manufacturer)}</p>`
    : '';
  return `
    <div class="mb-6 pb-5 border-b border-line">
      <h2 class="text-[22px] font-display font-bold text-white leading-tight uppercase tracking-wide">${escapeHtml(veldexItem.item_name)}</h2>
      ${catHtml}
      ${manuHtml}
    </div>
  `;
}

function renderVisibilityToggle(selected = 'corp') {
  const corpActive = selected === 'corp';
  const corpCls = corpActive
    ? 'flex-1 text-[10px] font-display font-bold uppercase tracking-wider transition-all bg-accent/10 text-accent border-r border-line'
    : 'flex-1 text-[10px] font-display font-bold uppercase tracking-wider transition-all text-muted hover:text-white border-r border-line';
  const privCls = !corpActive
    ? 'flex-1 text-[10px] font-display font-bold uppercase tracking-wider transition-all bg-purple-500/10 text-purple-300'
    : 'flex-1 text-[10px] font-display font-bold uppercase tracking-wider transition-all text-muted hover:text-white';
  return `
    <div class="space-y-3">
      <label class="text-[13px] font-display font-semibold text-muted uppercase tracking-widest block">Visibilité</label>
      <div class="flex rounded-sm overflow-hidden border border-line h-11" id="vis-toggle">
        <button type="button" data-vis="corp"  class="${corpCls}"  id="vis-btn-corp">🏢 Corpo</button>
        <button type="button" data-vis="private" class="${privCls}" id="vis-btn-private">🔒 Privé</button>
      </div>
      <input type="hidden" id="uex-visibility" value="${selected}" />
    </div>
  `;
}

function renderLocationAndApply(visibilityValue = 'corp') {
  const isEditing = editingEntryId !== null;
  const btnLabel = isEditing ? 'SAUVEGARDER LES CHANGEMENTS' : 'APPLIQUER AU SYSTÈME';
  const btnClass = isEditing
    ? 'veldex-btn-primary w-full h-11' // Veldex system uses accent for primary, which is suitable
    : 'veldex-btn-primary w-full h-11';

  const cancelBtn = isEditing ? `
    <button id="uex-cancel-edit-btn" type="button"
      class="veldex-btn-ghost w-full h-9 text-[10px] mt-2">
      ANNULER L'ÉDITION
    </button>` : '';

  return `
    ${renderVisibilityToggle(visibilityValue)}
    <div class="relative space-y-3 mt-4">
      <label for="uex-location" class="text-[13px] font-display font-semibold text-muted uppercase tracking-widest block">Station / Localisation</label>
      <input id="uex-location" type="text" placeholder="Rechercher une station..." autocomplete="off" class="veldex-input w-full h-12" />
      <div id="location-autocomplete-list" class="absolute z-50 left-0 right-0 top-full mt-1 bg-panel border border-line rounded-sm shadow-2xl hidden veldex-scroll max-h-64 overflow-y-auto"></div>
    </div>
    <div class="pt-6 border-t border-line mt-6">
      ${isEditing ? `<p class="text-[12px] text-accent font-display font-bold uppercase tracking-widest mb-4 animate-pulse">✏️ Mode édition actif</p>` : ''}
      <button id="uex-apply-btn" type="button" class="${btnClass}">
        ${btnLabel}
      </button>
      ${cancelBtn}
    </div>
  `;
}

function renderResourceForm(container, veldexItem, detected) {
  const unitDefault = getUnitTypeForMineral(veldexItem.item_name) || "scu";

  container.innerHTML = `
    ${renderItemHeader(veldexItem, 'Ressource / Minerai')}
    <div class="mb-5 flex gap-2">
      <span class="veldex-badge-category">MINERAI</span>
      <span class="veldex-badge-status">RAW MATERIAL</span>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <div class="space-y-3">
        <label for="uex-quantity" class="text-[13px] font-display font-semibold text-muted uppercase tracking-widest block">Quantité</label>
        <input id="uex-quantity" type="number" min="0" step="0.01" inputmode="decimal" value="1" class="veldex-input w-full h-12" />
      </div>
      <div class="space-y-3">
        <label for="uex-unit-type" class="text-[13px] font-display font-semibold text-muted uppercase tracking-widest block">Unité</label>
        <select id="uex-unit-type" class="veldex-select w-full h-12">
          <option value="scu" ${unitDefault === 'scu' ? 'selected' : ''}>SCU</option>
          <option value="unit" ${unitDefault === 'unit' ? 'selected' : ''}>UNIT</option>
        </select>
      </div>
      <div class="space-y-3 sm:col-span-2">
        <label for="uex-quality" class="text-[13px] font-display font-semibold text-muted uppercase tracking-widest block">Qualité / Pureté</label>
        <input id="uex-quality" type="number" min="0" max="1000" placeholder="Ex : 100" class="veldex-input w-full h-12" />
      </div>
      <div class="sm:col-span-2 space-y-4">
        ${renderLocationAndApply()}
      </div>
    </div>
  `;
}

function renderPlayerGearForm(container, veldexItem, detected) {
  const extra = veldexItem.extra_attributes || {};
  const usefulKeys = ["Damage", "Fire Rate", "Ammo", "Capacity", "Range"];
  const badges = [];
  usefulKeys.forEach(k => {
    if (extra[k]) badges.push(`${k}: ${escapeHtml(extra[k])}`);
  });

  let catStr = [veldexItem.item_category, veldexItem.item_section].filter(Boolean).join(" / ");

  const catLower = (veldexItem.item_category || "").toLowerCase();
  const secLower = (veldexItem.item_section || "").toLowerCase();
  const nameLower = (veldexItem.item_name || "").toLowerCase();

  const isAttachmentCat = catLower.includes("attachment") || secLower.includes("attachment");
  const isPersonalWeaponCat = secLower.includes("personal weapons") || catLower.includes("personal weapons") || catLower.includes("arms");

  if (isAttachmentCat || isPersonalWeaponCat) {
    let subtype = null;
    if (nameLower.match(/\b(scope|sight|optic|reflex|holo|telescopic)\b/)) {
      subtype = "Optic";
    } else if (nameLower.match(/\b(suppressor|silencer)\b/)) {
      subtype = "Suppressor";
    } else if (nameLower.match(/\b(magazine|mag|drum)\b/)) {
      subtype = "Magazine";
    } else if (nameLower.match(/\b(underbarrel|laser|flashlight)\b/)) {
      subtype = "Underbarrel";
    } else if (nameLower.match(/\b(barrel|compensator|hider)\b/)) {
      subtype = "Barrel";
    } else if (nameLower.match(/\b(grip)\b/)) {
      subtype = "Grip";
    }

    if (subtype) {
      catStr = `Attachment FPS / ${subtype}`;
    } else if (isAttachmentCat) {
      catStr = "Attachment FPS";
    }
  }

  let badgesHtml = '';
  if (badges.length > 0) {
    badgesHtml = `<div class="flex flex-wrap gap-2 mb-6">` + badges.map(b => `<span class="bg-panel border border-line px-3 py-1.5 rounded-sm text-[12px] text-accent font-bold font-display uppercase tracking-wider">${b}</span>`).join('') + `</div>`;
  }

  container.innerHTML = `
    ${renderItemHeader(veldexItem, catStr)}
    ${badgesHtml}
    <div class="space-y-5">
      <div class="space-y-3">
        <label for="uex-quantity" class="text-[13px] font-display font-semibold text-muted uppercase tracking-widest block">Quantité</label>
        <input id="uex-quantity" type="number" min="1" step="1" inputmode="numeric" value="1" class="veldex-input w-full h-12" />
      </div>
      ${renderLocationAndApply()}
    </div>
  `;
}

function renderShipComponentsForm(container, veldexItem, detected) {
  const badges = [];
  if (veldexItem.component_size) badges.push(`Size ${escapeHtml(veldexItem.component_size)}`);
  if (veldexItem.component_class) badges.push(escapeHtml(veldexItem.component_class));
  if (veldexItem.component_grade) badges.push(`Grade ${escapeHtml(veldexItem.component_grade)}`);

  const extra = veldexItem.extra_attributes || {};
  const usefulKeys = ["Power", "Cooling"];
  usefulKeys.forEach(k => {
    if (extra[k]) badges.push(`${k}: ${escapeHtml(extra[k])}`);
  });

  const catStr = [veldexItem.item_category, veldexItem.item_section].filter(Boolean).join(" / ");

  let badgesHtml = '';
  if (badges.length > 0) {
    badgesHtml = `<div class="flex flex-wrap gap-2 mb-6">` + badges.map(b => `<span class="bg-accent/10 border border-accent/30 px-3 py-1.5 rounded-sm text-[12px] text-accent font-bold font-display uppercase tracking-wider">${b}</span>`).join('') + `</div>`;
  }

  container.innerHTML = `
    ${renderItemHeader(veldexItem, catStr)}
    ${badgesHtml}
    <div class="space-y-5">
      <div class="space-y-3">
        <label for="uex-quantity" class="text-[13px] font-display font-semibold text-muted uppercase tracking-widest block">Quantité</label>
        <input id="uex-quantity" type="number" min="1" step="1" inputmode="numeric" value="1" class="veldex-input w-full h-12" />
      </div>
      ${renderLocationAndApply()}
    </div>
  `;
}

function renderIndustrialForm(container, veldexItem, detected) {
  const badges = [];
  if (veldexItem.component_size) badges.push(`Size ${escapeHtml(veldexItem.component_size)}`);

  const extra = veldexItem.extra_attributes || {};
  const usefulKeys = ["Power", "Efficiency", "Mass", "Volume"];
  usefulKeys.forEach(k => {
    if (extra[k]) badges.push(`${k}: ${escapeHtml(extra[k])}`);
  });

  const catStr = [veldexItem.item_category, veldexItem.item_section].filter(Boolean).join(" / ");

  let badgesHtml = '';
  if (badges.length > 0) {
    badgesHtml = `<div class="flex flex-wrap gap-2 mb-6">` + badges.map(b => `<span class="bg-panel border border-line px-3 py-1.5 rounded-sm text-[12px] text-accent font-bold font-display uppercase tracking-wider">${b}</span>`).join('') + `</div>`;
  }

  container.innerHTML = `
    ${renderItemHeader(veldexItem, catStr)}
    ${badgesHtml}
    <div class="space-y-5">
      <div class="space-y-3">
        <label for="uex-quantity" class="text-[13px] font-display font-semibold text-muted uppercase tracking-widest block">Quantité</label>
        <input id="uex-quantity" type="number" min="1" step="1" inputmode="numeric" value="1" class="veldex-input w-full h-12" />
      </div>
      ${renderLocationAndApply()}
    </div>
  `;
}

function renderVehicleWeaponForm(container, veldexItem, detected) {
  const extra = veldexItem.extra_attributes || {};

  // Primary identity badges (always first)
  const primaryBadges = [];
  if (veldexItem.component_size) primaryBadges.push(`Size ${escapeHtml(String(veldexItem.component_size))}`);
  if (veldexItem.component_grade) primaryBadges.push(`Grade ${escapeHtml(veldexItem.component_grade)}`);
  if (veldexItem.component_class) primaryBadges.push(escapeHtml(veldexItem.component_class));

  // Skip keys already shown as primary badges
  const primaryKeys = new Set(["Size", "Grade", "Class"]);

  // Dynamic stat badges — iterate ALL available attributes
  const statBadges = [];
  Object.entries(extra).forEach(([k, v]) => {
    if (primaryKeys.has(k)) return;
    const val = String(v ?? '').trim();
    if (!val || val === '?' || val === 'null' || val === '-') return;
    statBadges.push(`${escapeHtml(k)}: ${escapeHtml(val)}`);
  });

  const subtype = detected?.subtype || 'Vehicle Weapon';
  // Build hierarchy label: "Vehicle Weapon / Gun"
  const catLabel = detected?.label ? `${detected.label} / ${subtype}` : subtype;

  const makeBadge = (text, accent = false) =>
    `<span class="${accent
      ? 'bg-accent/10 border border-accent/30 text-accent'
      : 'bg-panel border border-line text-muted'
    } px-3 py-1.5 rounded-sm text-[12px] font-bold font-display uppercase tracking-wider">${text}</span>`;

  const primaryBadgesHtml = primaryBadges.length > 0
    ? `<div class="flex flex-wrap gap-2 mb-2">${primaryBadges.map(b => makeBadge(b, true)).join('')}</div>`
    : '';

  const statBadgesHtml = statBadges.length > 0
    ? `<div class="flex flex-wrap gap-2 mb-5">${statBadges.map(b => makeBadge(b, false)).join('')}</div>`
    : '';

  const noDataHtml = (primaryBadges.length === 0 && statBadges.length === 0)
    ? `<p class="text-[12px] text-muted italic font-sans mb-6 uppercase tracking-widest opacity-50">Aucune donnée technique disponible.</p>`
    : '';

  container.innerHTML = `
    ${renderItemHeader(veldexItem, catLabel)}
    ${primaryBadgesHtml}
    ${statBadgesHtml}
    ${noDataHtml}
    <div class="space-y-5">
      <div class="space-y-3">
        <label for="uex-quantity" class="text-[13px] font-display font-semibold text-muted uppercase tracking-widest block">Quantité</label>
        <input id="uex-quantity" type="number" min="1" step="1" inputmode="numeric" value="1" class="veldex-input w-full h-12" />
      </div>
      ${renderLocationAndApply()}
    </div>
  `;
}

function renderDynamicForm(veldexItem, rawItem, detected) {
  const container = $("dynamic-form-container");
  if (!container) return;

  // Fade + slide animation
  container.style.opacity = "0";
  container.style.transform = "translateY(5px)";
  container.style.transition = "opacity 150ms ease, transform 150ms ease";

  setTimeout(() => {
    const family = detected ? detected.family : (isResourceOrMineral(rawItem) ? "resource" : "other");

    switch (family) {
      case "resource":
        renderResourceForm(container, veldexItem, detected);
        break;
      case "player_gear":
        renderPlayerGearForm(container, veldexItem, detected);
        break;
      case "ship_components":
        renderShipComponentsForm(container, veldexItem, detected);
        break;
      case "ship_weapon":
        renderVehicleWeaponForm(container, veldexItem, detected);
        break;
      case "industrial_equipment":
        renderIndustrialForm(container, veldexItem, detected);
        break;
      default:
        renderPlayerGearForm(container, veldexItem, detected);
        break;
    }

    // Trigger animation after render
    requestAnimationFrame(() => {
      container.style.opacity = "1";
      container.style.transform = "translateY(0)";
    });
  }, 80);
}

export function bindUexTest() {
  const searchItemInput = $("search-uex-item");
  const itemsList = $("uex-items-list");
  const uexLoading = $("uex-loading");
  const detailsPanel = $("uex-item-details");

  if (!searchItemInput) return;

  // Initialisation non-bloquante
  (async () => {
    try {
      if (uexLoading) uexLoading.classList.remove("hidden");
      await fetchAllUexItems();
      const stations = await fetchUexStations();
      await fetchUexCommodities();
      if (uexLoading) uexLoading.classList.add("hidden");
      // Wire station cache getter for OCR service
      setStationsGetter(() => stations);
    } catch (e) {
      logger.error("Inventory", "UEX init error:", e);
      if (uexLoading) {
        uexLoading.textContent = "Erreur de chargement";
        uexLoading.classList.remove("text-accent");
        uexLoading.classList.add("text-red-500");
      }
    }
  })();

  // Item Search
  let itemSearchTimeout;
  searchItemInput.addEventListener("input", (e) => {
    clearTimeout(itemSearchTimeout);
    const val = e.target.value;

    if (val.length < 2) {
      itemsList.innerHTML = "";
      return;
    }

    itemSearchTimeout = setTimeout(() => {
      const results = searchUexItems(val).slice(0, 15);


      if (results.length === 0) {
        if (currentSelectedUexItem) {
          itemsList.innerHTML = "";
          return;
        }
        const queryLower = val.toLowerCase();
        if (UNIT_MINERALS.includes(queryLower) || SCU_MINERALS.includes(queryLower)) {
          itemsList.innerHTML = `<li class="text-sm text-muted p-2">Aucun minerai exact trouve pour "${escapeHtml(val)}".</li>`;
        } else {
          itemsList.innerHTML = `<li class="text-sm text-muted p-2">Aucun resultat.</li>`;
        }
        return;
      }

      itemsList.innerHTML = results.map(item => {
        let displayCat = item.category || '';
        if (item.isCommodity || displayCat === "Commodity") {
          displayCat = "Ressource / Minerai";
        } else if (displayCat.toLowerCase().includes("attachment")) {
          displayCat = "Attachment FPS";
        }

        const manufacturer = item.company_name || item.manufacturer || '';
        const secondLine = [displayCat, manufacturer].filter(Boolean).join(' • ');

        const isSelected = currentSelectedUexItem && String(currentSelectedUexItem.rawItem?.id) === String(item.id);

        return `
        <li class="cursor-pointer group px-4 py-4 rounded-sm transition-all duration-200 border-l-2 ${isSelected
            ? 'bg-accent/5 border-l-accent'
            : 'border-l-transparent hover:bg-bg/40 hover:border-l-line'
          }" data-id="${item.id}">
          <div class="flex flex-col gap-1.5">
            <span class="text-[17px] font-display font-bold text-white/95 uppercase tracking-wide group-hover:text-accent transition-colors">${highlightMatch(item.name, val)}</span>
            ${secondLine ? `<span class="text-[13px] text-muted font-sans font-medium uppercase tracking-widest flex items-center gap-2 opacity-70">
              <span class="w-1.5 h-1.5 bg-line rounded-full"></span>
              ${escapeHtml(secondLine)}
            </span>` : ''}
          </div>
        </li>
        `;
      }).join("");

      // Add click listeners to items
      itemsList.querySelectorAll("li").forEach(li => {
        li.addEventListener("click", async (e) => {
          const itemId = e.currentTarget.dataset.id;
          const item = results.find(i => String(i.id) === String(itemId));

          if (!item) return;


          // Afficher "Chargement..."
          detailsPanel.classList.remove("hidden");
          $("uex-empty-state")?.classList.add("hidden");
          const container = $("dynamic-form-container");
          if (container) container.innerHTML = `<p class="text-sm text-muted">Chargement des attributs...</p>`;
          currentSelectedUexItem = null;

          // Highlight selected row, keep list visible
          itemsList.querySelectorAll("li").forEach(el => {
            el.classList.remove("bg-panel2", "border-l-2", "border-l-accent");
          });
          e.currentTarget.classList.add("bg-panel2", "border-l-2", "border-l-accent");

          const isFakeResource = item.isCommodity === true;

          let attributes = [];
          let normalizedAttributes = {};
          if (!isFakeResource) {
            attributes = await fetchUexItemAttributes(item.id);
            normalizedAttributes = normalizeUexAttributes(attributes);
          }


          let veldexItem;
          if (isFakeResource) {
            veldexItem = buildVeldexCommodity(item);
          } else {
            veldexItem = buildVeldexItem(item, attributes);
          }


          const detected = detectVeldexItemFamily(item, attributes);

          currentSelectedUexItem = {
            veldexItem,
            rawItem: item,
            rawAttributes: attributes,
            normalizedAttributes,
            detectedFamily: detected
          };

          renderDynamicForm(veldexItem, item, detected);
        });
      });
    }, 300);
  });

  // Location Autocomplete with Event Delegation
  let locSearchTimeout;
  document.addEventListener("input", (e) => {
    if (e.target.id === "uex-location") {
      const locInput = e.target;
      const locAutocompleteList = $("location-autocomplete-list");
      if (!locAutocompleteList) return;

      clearTimeout(locSearchTimeout);
      const val = locInput.value;

      if (val.length < 2) {
        locAutocompleteList.classList.add("hidden");
        locAutocompleteList.innerHTML = "";
        return;
      }

      locSearchTimeout = setTimeout(() => {
        const results = searchUexStations(val);
        if (results.length === 0) {
          locAutocompleteList.classList.add("hidden");
          locAutocompleteList.innerHTML = "";
          return;
        }

        locAutocompleteList.classList.remove("hidden");
        locAutocompleteList.innerHTML = results.map(station => {
          const lowerName = station.toLowerCase();
          const lowerQuery = val.toLowerCase();
          const startIndex = lowerName.indexOf(lowerQuery);

          let displayName = escapeHtml(station);
          if (startIndex !== -1) {
            const originalText = station;
            const before = originalText.substring(0, startIndex);
            const match = originalText.substring(startIndex, startIndex + val.length);
            const after = originalText.substring(startIndex + val.length);
            displayName = `${escapeHtml(before)}<span class="text-accent font-bold">${escapeHtml(match)}</span>${escapeHtml(after)}`;
          }

          return `
          <div class="cursor-pointer px-3 py-2 text-sm text-white/90 hover:bg-panel2 transition-colors border-b border-line last:border-0 autocomplete-item" data-value="${escapeHtml(station)}">
            ${displayName}
          </div>
          `;
        }).join("");

        locAutocompleteList.querySelectorAll(".autocomplete-item").forEach(div => {
          div.addEventListener("click", () => {
            locInput.value = div.dataset.value;
            locAutocompleteList.classList.add("hidden");
          });
        });
      }, 150);
    }
  });

  // Hide autocomplete when clicking outside
  document.addEventListener("click", (e) => {
    const locInput = $("uex-location");
    const locAutocompleteList = $("location-autocomplete-list");
    if (locInput && locAutocompleteList && !locInput.contains(e.target) && !locAutocompleteList.contains(e.target)) {
      locAutocompleteList.classList.add("hidden");
    }
  });

  // ── Visibility toggle delegation (form is injected dynamically) ──────────
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#vis-toggle [data-vis]");
    if (!btn) return;
    const val = btn.dataset.vis;
    const hiddenInput = $("uex-visibility");
    if (hiddenInput) hiddenInput.value = val;

    // Re-render toggle to reflect new state
    const toggle = $("vis-toggle");
    if (toggle) {
      toggle.querySelectorAll("[data-vis]").forEach(b => {
        const isCorp = b.dataset.vis === 'corp';
        const isPrivate = b.dataset.vis === 'private';
        const isActive = b.dataset.vis === val;
        const border = isCorp ? 'border-r border-line ' : '';
        if (isActive && val === 'corp') {
          b.className = `flex-1 py-2 text-xs font-sans font-semibold uppercase tracking-wider transition-colors bg-accent/10 text-accent ${border}`;
        } else if (isActive && val === 'private') {
          b.className = `flex-1 py-2 text-xs font-sans font-semibold uppercase tracking-wider transition-colors bg-purple-500/10 text-purple-300 ${border}`;
        } else {
          b.className = `flex-1 py-2 text-xs font-sans font-semibold uppercase tracking-wider transition-colors text-muted hover:text-white ${border}`;
        }
      });
    }
  });

  document.addEventListener("click", async (e) => {
    if (e.target.id === "uex-cancel-edit-btn") {
      resetEditMode();
      return;
    }

    if (e.target.id === "uex-apply-btn") {
      if (!currentSelectedUexItem) {
        showToast("Veuillez sélectionner un item.", "error");
        return;
      }

      const qtyInput = $("uex-quantity");
      const locInput = $("uex-location");
      const detailsPanel = $("uex-item-details");

      const qty = parseFloat(qtyInput?.value || "0");
      const loc = locInput?.value.trim() || "";

      if (isNaN(qty) || qty <= 0) {
        showToast("Quantité invalide.", "error");
        return;
      }
      if (!loc) {
        showToast("Location invalide.", "error");
        return;
      }

      const isResource = currentSelectedUexItem.detectedFamily ? currentSelectedUexItem.detectedFamily.family === "resource" : (isResourceOrMineral(currentSelectedUexItem.rawItem) || currentSelectedUexItem.rawItem.isCommodity);
      const unit = $("uex-unit-type")?.value || "scu";
      const quality = parseInt($("uex-quality")?.value || "0", 10);
      const visibility = $("uex-visibility")?.value || "corp";

      // ---- MODE ÉDITION : UPDATE ----
      if (editingEntryId !== null) {
        const updates = {
          quantity: qty,
          location_name: loc,
          visibility,
          updated_at: new Date().toISOString()
        };
        if (isResource) {
          updates.unit_type = unit;
          if (!isNaN(quality)) updates.quality = quality;
        }

        const { error } = await supabase
          .from("inventory_entries")
          .update(updates)
          .eq("id", editingEntryId);

        if (error) {
          logger.error("Inventory", "Modification error:", error);
          showToast("Erreur lors de la modification.", "error");
        } else {
          showToast("Entrée modifiée avec succès !");
          resetEditMode();
          await loadInventoryEntries();
          triggerReload();
        }
        return;
      }

      // ---- MODE AJOUT : INSERT ----
      const context = await getCurrentUserContext();
      if (!context || !context.corporationId) {
        return; // Context helper shows toast and logs missing id
      }

      let payload;
      if (isResource) {
        payload = {
          item_api_id: currentSelectedUexItem.veldexItem.item_api_id,
          item_uuid: null,
          item_name: currentSelectedUexItem.veldexItem.item_name,
          item_category: currentSelectedUexItem.veldexItem.item_category,
          item_section: currentSelectedUexItem.veldexItem.item_section,
          manufacturer: currentSelectedUexItem.veldexItem.manufacturer,
          quantity: qty,
          unit_type: unit,
          quality: quality,
          location_name: loc,
          visibility,
          component_size: null,
          component_class: null,
          component_grade: null,
          owner_user_id: context.userId,
          corporation_id: context.corporationId,
          api_source: currentSelectedUexItem.rawItem.isCommodity ? "UEX_COMMODITIES" : "UEX",
          api_snapshot: currentSelectedUexItem.veldexItem.api_snapshot || {
            item: currentSelectedUexItem.rawItem,
            attributes: currentSelectedUexItem.rawAttributes,
            normalized_attributes: currentSelectedUexItem.normalizedAttributes || {}
          }
        };
      } else {
        payload = {
          item_api_id: currentSelectedUexItem.veldexItem.item_api_id,
          item_uuid: currentSelectedUexItem.veldexItem.item_uuid,
          item_name: currentSelectedUexItem.veldexItem.item_name,
          item_category: currentSelectedUexItem.veldexItem.item_category,
          item_section: currentSelectedUexItem.veldexItem.item_section,
          manufacturer: currentSelectedUexItem.veldexItem.manufacturer,
          component_size: currentSelectedUexItem.veldexItem.component_size,
          component_class: currentSelectedUexItem.veldexItem.component_class,
          component_grade: currentSelectedUexItem.veldexItem.component_grade,
          quantity: qty,
          location_name: loc,
          visibility,
          owner_user_id: context.userId,
          corporation_id: context.corporationId,
          api_source: "UEX",
          api_snapshot: {
            item: currentSelectedUexItem.rawItem,
            attributes: currentSelectedUexItem.rawAttributes,
            normalized_attributes: currentSelectedUexItem.normalizedAttributes || {}
          }
        };
      }


      const { data, error } = await upsertInventoryEntry(payload);

      if (error) {
        logger.error("Inventory", "Insertion error:", error);
        showToast("Erreur lors de l'insertion.", "error");
      } else {
        showToast("Item ajouté avec succès !");

        // Reset
        if (detailsPanel) detailsPanel.classList.add("hidden");
        $("uex-empty-state")?.classList.remove("hidden");
        currentSelectedUexItem = null;

        // Auto-refresh list
        await loadInventoryEntries();
        triggerReload();
      }
    }
  });

  $("refresh-uex-storage")?.addEventListener("click", loadInventoryEntries);
}

function aggregateInventory(entries) {
  if (!entries || !entries.length) return [];
  
  const mergedMap = new Map();
  
  entries.forEach(entry => {
    // Build stable merge key
    const name = (entry.item_name || "").trim().toLowerCase();
    const cat = entry.item_category || "";
    const size = entry.component_size || "";
    const cls = entry.component_class || "";
    const grade = entry.component_grade || "";
    const loc = (entry.location_name || "").trim().toLowerCase();
    const vis = entry.visibility || "corp";
    const owner = entry.owner_user_id || "";
    const unit = entry.unit_type || "";
    const quality = entry.quality ?? 'none';
    
    // Key structure: name|cat|size|class|grade|loc|vis|owner|quality|unit
    const key = [name, cat, size, cls, grade, loc, vis, owner, quality, unit].join('|');
    
    if (mergedMap.has(key)) {
      const existing = mergedMap.get(key);
      // Sum quantity safely
      const qty1 = parseFloat(existing.quantity) || 0;
      const qty2 = parseFloat(entry.quantity) || 0;
      // Handle floating point precision
      const sum = qty1 + qty2;
      existing.quantity = Number.isInteger(sum) ? sum : parseFloat(sum.toFixed(3));
    } else {
      // Clone entry to avoid mutating cache/raw data
      mergedMap.set(key, { ...entry });
    }
  });
  
  const result = Array.from(mergedMap.values());
  return result;
}

let inventoryEntriesCache = [];

export async function loadInventoryEntries() {
  const tbody = $("uex-storage-body");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="9" class="py-4 text-muted text-center text-sm">Chargement...</td></tr>`;

  const context = await getCurrentUserContext();
  
  if (!context || !context.userId) {
    logger.error("Inventory", "Failed to get user context.");
    tbody.innerHTML = `<tr><td colspan="9" class="py-4 text-red-500 text-center text-sm">Session utilisateur non trouvée. Veuillez vous reconnecter.</td></tr>`;
    return;
  }


  const { data, error } = await supabase
    .from("inventory_entries")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Inventory", "Supabase query error:", error);
    tbody.innerHTML = `<tr><td colspan="9" class="py-4 text-red-500 text-center text-sm">Erreur système lors du chargement des données.</td></tr>`;
    return;
  }


  // Filter for Personal Inventory: ONLY items belonging to the current user
  const visibleEntries = (data || []).filter(entry => {
    return entry.owner_user_id === context.userId;
  });


  // Aggregation at display level
  const aggregated = aggregateInventory(visibleEntries);
  inventoryEntriesCache = aggregated;

  populateInventoryFilters();
  renderInventoryEntries();
}

function populateInventoryFilters() {
  const locSelect = $("filter-uex-location");
  const catSelect = $("filter-uex-category");
  const sizeSelect = $("filter-uex-size");
  const classSelect = $("filter-uex-class");
  const gradeSelect = $("filter-uex-grade");

  if (!locSelect) return;

  const locations = new Set();
  const categories = new Set();
  const sizes = new Set();
  const classes = new Set();
  const grades = new Set();

  inventoryEntriesCache.forEach(entry => {
    if (entry.location_name) locations.add(entry.location_name);
    if (entry.item_category) categories.add(entry.item_category);
    if (entry.component_size) sizes.add(entry.component_size);
    if (entry.component_class) classes.add(entry.component_class);
    if (entry.component_grade) grades.add(entry.component_grade);
  });

  const populateSelect = (selectEl, setValues) => {
    if (!selectEl) {
      logger.warn("Inventory", "Filter select element not found.");
      return;
    }
    const firstOpt = selectEl.options[0];
    selectEl.innerHTML = "";
    if (firstOpt) selectEl.appendChild(firstOpt);
    
    Array.from(setValues).sort().forEach(val => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      selectEl.appendChild(opt);
    });
  };

  const populateSelectWithLabels = (selectEl, setValues) => {
    if (!selectEl) {
      logger.warn("Inventory", "Filter select element not found.");
      return;
    }
    const firstOpt = selectEl.options[0];
    selectEl.innerHTML = "";
    if (firstOpt) selectEl.appendChild(firstOpt);

    Array.from(setValues).sort().forEach(val => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val === "Commodity" ? "Ressource / Minerai" : val;
      selectEl.appendChild(opt);
    });
  };

  populateSelect(locSelect, locations);
  populateSelectWithLabels(catSelect, categories);
  populateSelect(sizeSelect, sizes);
  populateSelect(classSelect, classes);
  populateSelect(gradeSelect, grades);
}

function renderInventoryEntries() {
  const tbody = $("uex-storage-body");
  if (!tbody) return;

  const nameFilter = ($("filter-uex-name")?.value || "").toLowerCase();
  const locFilter = $("filter-uex-location")?.value || "";
  const catFilter = $("filter-uex-category")?.value || "";
  const sizeFilter = $("filter-uex-size")?.value || "";
  const classFilter = $("filter-uex-class")?.value || "";
  const gradeFilter = $("filter-uex-grade")?.value || "";
  const visFilter = $("filter-uex-visibility")?.value || "";

  let filtered = inventoryEntriesCache.filter(entry => {
    if (nameFilter && !(entry.item_name || "").toLowerCase().includes(nameFilter)) return false;
    if (locFilter && entry.location_name !== locFilter) return false;
    if (catFilter && entry.item_category !== catFilter) return false;
    if (sizeFilter && entry.component_size !== sizeFilter) return false;
    if (classFilter && entry.component_class !== classFilter) return false;
    if (gradeFilter && entry.component_grade !== gradeFilter) return false;
    if (visFilter && (entry.visibility || 'corp') !== visFilter) return false;
    return true;
  });


  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="py-4 text-muted text-sm text-center">Aucun résultat.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(entry => {
    if (entry.item_category === 'Commodity') {
      return `
      <tr data-entry-id="${entry.id}">
        <td>
          <div class="font-sans font-bold text-white uppercase tracking-wide text-[15px]">${escapeHtml(entry.item_name)}</div>
          <div class="text-[12px] text-muted font-sans uppercase tracking-widest mt-1">${escapeHtml(entry.manufacturer || "Unknown Manufacturer")}</div>
        </td>
        <td><span class="veldex-badge-category text-[11px]">RESSOURCE</span></td>
        <td class="tabular-nums opacity-80 text-[14px]">${escapeHtml(entry.unit_type ? entry.unit_type.toUpperCase() : "SCU")} / ${entry.quality != null ? entry.quality : '—'} / —</td>
        <td class="font-sans font-bold text-accent tabular-nums text-[18px]">${entry.quantity}</td>
        <td class="text-muted/60 text-[14px] uppercase tracking-wider font-sans">${escapeHtml(entry.location_name || "DEEP SPACE")}</td>
        <td>${renderVisibilityBadge(entry.visibility)}</td>
        <td class="text-right">${renderActionButtons(entry.id)}</td>
      </tr>
      `;
    } else {
      let catDisplay = entry.item_category || "";
      const catLower = catDisplay.toLowerCase();
      const secLower = (entry.item_section || "").toLowerCase();
      const nameLower = (entry.item_name || "").toLowerCase();
      const isAttachmentCat = catLower.includes("attachment") || secLower.includes("attachment");
      const isPersonalWeaponCat = secLower.includes("personal weapons") || catLower.includes("personal weapons") || catLower.includes("arms");

      if (isAttachmentCat || isPersonalWeaponCat) {
        let subtype = null;
        if (nameLower.match(/\b(scope|sight|optic|reflex|holo|telescopic)\b/)) {
          subtype = "Optic";
        } else if (nameLower.match(/\b(suppressor|silencer)\b/)) {
          subtype = "Suppressor";
        } else if (nameLower.match(/\b(magazine|mag|drum)\b/)) {
          subtype = "Magazine";
        } else if (nameLower.match(/\b(underbarrel|laser|flashlight)\b/)) {
          subtype = "Underbarrel";
        } else if (nameLower.match(/\b(barrel|compensator|hider)\b/)) {
          subtype = "Barrel";
        } else if (nameLower.match(/\b(grip)\b/)) {
          subtype = "Grip";
        }
        if (subtype) {
          catDisplay = `Attachment FPS / ${subtype}`;
        } else if (isAttachmentCat) {
          catDisplay = "Attachment FPS";
        }
      }

      // Guns / Vehicle Weapons
      const isGunCat = catLower.includes("gun") || catLower.includes("vehicle weapon") || catLower.includes("ship weapon");
      const isFpsCat = catLower.includes("personal weapon") || catLower.includes("arms");
      if (isGunCat && !isFpsCat) {
        catDisplay = catLower.includes("vehicle weapon") ? "Vehicle Weapon"
          : catLower.includes("ship weapon") ? "Ship Weapon"
            : "Gun";
      }

      const s = entry.component_size || "—";
      const c = entry.component_class || "—";
      const g = entry.component_grade || "—";

      return `
      <tr data-entry-id="${entry.id}">
        <td>
          <div class="font-sans font-bold text-white uppercase tracking-wide text-[15px]">${escapeHtml(entry.item_name)}</div>
          <div class="text-[12px] text-muted font-sans uppercase tracking-widest mt-1">${escapeHtml(entry.manufacturer || "Unknown Manufacturer")}</div>
        </td>
        <td><span class="veldex-badge-category text-[11px]">${escapeHtml(catDisplay.toUpperCase())}</span></td>
        <td class="tabular-nums opacity-80 text-[14px]">${s} / ${c} / ${g}</td>
        <td class="font-sans font-bold text-accent tabular-nums text-[18px]">${entry.quantity}</td>
        <td class="text-muted/60 text-[14px] uppercase tracking-wider font-sans">${escapeHtml(entry.location_name || "DEEP SPACE")}</td>
        <td>${renderVisibilityBadge(entry.visibility)}</td>
        <td class="text-right">${renderActionButtons(entry.id)}</td>
      </tr>
      `;
    }
  }).join("");

  // Event delegation for actions
  tbody.addEventListener("click", handleInventoryAction, { once: true });
}

function renderVisibilityBadge(visibility) {
  const v = visibility || 'corp';
  if (v === 'private') {
    return `<span class="veldex-badge-private">🔒 PRIVÉ</span>`;
  }
  return `<span class="veldex-badge-corpo">🏢 CORPO</span>`;
}

function renderActionButtons(entryId) {
  return `
    <div class="flex items-center justify-end gap-2">
      <button class="inv-edit-btn veldex-btn-ghost h-8 px-3 text-[11px]" data-id="${entryId}">MODIFIER</button>
      <button class="inv-del-btn veldex-btn-danger h-8 px-3 text-[11px]" data-id="${entryId}">SUPPRIMER</button>
    </div>
  `;
}

function handleInventoryAction(e) {
  const delBtn = e.target.closest(".inv-del-btn");
  const editBtn = e.target.closest(".inv-edit-btn");
  const saveBtn = e.target.closest(".inv-save-btn");
  const cancelBtn = e.target.closest(".inv-cancel-btn");

  if (delBtn) {
    const id = delBtn.dataset.id;
    deleteInventoryEntry(id);
  } else if (editBtn) {
    const id = editBtn.dataset.id;
    startEditFromInventory(id);
    // Re-attach listener
    const tbody = $("uex-storage-body");
    if (tbody) tbody.addEventListener("click", handleInventoryAction, { once: true });
  } else {
    // Click landed outside buttons — re-attach
    const tbody = $("uex-storage-body");
    if (tbody) tbody.addEventListener("click", handleInventoryAction, { once: true });
  }
}

async function deleteInventoryEntry(id) {
  const entry = inventoryEntriesCache.find(e => String(e.id) === String(id));
  if (!entry) {
    showToast("Entrée non accessible ou inexistante.", "error");
    return;
  }

  const confirmed = await showConfirm("Supprimer cette entrée de l'inventaire ?");
  if (!confirmed) {
    // Re-attach listener since once was consumed
    const tbody = $("uex-storage-body");
    if (tbody) tbody.addEventListener("click", handleInventoryAction, { once: true });
    return;
  }

  const { error } = await supabase
    .from("inventory_entries")
    .delete()
    .eq("id", id);

  if (error) {
    logger.error("Inventory", "Deletion error:", error);
    showToast("Erreur lors de la suppression.", "error");
  } else {
    showToast("Entrée supprimée.");
    await loadInventoryEntries();
    triggerReload();
  }
}

async function startEditFromInventory(id) {
  const entry = inventoryEntriesCache.find(e => String(e.id) === String(id));
  if (!entry) {
    showToast("Entrée non accessible ou introuvable.", "error");
    return;
  }

  editingEntryId = id;

  // Scroll to the add section
  const searchSection = $("search-uex-item");
  if (searchSection) searchSection.scrollIntoView({ behavior: "smooth", block: "center" });

  // Show the details panel
  const detailsPanel = $("uex-item-details");
  if (detailsPanel) detailsPanel.classList.remove("hidden");
  $("uex-empty-state")?.classList.add("hidden");

  // Build a minimal veldexItem from the cached entry
  const fakeVeldexItem = {
    item_api_id: entry.item_api_id,
    item_uuid: entry.item_uuid,
    item_name: entry.item_name,
    item_category: entry.item_category,
    item_section: entry.item_section,
    manufacturer: entry.manufacturer,
    component_size: entry.component_size,
    component_class: entry.component_class,
    component_grade: entry.component_grade,
    extra_attributes: (entry.api_snapshot?.normalized_attributes) || {},
    isResource: entry.item_category === "Commodity"
  };

  const fakeRawItem = {
    id: entry.item_api_id,
    name: entry.item_name,
    category: entry.item_category,
    section: entry.item_section,
    isCommodity: entry.item_category === "Commodity"
  };

  // Store as current selected so apply handler works
  currentSelectedUexItem = {
    veldexItem: fakeVeldexItem,
    rawItem: fakeRawItem,
    rawAttributes: entry.api_snapshot?.attributes || [],
    normalizedAttributes: entry.api_snapshot?.normalized_attributes || {},
    detectedFamily: { family: entry.item_category === "Commodity" ? "resource" : "other" }
  };

  // Detect real family
  const detected = detectVeldexItemFamily(fakeRawItem, []);
  currentSelectedUexItem.detectedFamily = detected;

  // Render the form
  renderDynamicForm(fakeVeldexItem, fakeRawItem, detected);

  // Pre-fill fields after a short delay (form injected async)
  setTimeout(() => {
    const qtyInput = $("uex-quantity");
    const locInput = $("uex-location");
    const unitInput = $("uex-unit-type");
    const qualityInput = $("uex-quality");
    const visInput = $("uex-visibility");

    if (qtyInput) qtyInput.value = entry.quantity ?? 1;
    if (locInput) locInput.value = entry.location_name || "";
    if (unitInput && entry.unit_type) unitInput.value = entry.unit_type.toLowerCase();
    if (qualityInput && entry.quality != null) qualityInput.value = entry.quality;

    // Restore visibility toggle
    const entryVis = entry.visibility || 'corp';
    if (visInput) visInput.value = entryVis;
    const toggle = $("vis-toggle");
    if (toggle) {
      toggle.querySelectorAll("[data-vis]").forEach(b => {
        const isCorp = b.dataset.vis === 'corp';
        const border = isCorp ? 'border-r border-line ' : '';
        const isActive = b.dataset.vis === entryVis;
        if (isActive && entryVis === 'corp') {
          b.className = `flex-1 py-2 text-xs font-sans font-semibold uppercase tracking-wider transition-colors bg-accent/10 text-accent ${border}`;
        } else if (isActive && entryVis === 'private') {
          b.className = `flex-1 py-2 text-xs font-sans font-semibold uppercase tracking-wider transition-colors bg-purple-500/10 text-purple-300 ${border}`;
        } else {
          b.className = `flex-1 py-2 text-xs font-sans font-semibold uppercase tracking-wider transition-colors text-muted hover:text-white ${border}`;
        }
      });
    }
  }, 250);
}

function resetEditMode() {
  editingEntryId = null;
  currentSelectedUexItem = null;
  const detailsPanel = $("uex-item-details");
  if (detailsPanel) detailsPanel.classList.add("hidden");
  $("uex-empty-state")?.classList.remove("hidden");
}

export function bindInventoryEntriesFilters() {
  $("filter-uex-name")?.addEventListener("input", renderInventoryEntries);
  $("filter-uex-location")?.addEventListener("change", renderInventoryEntries);
  $("filter-uex-category")?.addEventListener("change", renderInventoryEntries);
  $("filter-uex-size")?.addEventListener("change", renderInventoryEntries);
  $("filter-uex-class")?.addEventListener("change", renderInventoryEntries);
  $("filter-uex-grade")?.addEventListener("change", renderInventoryEntries);
  $("filter-uex-visibility")?.addEventListener("change", renderInventoryEntries);
  
  // Initialize the new inventory search refactored logic
  bindInventorySearch();
}

// ── OCR Integration ─────────────────────────────────────────────────────────

/**
 * Programmatically select an item (same flow as user clicking a list result).
 * Used by the OCR "Appliquer" button.
 */
async function selectItemProgrammatically(item) {
  if (!item) return;

  const detailsPanel = $("uex-item-details");
  const containerEl = $("dynamic-form-container");
  if (detailsPanel) detailsPanel.classList.remove("hidden");
  $("uex-empty-state")?.classList.add("hidden");
  if (containerEl) containerEl.innerHTML = `<p class="text-sm text-muted">Chargement des attributs...</p>`;
  currentSelectedUexItem = null;

  const isFakeResource = item.isCommodity === true;
  let attributes = [];
  let normalizedAttributes = {};

  if (!isFakeResource) {
    attributes = await fetchUexItemAttributes(item.id);
    normalizedAttributes = normalizeUexAttributes(attributes);
  }

  let veldexItem;
  if (isFakeResource) {
    veldexItem = buildVeldexCommodity(item);
  } else {
    veldexItem = buildVeldexItem(item, attributes);
  }

  const detected = detectVeldexItemFamily(item, attributes);

  currentSelectedUexItem = {
    veldexItem,
    rawItem: item,
    rawAttributes: attributes,
    normalizedAttributes,
    detectedFamily: detected
  };

  renderDynamicForm(veldexItem, item, detected);

  // Also update the search input to reflect the selection
  const searchInput = $("search-uex-item");
  if (searchInput) searchInput.value = item.name || "";
}

/**
 * Self-contained refinery table renderer.
 *
 * Owns a mutable `localMaterials` array — edits and deletes mutate it in place
 * and trigger a full re-render of the display container.
 * No Supabase writes happen here.
 *
 * @param {HTMLElement} display          - the #ocr-parsed-display container
 * @param {Array}       localMaterials   - mutable copy of parsed materials
 * @param {string|null} locationName     - detected station name
 * @param {Function}    onAddMaterial    - called with (mat) on individual [Ajouter]
 * @param {Function}    onBatchAdd       - called with (localMaterials, batchBtn) on "Ajouter tous"
 */
function renderRefineryTable(display, localMaterials, locationName, onAddMaterial, onBatchAdd) {
  const totalScu = localMaterials.reduce((s, m) => s + (m.quantity_scu ?? 0), 0);
  const totalCscu = localMaterials.reduce((s, m) => s + (m.quantity_cscu ?? 0), 0);
  const validCount = localMaterials.filter(m => !!m.uexMatch).length;

  const locRow = locationName
    ? `<div class="flex items-center justify-between mb-4 pb-4 border-b border-line">
         <span class="text-[10px] text-muted font-display font-bold uppercase tracking-widest">Location détectée</span>
         <span class="text-xs text-white font-display font-bold uppercase tracking-wider">${escapeHtml(locationName)}</span>
       </div>`
    : '';

  const rows = localMaterials.map((mat, i) => {
    const matched = mat.uexMatch
      ? escapeHtml(mat.uexMatch.name)
      : `<span class="italic text-muted opacity-50">${escapeHtml(mat.name)} (Not Found)</span>`;
    const canAdd = !!mat.uexMatch;
    return `
      <div class="ocr-mat-row flex items-center gap-4 py-4 border-b border-line last:border-0" data-row-index="${i}">
        <div class="flex-1 min-w-0">
          <div class="text-[19px] font-display font-bold text-white uppercase tracking-wide truncate group-hover:text-accent transition-colors leading-tight">${matched}</div>
        </div>
        <div class="flex items-center gap-5 shrink-0">
          <div class="text-right">
            <div class="text-[18px] text-accent font-mono font-bold tabular-nums leading-none">${mat.quantity_scu.toFixed(2)} SCU</div>
            <div class="text-[11px] text-muted font-sans uppercase tracking-widest mt-1 opacity-60 font-bold">${mat.quantity_cscu} cSCU</div>
          </div>
          <div class="text-[14px] text-amber-400 font-display font-bold border border-amber-400/20 bg-amber-400/5 px-2.5 py-1 rounded-sm tabular-nums shrink-0">Q ${mat.quality}</div>
          <div class="flex gap-1.5">
            <button class="ocr-edit-btn veldex-btn-secondary h-9 px-3 text-[11px]" data-row-index="${i}">EDIT</button>
            <button class="ocr-del-btn veldex-btn-danger h-9 px-3 text-[11px]" data-row-index="${i}">DEL</button>
            <button class="ocr-add-mat-btn veldex-btn-primary h-9 px-4 text-[11px] ${canAdd ? '' : 'opacity-30 cursor-not-allowed'}" data-row-index="${i}" ${canAdd ? '' : 'disabled'}>ADD</button>
          </div>
        </div>
      </div>`;
  }).join('');

  const totalRow = localMaterials.length > 0 ? `
    <div class="flex items-center justify-between pt-4 mt-2 border-t border-line border-dashed">
      <span class="text-[10px] text-muted font-display font-bold uppercase tracking-widest">Calculated Yield</span>
      <div class="text-right">
        <div class="text-lg font-display font-bold text-accent tabular-nums">${totalScu.toFixed(2)} SCU</div>
        <div class="text-[10px] text-muted font-sans tabular-nums">${totalCscu} cSCU</div>
      </div>
    </div>` : '';

  const batchBtnClass = validCount > 0 ? 'veldex-btn-primary' : 'veldex-btn-secondary opacity-30 cursor-not-allowed';

  display.innerHTML = `
    ${locRow}
    <div class="mb-3 flex items-center justify-between">
      <p class="text-[10px] text-muted font-display font-bold uppercase tracking-widest">Detected Minerals — ${localMaterials.length} Units</p>
    </div>
    <div class="space-y-1">
      ${rows || '<p class="text-xs text-muted italic py-8 text-center uppercase tracking-widest opacity-30">Scanner is empty</p>'}
    </div>
    ${totalRow}
    <div class="pt-6">
      <button id="ocr-batch-add-btn" type="button" ${validCount === 0 ? 'disabled' : ''}
        class="w-full h-12 ${batchBtnClass} text-sm flex items-center justify-center gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        SYNC ALL DETECTED DATA (${validCount})
      </button>
    </div>
  `;

  // ── Wire: individual [Ajouter] ────────────────────────────────────────────
  display.querySelectorAll(".ocr-add-mat-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const idx = parseInt(btn.dataset.rowIndex, 10);
      const mat = localMaterials[idx];
      if (!mat || !mat.uexMatch) return;
      if (typeof onAddMaterial === "function") await onAddMaterial(mat);
    });
  });

  // ── Wire: [Supprimer] ─────────────────────────────────────────────────────
  display.querySelectorAll(".ocr-del-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.rowIndex, 10);
      localMaterials.splice(idx, 1);
      renderRefineryTable(display, localMaterials, locationName, onAddMaterial, onBatchAdd);
    });
  });

  // ── Wire: [Modifier] ──────────────────────────────────────────────────────
  display.querySelectorAll(".ocr-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.rowIndex, 10);
      const mat = localMaterials[idx];
      const row = display.querySelector(`.ocr-mat-row[data-row-index="${idx}"]`);
      if (!row) return;

      const currentName = mat.uexMatch?.name ?? mat.name;

      row.innerHTML = `
        <div class="flex flex-col gap-5 w-full py-5 bg-accent/5 rounded-sm p-5 border border-accent/20">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="space-y-2">
              <label class="text-[12px] text-muted font-display font-bold uppercase tracking-widest">Matériau</label>
              <input id="ocr-edit-name-${idx}" type="text" value="${escapeHtml(currentName)}"
                class="veldex-input w-full h-10 text-[13px]" />
            </div>
            <div class="space-y-2">
              <label class="text-[12px] text-muted font-display font-bold uppercase tracking-widest">Qté (SCU)</label>
              <input id="ocr-edit-scu-${idx}" type="number" min="0.01" step="0.01" value="${mat.quantity_scu}"
                class="veldex-input w-full h-10 text-[13px]" />
            </div>
            <div class="space-y-2">
              <label class="text-[12px] text-muted font-display font-bold uppercase tracking-widest">Qualité</label>
              <input id="ocr-edit-quality-${idx}" type="number" min="0" max="1000" value="${mat.quality}"
                class="veldex-input w-full h-10 text-[13px]" />
            </div>
          </div>
          <div class="flex gap-3 justify-end pt-2">
            <button class="ocr-cancel-btn veldex-btn-ghost h-10 px-5 text-[12px]">CANCEL</button>
            <button class="ocr-save-btn veldex-btn-primary h-10 px-6 text-[12px]">SAVE</button>
          </div>
        </div>`;

      row.querySelector(".ocr-save-btn").addEventListener("click", async () => {
        const newName = row.querySelector(`#ocr-edit-name-${idx}`)?.value.trim() || currentName;
        const newScu = parseFloat(row.querySelector(`#ocr-edit-scu-${idx}`)?.value);
        const newQuality = parseInt(row.querySelector(`#ocr-edit-quality-${idx}`)?.value, 10);
        const finalScu = isNaN(newScu) ? mat.quantity_scu : newScu;
        const finalQual = isNaN(newQuality) ? mat.quality : newQuality;
        const finalCscu = Math.round(finalScu * 100);

        let newUexMatch = mat.uexMatch;
        if (newName.toLowerCase() !== currentName.toLowerCase()) {
          const results = searchUexItems(newName);
          newUexMatch = results.find(r =>
            r.isCommodity || (r.category || "").toLowerCase() === "commodity"
          ) || results[0] || null;
        }

        localMaterials[idx] = {
          ...mat,
          name: newName,
          quantity_scu: finalScu,
          quantity_cscu: finalCscu,
          quality: finalQual,
          uexMatch: newUexMatch
        };

        renderRefineryTable(display, localMaterials, locationName, onAddMaterial, onBatchAdd);
      });

      row.querySelector(".ocr-cancel-btn").addEventListener("click", () => {
        renderRefineryTable(display, localMaterials, locationName, onAddMaterial, onBatchAdd);
      });
    });
  });

  const batchBtn = display.querySelector("#ocr-batch-add-btn");
  if (batchBtn && typeof onBatchAdd === "function" && validCount > 0) {
    batchBtn.addEventListener("click", async () => {
      batchBtn.disabled = true;
      batchBtn.textContent = '⏳ PROCESSING SYNC...';
      await onBatchAdd(localMaterials, batchBtn);
    });
  }
}

/**
 * Render OCR parsed result — handles both 'refinery' and 'single' modes.
 * @param {object}   result        - output of parseOcrText
 * @param {Function} onAddMaterial - called with (mat) when individual [Ajouter] is clicked
 * @param {Function} onBatchAdd    - called with (materials, batchBtn) when "Ajouter tous" is clicked
 */
function renderOcrParsedDisplay(result, onAddMaterial, onBatchAdd) {
  const display = $("ocr-parsed-display");
  if (!display) return;

  // ── Refinery mode — delegated to renderRefineryTable ─────────────────────
  if (result.mode === "refinery") {
    if (!result.materials || result.materials.length === 0) {
      display.innerHTML = `<p class="text-xs text-muted italic">Aucun matériau détecté.</p>`;
      return;
    }
    // Mutable local copy — edits/deletes don't mutate the original parsed result
    const localMaterials = result.materials.map(m => ({ ...m }));
    renderRefineryTable(display, localMaterials, result.location_name ?? null, onAddMaterial, onBatchAdd);
    return;
  }

  // ── Single mode ────────────────────────────────────────────────────────
  const row = (label, value, accent = false) => {
    if (!value && value !== 0) return `<div class="flex items-center justify-between py-1"><span class="text-[13px] text-muted font-sans uppercase tracking-widest">${label}</span><span class="text-[14px] text-gray-600 font-sans italic">—</span></div>`;
    return `<div class="flex items-center justify-between py-1.5">
      <span class="text-[13px] text-muted font-sans uppercase tracking-widest">${label}</span>
      <span class="text-[15px] ${accent ? 'text-accent font-bold' : 'text-white/90'} font-sans">${escapeHtml(String(value))}</span>
    </div>`;
  };

  const confidenceColor = result.confidence === 'high' ? 'text-emerald-400' : result.confidence === 'medium' ? 'text-amber-400' : 'text-red-400';

  display.innerHTML = `
    ${row('Item détecté', result.itemName, true)}
    ${row('Quantité', result.quantity)}
    ${row('Unité', result.unit_type ? result.unit_type.toUpperCase() : null)}
    ${row('Qualité', result.quality)}
    ${row('Location', result.location_name)}
    <div class="pt-2 mt-2 border-t border-line flex items-center justify-between">
      <span class="text-[11px] text-muted font-sans uppercase tracking-widest">Confiance système</span>
      <span class="text-[14px] font-bold font-sans ${confidenceColor} uppercase">${result.confidence}</span>
    </div>
  `;
}

/**
 * Bind all OCR UI interactions.
 * Call this from app.js alongside bindUexTest().
 */
export function bindOcr() {
  const dropZone = $("ocr-drop-zone");
  const importBtn = $("ocr-import-btn");
  const fileInput = $("ocr-file-input");
  const analyzeBtn = $("ocr-analyze-btn");
  const progressWrapper = $("ocr-progress-wrapper");
  const progressBar = $("ocr-progress-bar");
  const progressPct = $("ocr-progress-pct");
  const rawWrapper = $("ocr-raw-wrapper");
  const rawText = $("ocr-raw-text");
  const rawToggle = $("ocr-raw-toggle");
  const rawBody = $("ocr-raw-body");
  const parsedWrapper = $("ocr-parsed-wrapper");
  const resultEmpty = $("ocr-result-empty");
  const matchesWrapper = $("ocr-matches-wrapper");
  const matchesList = $("ocr-matches-list");
  const applyFormBtn = $("ocr-apply-form-btn");
  const ocrLocInput = $("ocr-location-input");
  const ocrLocList = $("ocr-location-list");

  if (!dropZone) return;

  let _currentOcrResult = null;
  let _ocrVisibility = 'corp';  // default

  /** Returns the trimmed OCR global location, or null if empty. */
  function getOcrLocation() {
    return ocrLocInput?.value.trim() || null;
  }

  /** Returns the current OCR visibility selection. */
  function getOcrVisibility() {
    return _ocrVisibility;
  }

  // ── OCR Visibility toggle wiring ──────────────────────────────────────────
  const ocrVisCorp = $("ocr-vis-corp");
  const ocrVisPrivate = $("ocr-vis-private");

  function applyOcrVisToggle(val) {
    _ocrVisibility = val;
    if (ocrVisCorp) {
      ocrVisCorp.className = val === 'corp'
        ? 'flex-1 text-[10px] font-display font-bold uppercase tracking-wider transition-all bg-accent/10 text-accent border-r border-line'
        : 'flex-1 text-[10px] font-display font-bold uppercase tracking-wider transition-all text-muted hover:text-white border-r border-line';
    }
    if (ocrVisPrivate) {
      ocrVisPrivate.className = val === 'private'
        ? 'flex-1 text-[10px] font-display font-bold uppercase tracking-wider transition-all bg-purple-500/10 text-purple-300'
        : 'flex-1 text-[10px] font-display font-bold uppercase tracking-wider transition-all text-muted hover:text-white';
    }
  }

  ocrVisCorp?.addEventListener("click", () => applyOcrVisToggle('corp'));
  ocrVisPrivate?.addEventListener("click", () => applyOcrVisToggle('private'));
  applyOcrVisToggle('corp'); // initialize

  // ── Reset OCR UI to initial state ──────────────────────────────────────────
  function resetOcrUI() {
    _currentOcrResult = null;
    parsedWrapper?.classList.add("hidden");
    rawWrapper?.classList.add("hidden");
    matchesWrapper?.classList.add("hidden");
    resultEmpty?.classList.remove("hidden");
    applyFormBtn?.classList.remove("hidden");
    if (rawText) rawText.value = "";
    if (ocrLocInput) ocrLocInput.value = "";
    ocrLocList?.classList.add("hidden");
    const previewWrapper = $("ocr-preview-wrapper");
    if (previewWrapper) previewWrapper.classList.add("hidden");
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = '🔍 Analyser l\'image';
    }
  }

  // ── OCR Location autocomplete ───────────────────────────────────────────
  let _ocrLocTimeout;
  ocrLocInput?.addEventListener("input", () => {
    clearTimeout(_ocrLocTimeout);
    const val = ocrLocInput.value;
    if (val.length < 2) {
      ocrLocList?.classList.add("hidden");
      if (ocrLocList) ocrLocList.innerHTML = "";
      return;
    }
    _ocrLocTimeout = setTimeout(() => {
      const results = searchUexStations(val);
      if (!results || results.length === 0) {
        ocrLocList?.classList.add("hidden");
        if (ocrLocList) ocrLocList.innerHTML = "";
        return;
      }
      ocrLocList.classList.remove("hidden");
      ocrLocList.innerHTML = results.map(station => {
        const lo = station.toLowerCase();
        const lq = val.toLowerCase();
        const si = lo.indexOf(lq);
        let display = escapeHtml(station);
        if (si !== -1) {
          display = escapeHtml(station.slice(0, si))
            + `<span class="text-accent font-bold">${escapeHtml(station.slice(si, si + val.length))}</span>`
            + escapeHtml(station.slice(si + val.length));
        }
        return `<div class="cursor-pointer px-3 py-2 text-sm text-white/90 hover:bg-panel2 transition-colors border-b border-line last:border-0 ocr-loc-item" data-value="${escapeHtml(station)}">${display}</div>`;
      }).join("");

      ocrLocList.querySelectorAll(".ocr-loc-item").forEach(div => {
        div.addEventListener("click", () => {
          ocrLocInput.value = div.dataset.value;
          ocrLocList.classList.add("hidden");
        });
      });
    }, 150);
  });

  // Hide OCR location list on outside click
  document.addEventListener("click", (e) => {
    if (ocrLocInput && ocrLocList &&
      !ocrLocInput.contains(e.target) &&
      !ocrLocList.contains(e.target)) {
      ocrLocList.classList.add("hidden");
    }
  });

  // ── Batch insert all minerals into Supabase ────────────────────────────
  async function batchInsertMinerals(materials, batchBtn) {
    // Validate location
    const locationName = getOcrLocation();
    if (!locationName) {
      showToast("Veuillez sélectionner une localisation avant d'ajouter.", "error");
      if (batchBtn) { batchBtn.disabled = false; }
      return;
    }

    const validMaterials = materials.filter(m => !!m.uexMatch);
    if (validMaterials.length === 0) {
      showToast("Aucun minéral avec correspondance UEX trouvé.", "error");
      if (batchBtn) { batchBtn.disabled = false; batchBtn.textContent = 'Ajouter tous les minérais'; }
      return;
    }

    // Build one payload per material (same structure as existing resource insert)
    const context = await getCurrentUserContext();
    if (!context || !context.corporationId) {
      if (batchBtn) {
        batchBtn.disabled = false;
        batchBtn.textContent = 'Ajouter tous les minérais';
      }
      return;
    }

    const ocrVis = getOcrVisibility();
    const payloads = validMaterials.map(mat => {
      const item = mat.uexMatch;
      const isCom = item.isCommodity === true;
      const apiSource = isCom ? "UEX_COMMODITIES" : "UEX";
      return {
        item_api_id: item.api_id ?? item.id,
        item_uuid: null,
        item_name: item.name,
        item_category: item.category || "Commodity",
        item_section: item.section || "Resource",
        manufacturer: item.company_name || null,
        quantity: mat.quantity_scu,
        unit_type: "scu",
        quality: mat.quality,
        location_name: locationName,
        visibility: ocrVis,
        component_size: null,
        component_class: null,
        component_grade: null,
        owner_user_id: context.userId,
        corporation_id: context.corporationId,
        api_source: apiSource,
        api_snapshot: { item, ocr_source: "refinery", quantity_cscu: mat.quantity_cscu }
      };
    });


    try {
      // Manual upsert with Promise.all
      const results = await Promise.all(
        payloads.map(p => upsertInventoryEntry(p))
      );

      const errors = results.filter(r => r.error);
      const inserted = results.filter(r => !r.error && r.data?.length > 0);

      if (errors.length > 0) {
        logger.error("Inventory", "OCR Batch errors:", errors.map(r => r.error));
        if (inserted.length > 0) {
          showToast(`${inserted.length} minérai(s) ajouté(s), ${errors.length} échec(s).`, "error");
        } else {
          showToast("Erreur lors de l'insertion batch.", "error");
        }
        if (batchBtn) { batchBtn.disabled = false; batchBtn.textContent = '⚠️ Réessayer'; }
        return;
      }

      showToast(`✅ ${inserted.length} minérai(s) ajouté(s) — ${locationName}`);

      await loadInventoryEntries();
      triggerReload();
      resetOcrUI();

    } catch (err) {
      logger.error("Inventory", "OCR Batch exception:", err);
      showToast("Erreur inattendue lors de l'insertion.", "error");
      if (batchBtn) { batchBtn.disabled = false; batchBtn.textContent = '⚠️ Réessayer'; }
    }
  }

  // ── Helper: image loaded ────────────────────────────────────────────────
  function onImageReady() {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = '🔍 Analyser l\'image';
    }
    showToast("Image OCR chargée.");
  }

  // ── Paste (Ctrl+V) ──────────────────────────────────────────────────────
  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        handleOcrImage(file, onImageReady);
        break;
      }
    }
  });

  // ── Drag & Drop ─────────────────────────────────────────────────────────
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith("image/")) {
      handleOcrImage(file, onImageReady);
    }
  });
  dropZone.addEventListener("click", () => fileInput?.click());

  // ── File input upload ───────────────────────────────────────────────────
  importBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) handleOcrImage(file, onImageReady);
  });

  // ── Raw text toggle ─────────────────────────────────────────────────────
  rawToggle?.addEventListener("click", () => {
    if (!rawBody) return;
    const isHidden = rawBody.classList.toggle("hidden");
    rawToggle.textContent = isHidden ? 'Déplier ▼' : 'Replier ▲';
  });

  // ── Analyze ─────────────────────────────────────────────────────────────
  analyzeBtn?.addEventListener("click", async () => {
    const { currentOcrImageFile } = await import("../services/ocrService.js");
    if (!currentOcrImageFile) {
      showToast("Aucune image chargée.", "error");
      return;
    }

    // Show progress
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = '⏳ Analyse...';
    progressWrapper?.classList.remove("hidden");
    if (progressBar) progressBar.style.width = "0%";
    if (progressPct) progressPct.textContent = "0%";
    resultEmpty?.classList.add("hidden");
    rawWrapper?.classList.add("hidden");
    parsedWrapper?.classList.add("hidden");

    try {
      const text = await runOcrOnImage(currentOcrImageFile, (pct) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressPct) progressPct.textContent = `${pct}%`;
      });

      // Show raw text
      if (rawText) rawText.value = text;
      rawWrapper?.classList.remove("hidden");
      progressWrapper?.classList.add("hidden");
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = '🔍 Analyser l\'image';

      // Parse
      const parsed = parseOcrText(text);
      _currentOcrResult = parsed;

      parsedWrapper?.classList.remove("hidden");
      resultEmpty?.classList.add("hidden");

      // ── Refinery mode ──────────────────────────────────────────────────
      if (parsed.mode === "refinery") {
        matchesWrapper?.classList.add("hidden");
        applyFormBtn?.classList.add("hidden");  // individual buttons per row instead

        renderOcrParsedDisplay(
          parsed,
          // onAddMaterial — per-row [Ajouter] individual handler
          async (mat) => {
            // Validate OCR location before pre-filling
            const ocrLoc = getOcrLocation();
            if (!ocrLoc) {
              showToast("Veuillez sélectionner une localisation avant d'ajouter.", "error");
              return;
            }

            // mat.quantity_scu = cSCU / 100 (e.g. 14 cSCU → 0.14 SCU)
            await selectItemProgrammatically(mat.uexMatch);

            setTimeout(() => {
              const qtyInput = $("uex-quantity");
              const unitInput = $("uex-unit-type");
              const qualityInput = $("uex-quality");
              const locInput = $("uex-location");

              if (qtyInput) qtyInput.value = mat.quantity_scu;
              if (unitInput) unitInput.value = "scu";
              if (qualityInput) qualityInput.value = mat.quality;
              if (locInput) locInput.value = ocrLoc;  // ← OCR global location
            }, 350);

            $("search-uex-item")?.scrollIntoView({ behavior: "smooth", block: "center" });
            showToast(`${mat.uexMatch.name} — ${mat.quantity_scu.toFixed(2)} SCU @ ${ocrLoc} — validez avec APPLIQUER.`);
          },
          // onBatchAdd — "Ajouter tous les minerais" button handler
          batchInsertMinerals
        );

        showToast(`Raffinerie : ${parsed.materials.length} minéraux — ${parsed.total_yield_scu.toFixed(2)} SCU total.`);

        // ── Single mode ─────────────────────────────────────────────────────
      } else {
        applyFormBtn?.classList.remove("hidden");
        renderOcrParsedDisplay(parsed);

        const topMatches = parsed.topMatches || [];
        if (topMatches.length > 1) {
          matchesWrapper?.classList.remove("hidden");
          if (matchesList) {
            matchesList.innerHTML = topMatches.map((m, i) => {
              const isCom = m.isCommodity || (m.category || "").toLowerCase() === "commodity";
              const cat = isCom ? 'Ressource / Minerai' : (m.category || m.section || '');
              return `<button class="ocr-match-btn w-full text-left px-3 py-2 rounded-sm bg-bg border border-line text-sm font-sans text-white/80" data-match-index="${i}">
                <span class="font-medium text-white">${escapeHtml(m.name)}</span>
                ${cat ? `<span class="ml-2 text-xs text-muted">${escapeHtml(cat)}</span>` : ''}
              </button>`;
            }).join('');

            matchesList.querySelectorAll(".ocr-match-btn").forEach(btn => {
              btn.addEventListener("click", () => {
                const idx = parseInt(btn.dataset.matchIndex, 10);
                const chosen = topMatches[idx];
                if (chosen && _currentOcrResult) {
                  _currentOcrResult = { ..._currentOcrResult, topMatches: [chosen, ...topMatches.filter((_, i) => i !== idx)] };
                  renderOcrParsedDisplay({ ..._currentOcrResult, itemName: chosen.name });
                }
              });
            });
          }
        } else {
          matchesWrapper?.classList.add("hidden");
        }

        if (!parsed.itemName) {
          showToast("Aucun item reconnu automatiquement — sélectionnez manuellement.", "error");
        } else {
          showToast(`Item détecté : ${parsed.itemName} (confiance: ${parsed.confidence})`);
        }
      }
    } catch (err) {
      logger.error("Inventory", "OCR Analyze error:", err);
      showToast("Erreur lors de l'analyse OCR.", "error");
      progressWrapper?.classList.add("hidden");
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = '🔍 Analyser l\'image';
      resultEmpty?.classList.remove("hidden");
    }
  });

  // ── Apply to form ────────────────────────────────────────────────────────
  applyFormBtn?.addEventListener("click", async () => {
    if (!_currentOcrResult) {
      showToast("Aucun résultat OCR à appliquer.", "error");
      return;
    }
    await applyOcrResultToForm(_currentOcrResult, selectItemProgrammatically);

    // Scroll to the form
    const searchSection = $("search-uex-item");
    if (searchSection) searchSection.scrollIntoView({ behavior: "smooth", block: "center" });

    showToast("Formulaire prérempli — validez avec APPLIQUER.");
  });
}

/**
 * Renders inventory search results from the corporation cache.
 * Behavioral logic: filters by mineral_name, sorts by quantity DESC.
 */
export function renderInventorySearch() {
  const container = $("inventory-search-results");
  const searchInput = $("inventory-search");
  
  // Safety check: do nothing if container is missing
  if (!container) return;

  const query = searchInput?.value.trim().toLowerCase() || "";

  // If query is empty, show default prompt
  if (!query) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-12 text-center opacity-40">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" class="mb-3">
          <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <p class="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-muted">Initialisez le scan par nom de minerai</p>
      </div>
    `;
    return;
  }

  // Safety check: if cache is empty, show fallback
  const cache = store.corporationEntriesCache || [];
  if (cache.length === 0) {
    container.innerHTML = `
      <div class="veldex-panel p-6 text-center border-dashed">
        <p class="text-[11px] font-display font-bold uppercase tracking-widest text-accent/60">Cache système vide</p>
        <p class="text-[10px] text-muted mt-1 uppercase">Aucune donnée corporation synchronisée</p>
      </div>
    `;
    return;
  }

  const filtered = cache
    .filter((entry) => (entry.mineral_name || "").toLowerCase().includes(query))
    .sort((a, b) => (b.quantity || 0) - (a.quantity || 0));

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="veldex-panel p-6 text-center border-dashed">
        <p class="text-[11px] font-display font-bold uppercase tracking-widest text-accent/60">Signal perdu</p>
        <p class="text-[10px] text-muted mt-1 uppercase">Aucun résultat pour "${escapeHtml(query)}"</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((entry) => {
    const username = entry.profiles?.username ?? "Anonyme";
    const quality = entry.quality != null ? `Q${entry.quality}` : "—";
    const qty = entry.quantity || 0;
    const unit = formatUnit(entry.unit_type);

    return `
      <div class="veldex-panel p-4 flex items-center justify-between gap-4 group hover:border-accent/40 transition-all">
        <div class="flex-1 min-w-0">
          <p class="font-display font-bold text-white uppercase tracking-wider group-hover:text-accent transition-colors truncate">${escapeHtml(entry.mineral_name || "Minerai Inconnu")}</p>
          <div class="flex items-center gap-2 mt-1">
            <div class="w-1.5 h-1.5 bg-accent2 rounded-full animate-veldex-pulse shadow-[0_0_5px_#FF8A00]"></div>
            <p class="text-[10px] text-muted font-display font-bold uppercase tracking-widest truncate">Opérateur : ${escapeHtml(username)}</p>
          </div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-xs font-display font-bold text-accent mb-0.5">${quality}</div>
          <div class="text-[16px] font-sans font-bold text-white leading-tight">${qty} <span class="text-[10px] text-muted uppercase font-bold">${unit}</span></div>
        </div>
      </div>
    `;
  }).join("");
}

/**
 * Binds the inventory search input with a debounce (150ms).
 */
let searchDebounceTimeout;
export function bindInventorySearch() {
  const searchInput = $("inventory-search");
  if (!searchInput) return;
  
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      renderInventorySearch();
    }, 150);
  });
}
