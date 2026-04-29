// Caches
let uexItemsCache = [];
let uexStationsCache = [];
let uexCommoditiesCache = [];
import { logger } from "../scripts/utils.js";

export const STANTON_MAJOR_CITIES = ["Area18", "New Babbage", "Lorville", "Orison"];

export async function fetchUexCategories() {
  try {
    const res = await fetch(`https://api.uexcorp.space/2.0/categories`);
    if (!res.ok) throw new Error("Erreur HTTP: " + res.status);
    const json = await res.json();
    return json.data || [];
  } catch (error) {
    logger.error("UEX", "fetchUexCategories error:", error);
    return [];
  }
}

export async function fetchAllUexItems() {
  if (uexItemsCache.length > 0) return uexItemsCache;

  const categories = await fetchUexCategories();
  const itemCategories = categories.filter(c => c.type === 'item');
  const categoriesToFetch = itemCategories.length > 0 ? itemCategories : [{id: 19}];

  let allItems = [];
  const promises = categoriesToFetch.map(c => fetchUexItemsByCategory(c.id));
  const results = await Promise.allSettled(promises);

  results.forEach(res => {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      allItems = allItems.concat(res.value);
    }
  });

  // Remove duplicates by id
  const uniqueItemsMap = new Map();
  allItems.forEach(item => {
    if (!uniqueItemsMap.has(item.id)) {
      uniqueItemsMap.set(item.id, item);
    }
  });

  uexItemsCache = Array.from(uniqueItemsMap.values());
  return uexItemsCache;
}

const ALLOWED_CATEGORIES = [
  "Coolers", "Shields", "Weapons", "Power Plants", "Quantum Drives", 
  "Missiles", "Turrets", "Mining", "Salvage", "Systems",
  "Personal Weapons", "Arms", "Helmets", "Torso", "Legs", "Undersuits", "Backpacks",
  "Weapon Attachments", "Attachments", "Magazine", "Optic", "Suppressor", "Module"
];

function cleanCommodityName(name) {
  return name.replace(/\s*\(Ore\)/gi, "").trim();
}

