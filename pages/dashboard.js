import { supabase } from "../services/supabase.js";
import { $, setText, formatUnit, escapeHtml, showToast, logger } from "../scripts/utils.js";
import { store } from "../scripts/store.js";
import { searchUexItems } from "../services/uexApi.js";

let dashboardCache = [];
let searchTimeout;

/**
 * Loads inventory entries for the dashboard, respecting visibility rules.
 */
export async function loadCorporationStats() {
  if (!store.currentUser) return;


  // 1. Fetch entries
  const { data: allData, error: allErr } = await supabase
    .from("inventory_entries")
    .select("*")
    .order("created_at", { ascending: false });

  if (allErr) logger.error("Dashboard", "Fetch error:", allErr);

  const corpEntries = (allData || []).filter(e => 
    String(e.visibility || "").toLowerCase() === "corp"
  );


  // 2. Resolve Players
  const ownerIds = [...new Set(corpEntries.map(e => e.owner_user_id))].filter(Boolean);

  // Fetch profiles
  let { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("*") 
    .in("id", ownerIds);

  if (pErr) {
    const { data: profiles2, error: pErr2 } = await supabase
      .from("profiles")
      .select("*")
      .in("user_id", ownerIds);
    if (!pErr2) profiles = profiles2;
  }

  const playerMap = {};
  (profiles || []).forEach(p => {
    const pid = p.id || p.user_id;
    if (pid) {
      playerMap[pid] = p.display_name || p.username || pid.substring(0, 8);
    }
  });

  // 3. Inject player_name into entries
  dashboardCache = corpEntries.map(entry => ({
    ...entry,
    player_name: playerMap[entry.owner_user_id] || entry.owner_user_id?.substring(0, 8) || "Joueur"
  }));

  populateDashboardFilters();
  renderDashboardResults();
  renderTopStations();
  renderLastEntries();
}

export function renderMineralSearchTop3() { renderDashboardResults(); }
export function renderRecentEntries() { renderLastEntries(); }

function populateDashboardFilters() {
  const locSelect = $("dash-filter-uex-location");
  const catSelect = $("dash-filter-uex-category");
  const sizeSelect = $("dash-filter-uex-size");
  const classSelect = $("dash-filter-uex-class");
  const gradeSelect = $("dash-filter-uex-grade");
  const playerSelect = $("dash-filter-uex-player");

  if (!locSelect) return;

  const locations = new Set();
  const categories = new Set();
  const sizes = new Set();
  const classes = new Set();
  const grades = new Set();
  const players = new Set();

  dashboardCache.forEach(entry => {
    if (entry.location_name) locations.add(entry.location_name);
    if (entry.item_category) categories.add(entry.item_category);
    if (entry.component_size) sizes.add(entry.component_size);
    if (entry.item_category === 'Commodity' && entry.quality != null) {
      classes.add(String(entry.quality));
    } else if (entry.component_class) {
      classes.add(entry.component_class);
    }
    if (entry.component_grade) grades.add(entry.component_grade);
    if (entry.player_name) players.add(entry.player_name);
  });

  const populateSelect = (selectEl, setValues) => {
    const firstOpt = selectEl.options[0];
    selectEl.innerHTML = "";
    selectEl.appendChild(firstOpt);
    Array.from(setValues).sort().forEach(val => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = val;
      selectEl.appendChild(opt);
    });
  };

  const populateSelectWithLabels = (selectEl, setValues) => {
    const firstOpt = selectEl.options[0];
    selectEl.innerHTML = "";
    selectEl.appendChild(firstOpt);
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
  populateSelect(playerSelect, players);
}

function highlightMatch(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<span class="text-accent font-bold">$1</span>');
}

export function renderDashboardResults() {
  const tbody = $("dash-uex-storage-body");
  if (!tbody) return;

  const nameFilter = ($("dash-filter-uex-name")?.value || "").toLowerCase();
  const locFilter = $("dash-filter-uex-location")?.value || "";
  const catFilter = $("dash-filter-uex-category")?.value || "";
  const sizeFilter = $("dash-filter-uex-size")?.value || "";
  const classFilter = $("dash-filter-uex-class")?.value || "";
  const gradeFilter = $("dash-filter-uex-grade")?.value || "";
  const playerFilter = $("dash-filter-uex-player")?.value || "";

  const isFilterActive = nameFilter || locFilter || catFilter || sizeFilter || classFilter || gradeFilter || playerFilter;

  if (!isFilterActive) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-20 text-muted/30 text-sm text-center">
      <div class="flex flex-col items-center gap-4">
        <div class="w-12 h-12 bg-accent/5 rounded-full flex items-center justify-center border border-accent/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" class="opacity-40 text-accent">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </div>
        <div class="space-y-1 text-center">
          <p class="font-display font-bold uppercase tracking-[0.2em] text-accent/60 text-xs">Start a search to display results</p>
          <p class="text-[11px] opacity-50 uppercase tracking-widest font-sans font-medium">Filter by location, category, player, or item name</p>
        </div>
      </div>
    </td></tr>`;
    return;
  }

  const filtered = dashboardCache.filter(entry => {
    if (nameFilter) {
      const searchTerms = nameFilter.split(/\s+/);
      const entryText = `${entry.item_name} ${entry.item_category} ${entry.location_name} ${entry.player_name} ${entry.quality || ''} ${entry.component_size || ''} ${entry.component_class || ''} ${entry.component_grade || ''}`.toLowerCase();
      if (!searchTerms.every(term => entryText.includes(term))) return false;
    }
    if (locFilter && entry.location_name !== locFilter) return false;
    if (catFilter && entry.item_category !== catFilter) return false;
    if (sizeFilter && entry.component_size !== sizeFilter) return false;
    if (classFilter) {
      const entryClassValue = (entry.item_category === 'Commodity' && entry.quality != null) 
        ? String(entry.quality) 
        : entry.component_class;
      if (entryClassValue !== classFilter) return false;
    }
    if (gradeFilter && entry.component_grade !== gradeFilter) return false;
    if (playerFilter && entry.player_name !== playerFilter) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const getScore = (e) => {
      if (e.item_category === 'Commodity') return 1000 + (e.quality || 0);
      let score = 0;
      if (e.component_grade) {
        const g = String(e.component_grade);
        if (g === '1') score += 40;
        else if (g === '2') score += 30;
        else if (g === '3') score += 20;
        else if (g === '4') score += 10;
      }
      if (e.component_class) {
        const c = String(e.component_class).toUpperCase();
        if (c === 'A') score += 4;
        else if (c === 'B') score += 3;
        else if (c === 'C') score += 2;
        else if (c === 'D') score += 1;
      }
      return score;
    };
    const scoreA = getScore(a);
    const scoreB = getScore(b);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-muted text-[12px] font-display font-bold uppercase tracking-widest text-center opacity-40">No entries found for active filters</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((entry, index) => {
    const delay = (index * 0.03).toFixed(2);
    const rowClass = `veldex-row border-b border-line hover:bg-accent/[0.04] transition-all cursor-default group`;
    const rowStyle = `animation-delay: ${delay}s`;

    if (entry.item_category === 'Commodity') {
      return `
      <tr class="${rowClass}" style="${rowStyle}">
        <td class="py-5 px-4">
          <p class="font-sans font-bold text-white group-hover:text-accent transition-colors text-[15px]">${escapeHtml(entry.item_name)}</p>
        </td>
        <td class="py-5 px-4">
          <span class="px-2 py-0.5 rounded-sm bg-accent/5 border border-accent/20 text-[11px] font-display font-bold text-accent uppercase tracking-[0.15em] group-hover:bg-accent/10 transition-colors">Resource</span>
        </td>
        <td class="py-5 px-4 text-center text-muted/20 font-mono">—</td>
        <td class="py-5 px-4 font-sans font-bold text-white/80 text-center text-[15px]">${entry.quality != null ? escapeHtml(String(entry.quality)) : "—"}</td>
        <td class="py-5 px-4 text-center text-muted/20 font-mono">—</td>
        <td class="py-5 px-4 text-right">
          <p class="font-sans font-bold text-white text-[18px] leading-none group-hover:text-accent transition-colors drop-shadow-[0_0_8px_rgba(0,224,255,0.2)]">${entry.quantity}</p>
          <p class="text-[12px] font-display font-bold text-muted uppercase tracking-widest mt-1">${escapeHtml(entry.unit_type || "SCU")}</p>
        </td>
        <td class="py-5 px-4 font-sans text-muted/60 text-[14px]">${escapeHtml(entry.location_name || "Unknown")}</td>
        <td class="py-5 px-4 text-right">
          <span class="px-2 py-1 bg-accent2/5 border border-accent2/10 text-[11px] font-display font-bold text-accent2 uppercase tracking-[0.15em] rounded-sm group-hover:border-accent2/40 group-hover:bg-accent2/10 transition-all">${escapeHtml(entry.player_name)}</span>
        </td>
      </tr>
      `;
    } else {
      let catDisplay = entry.item_category || "Standard";
      if (catDisplay.toLowerCase().includes("weapon")) catDisplay = "Weapon";
      else if (catDisplay.toLowerCase().includes("attachment")) catDisplay = "Attachment";
      else if (catDisplay.toLowerCase().includes("armor")) catDisplay = "Armor";

      return `
      <tr class="${rowClass}" style="${rowStyle}">
        <td class="py-5 px-4">
          <p class="font-sans font-bold text-white group-hover:text-accent transition-colors text-[15px]">${escapeHtml(entry.item_name)}</p>
        </td>
        <td class="py-5 px-4">
          <span class="px-2 py-0.5 rounded-sm bg-white/5 border border-white/10 text-[11px] font-display font-bold text-white/60 uppercase tracking-[0.15em] group-hover:border-white/20 transition-colors">${escapeHtml(catDisplay)}</span>
        </td>
        <td class="py-5 px-4 font-sans font-bold text-white/80 text-center text-[15px]">${escapeHtml(entry.component_size || "S0")}</td>
        <td class="py-5 px-4 font-sans font-bold text-white/80 text-center text-[15px]">${escapeHtml(entry.component_class || "—")}</td>
        <td class="py-5 px-4 font-display font-bold text-accent text-[20px] text-center group-hover:drop-shadow-[0_0_10px_rgba(0,224,255,0.4)] transition-all">${escapeHtml(entry.component_grade || "—")}</td>
        <td class="py-5 px-4 text-right">
          <p class="font-sans font-bold text-white text-[18px] leading-none group-hover:text-accent transition-colors drop-shadow-[0_0_8px_rgba(0,224,255,0.2)]">${entry.quantity}</p>
          <p class="text-[12px] font-display font-bold text-muted uppercase tracking-widest mt-1">Units</p>
        </td>
        <td class="py-5 px-4 font-sans text-muted/60 text-[14px]">${escapeHtml(entry.location_name || "Unknown")}</td>
        <td class="py-5 px-4 text-right">
          <span class="px-2 py-1 bg-accent2/5 border border-accent2/10 text-[11px] font-display font-bold text-accent2 uppercase tracking-[0.15em] rounded-sm group-hover:border-accent2/40 group-hover:bg-accent2/10 transition-all">${escapeHtml(entry.player_name)}</span>
        </td>
      </tr>
      `;
    }
  }).join("");


}

export function renderTopStations() {
  const container = $("dash-top-stations");
  if (!container) return;

  const stationsData = {};
  dashboardCache.forEach(entry => {
    const loc = entry.location_name;
    if (!loc) return;
    if (!stationsData[loc]) stationsData[loc] = { count: 0, categories: {} };
    stationsData[loc].count++;
    const cat = entry.item_category || "Other";
    stationsData[loc].categories[cat] = (stationsData[loc].categories[cat] || 0) + 1;
  });

  const sorted = Object.entries(stationsData).sort((a, b) => b[1].count - a[1].count).slice(0, 3);
  if (sorted.length === 0) {
    container.innerHTML = `<p class="text-[12px] text-muted uppercase tracking-widest italic px-2">No logistics data detected.</p>`;
    return;
  }

  container.innerHTML = sorted.map(([name, data]) => {
    const catEntries = Object.entries(data.categories).sort((a, b) => b[1] - a[1]);
    let topCat = "Storage";
    if (catEntries.length > 1) topCat = "Mixed Storage";
    else if (catEntries.length === 1) {
      const rawCat = catEntries[0][0].toLowerCase();
      if (rawCat === 'commodity') topCat = "Resources";
      else if (rawCat.includes('weapon') || rawCat.includes('arms')) topCat = "Weapons";
      else if (rawCat.includes('armor')) topCat = "Armor";
      else if (rawCat.includes('component')) topCat = "Components";
      else topCat = catEntries[0][0];
    }

    return `
      <div class="flex items-center gap-4 group p-4 bg-panel2/40 border border-line rounded-sm hover:border-accent/40 transition-all relative overflow-hidden">
        <div class="absolute left-0 top-0 w-1 h-0 bg-accent transition-all group-hover:h-full"></div>
        <div class="w-10 h-10 rounded-sm bg-accent/5 border border-accent/10 flex items-center justify-center text-accent/60 group-hover:text-accent transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[14px] text-white font-sans font-bold truncate">${escapeHtml(name)}</p>
          <p class="text-[12px] text-muted font-display font-bold uppercase tracking-widest mt-1">Main: ${escapeHtml(topCat)}</p>
        </div>
        <div class="text-right">
          <p class="text-[15px] text-accent font-sans font-bold tabular-nums leading-none">${data.count}</p>
          <p class="text-[11px] text-muted font-display font-bold uppercase tracking-widest mt-1">entrées</p>
        </div>
      </div>`;
  }).join("");
}

export function renderLastEntries() {
  const container = $("dash-last-entries");
  if (!container) return;
  const last = dashboardCache.slice(0, 3);
  if (last.length === 0) {
    container.innerHTML = `<p class="text-[12px] text-muted uppercase tracking-widest italic px-2">No recent activity detected.</p>`;
    return;
  }
  container.innerHTML = last.map(entry => {
    const name = entry.player_name;
    const qty = entry.quantity || 0;
    const unit = entry.unit_type || "UNIT";
    const isResource = entry.item_category === 'Commodity';
    const qualityHtml = (isResource && entry.quality != null) 
      ? `<span class="ml-2 px-1.5 py-0.5 rounded-[1px] bg-accent/10 border border-accent/20 text-[11px] text-accent font-bold">Q: ${entry.quality}</span>` 
      : '';

    return `
      <div class="flex items-center gap-4 group p-4 bg-panel2/40 border border-line rounded-sm hover:border-accent2/40 transition-all relative overflow-hidden">
        <div class="absolute left-0 top-0 w-1 h-0 bg-accent2 transition-all group-hover:h-full"></div>
        <div class="w-10 h-10 rounded-sm bg-accent2/5 border border-accent2/10 flex items-center justify-center text-accent2/60 group-hover:text-accent2 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-[14px] text-white font-sans font-bold truncate group-hover:text-accent2 transition-colors">${escapeHtml(entry.item_name)}</p>
          <p class="text-[12px] text-muted font-display font-bold uppercase tracking-widest mt-1">Operator: ${escapeHtml(name)}</p>
        </div>
        <div class="text-right">
          <p class="text-[15px] text-accent font-sans font-bold tabular-nums leading-none">
            ${qty} <span class="text-[11px] text-muted font-bold">${unit.toUpperCase()}</span>
            ${qualityHtml}
          </p>
          <p class="text-[11px] text-muted font-display font-bold uppercase tracking-widest mt-1">${new Date(entry.created_at).toLocaleDateString()}</p>
        </div>
      </div>`;
  }).join("");
}

export function bindDashboardSearch() {
  $("dash-filter-uex-name")?.addEventListener("input", renderDashboardResults);
  $("dash-filter-uex-location")?.addEventListener("change", renderDashboardResults);
  $("dash-filter-uex-category")?.addEventListener("change", renderDashboardResults);
  $("dash-filter-uex-size")?.addEventListener("change", renderDashboardResults);
  $("dash-filter-uex-class")?.addEventListener("change", renderDashboardResults);
  $("dash-filter-uex-grade")?.addEventListener("change", renderDashboardResults);
  $("dash-filter-uex-player")?.addEventListener("change", renderDashboardResults);
}