export async function fetchUexCommodities() {
  if (uexCommoditiesCache.length > 0) return uexCommoditiesCache;
  try {
    const res = await fetch(`https://api.uexcorp.space/2.0/commodities`);
    if (!res.ok) throw new Error("Erreur HTTP: " + res.status);
    const json = await res.json();
    
    const commoditiesMap = new Map();
    if (json.data && Array.isArray(json.data)) {
      json.data.forEach(item => {
        if (item.is_mineral === 1 || item.is_extractable === 1 || item.kind) {
          const rawName = item.name;
          if (!rawName) return;
          
          const cleanName = cleanCommodityName(rawName);
          const hasOre = rawName.toLowerCase().includes("(ore)");
          
          if (!commoditiesMap.has(cleanName) || (!hasOre && commoditiesMap.get(cleanName).hasOre)) {
            commoditiesMap.set(cleanName, {
              id: `commodity_${item.id}`,
              api_id: item.id,
              name: cleanName,
              code: item.code,
              type: "resource",
              isCommodity: true,
              isResource: true,
              category: "Commodity",
              section: item.kind || "Resource",
              price_buy: item.price_buy,
              price_sell: item.price_sell,
              api_snapshot: item,
              hasOre: hasOre
            });
          }
        }
      });
    }
    
    uexCommoditiesCache = Array.from(commoditiesMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    return uexCommoditiesCache;
  } catch (error) {
    logger.error("UEX", "fetchUexCommodities error:", error);
    return [];
  }
}

export function buildVeldexCommodity(commodity) {
  return {
    item_api_id: commodity.api_id,
    item_uuid: null,
    item_name: commodity.name,
    item_category: "Commodity",
    item_section: commodity.section,
    manufacturer: null,
    component_size: null,
    component_class: null,
    component_grade: null,
    isResource: true,
    commodity_code: commodity.code,
    commodity_kind: commodity.section,
    price_buy: commodity.price_buy,
    price_sell: commodity.price_sell,
    api_snapshot: commodity.api_snapshot
  };
}

export function normalizeSearchText(value) {
  if (!value || typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchUexItems(query) {
  if (!query) return [];
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];

  const queryWords = normalizedQuery.split(" ");

  const doSearch = (allowListOnly) => {
    return uexItemsCache.filter(item => {
      if (!item.name) return false;
      
      const cat = (item.category || "").toLowerCase();
      const sec = (item.section || "").toLowerCase();
      const itemCat = (item.item_category || "").toLowerCase();
      
      if (
        cat.includes("livery") || cat.includes("liveries") || cat.includes("paint") ||
        sec.includes("livery") || sec.includes("liveries") || sec.includes("paint") ||
        itemCat.includes("livery") || itemCat.includes("liveries") || itemCat.includes("paint")
      ) {
        return false;
      }
      
      const normName = normalizeSearchText(item.name);
      const normCat = normalizeSearchText(item.category);
      const normSec = normalizeSearchText(item.section);
      const normCompany = normalizeSearchText(item.company_name || item.manufacturer);
      const normSlug = normalizeSearchText(item.slug);

      const searchableText = `${normName} ${normCat} ${normSec} ${normCompany} ${normSlug}`;
      
      const matchesAllWords = queryWords.every(word => searchableText.includes(word));
      if (!matchesAllWords) return false;

      if (allowListOnly) {
        const isAllowed = ALLOWED_CATEGORIES.some(c => cat === c.toLowerCase() || cat.includes(c.toLowerCase()));
        if (!isAllowed) return false;
      }

      return true;
    });
  };

  const commodityResults = uexCommoditiesCache.filter(m => {
    if (!m.name) return false;
    const normName = normalizeSearchText(m.name);
    const normSec = normalizeSearchText(m.section);
    const searchableText = `${normName} ${normSec}`;
    return queryWords.every(word => searchableText.includes(word));
  });

  let itemResults = doSearch(true);

  if (itemResults.length === 0 && commodityResults.length === 0) {
    itemResults = doSearch(false);
  }

  let filtered = [...commodityResults, ...itemResults];

  const getScore = (item) => {
    let score = 0;
    const normName = normalizeSearchText(item.name);
    
    if (normName === normalizedQuery) {
      score = 130;
    } else if (normName.startsWith(normalizedQuery + " ")) {
      score = 120;
    } else if (normName.startsWith(normalizedQuery)) {
      score = 100;
    } else if (queryWords.every(w => normName.split(" ").some(nw => nw.startsWith(w)))) {
      score = 80;
    } else if (queryWords.every(w => normName.includes(w))) {
      score = 60;
    } else {
      score = 40;
    }

    const catLower = (item.category || "").toLowerCase();
    const isAllowed = ALLOWED_CATEGORIES.some(c => catLower === c.toLowerCase() || catLower.includes(c.toLowerCase()));
    if (isAllowed && !item.isCommodity) {
      score += 10;
    }

    let isResource = false;
    const exclusions = [
      "arms", "personal weapons", "weapons", "coolers", "shields", 
      "power plants", "quantum drives", "mining modules", "mining lasers", 
      "salvage", "paints", "liveries", "hats", "jackets", "torso", "helmets", "backpacks"
    ];
    
    if (!exclusions.includes(catLower)) {
      if (item.isCommodity === true) isResource = true;
      else if (catLower === "commodity") isResource = true;
      else if ((item.type || "").toLowerCase() === "resource" && item.isCommodity === true) isResource = true;
    }
    
    if (isResource) {
      score += 20;
    }

    return score;
  };

  filtered.sort((a, b) => {
    const scoreA = getScore(a);
    const scoreB = getScore(b);
    
    if (scoreA !== scoreB) {
      return scoreB - scoreA; // descending
    }
    
    return a.name.localeCompare(b.name);
  });

  return filtered.slice(0, 50);
}

export async function fetchUexItemsByCategory(categoryId) {
  try {
    const res = await fetch(`https://api.uexcorp.space/2.0/items?id_category=${categoryId}`);
    if (!res.ok) throw new Error("Erreur HTTP: " + res.status);
    const json = await res.json();
    return json.data || [];
  } catch (error) {
    logger.error("UEX", "fetchUexItemsByCategory error:", error);
    return [];
  }
}

const attributesCache = new Map();

export async function fetchUexItemAttributes(itemId) {
  if (attributesCache.has(itemId)) {
    return attributesCache.get(itemId);
  }

  try {
    const res = await fetch(`https://api.uexcorp.space/2.0/items_attributes?id_item=${itemId}`);
    if (!res.ok) throw new Error("Erreur HTTP: " + res.status);
    const json = await res.json();
    const data = json.data || [];
    attributesCache.set(itemId, data);
    return data;
  } catch (error) {
    logger.error("UEX", "fetchUexItemAttributes error:", error);
    return [];
  }
}

/**
 * normalizeUexAttributes(attributes)
 * Transforms raw API array into a flat key/value object.
 * - key: attribute_name lowercased, spaces -> _, special chars removed
 * - value: value + unit (if unit is non-empty)
 * - ignores null / undefined / "" / "?" / "-"
 */
export function normalizeUexAttributes(attributes) {
  if (!Array.isArray(attributes)) return {};
  const result = {};
  attributes.forEach(attr => {
    const name = attr.attribute_name;
    const rawVal = attr.value;
    const unit = (attr.unit || '').trim();

    if (!name) return;
    if (rawVal === null || rawVal === undefined) return;
    const strVal = String(rawVal).trim();
    if (!strVal || strVal === '?' || strVal === '-' || strVal === 'null') return;

    const key = name
      .toLowerCase()
      .replace(/[^a-z0-9\s_]/g, '')
      .replace(/\s+/g, '_');

    result[key] = unit ? `${strVal} ${unit}` : strVal;
  });
  return result;
}

export function extractUexAttributes(attributes) {
  const extracted = { size: null, class: null, grade: null, raw_attributes: {} };
  if (!Array.isArray(attributes)) return extracted;
  
  attributes.forEach(attr => {
    const val = attr.value;
    const unit = (attr.unit || '').trim();
    if (!val || val === '?' || val === 'null' || val === '-') return;

    const displayVal = unit ? `${val} ${unit}` : val;

    if (attr.attribute_name === 'Size') extracted.size = val; // size stays raw (no unit)
    else if (attr.attribute_name === 'Class') extracted.class = val;
    else if (attr.attribute_name === 'Grade') extracted.grade = val;
    
    // Store with unit appended for display purposes
    extracted.raw_attributes[attr.attribute_name] = displayVal;
  });
  return extracted;
}

export function buildVeldexItem(item, attributes) {
  const extracted = extractUexAttributes(attributes);
  return {
    item_api_id: item.id,
    item_uuid: item.uuid,
    item_name: item.name,
    item_category: item.category,
    item_section: item.section,
    manufacturer: item.company_name,
    component_size: extracted.size,
    component_class: extracted.class,
    component_grade: extracted.grade,
    extra_attributes: extracted.raw_attributes
  };
}

export async function fetchUexStations() {
  if (uexStationsCache.length > 0) return uexStationsCache;
  try {
    const res = await fetch(`https://api.uexcorp.space/2.0/space_stations`);
    if (!res.ok) throw new Error("Erreur HTTP: " + res.status);
    const json = await res.json();
    
    if (json.data && Array.isArray(json.data)) {
      const names = json.data.map(station => station.name).filter(Boolean);
      const combined = [...names, ...STANTON_MAJOR_CITIES];
      uexStationsCache = [...new Set(combined)].sort((a, b) => a.localeCompare(b));
    } else {
      uexStationsCache = [...STANTON_MAJOR_CITIES].sort();
    }
    return uexStationsCache;
  } catch (error) {
    logger.error("UEX", "fetchUexStations error:", error);
    return [...STANTON_MAJOR_CITIES].sort();
  }
}

export function searchUexStations(query) {
  if (!query || query.length < 2) return [];
  const lowerQuery = query.toLowerCase();
  
  const filtered = uexStationsCache.filter(station => station.toLowerCase().includes(lowerQuery));

  filtered.sort((a, b) => {
    const nameA = a.toLowerCase();
    const nameB = b.toLowerCase();
    
    const exactA = nameA === lowerQuery;
    const exactB = nameB === lowerQuery;
    if (exactA && !exactB) return -1;
    if (!exactA && exactB) return 1;

    const startsA = nameA.startsWith(lowerQuery);
    const startsB = nameB.startsWith(lowerQuery);
    if (startsA && !startsB) return -1;
    if (!startsA && startsB) return 1;

    return nameA.localeCompare(nameB);
  });

  return filtered;
}
