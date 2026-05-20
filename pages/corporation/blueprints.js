import { supabase } from "../../services/supabase.js";
import { $, setText, escapeHtml, getCurrentUser, logger } from "../../scripts/utils.js";
import { store } from "../../scripts/store.js";
import { showAlert, showConfirm } from "../../components/modal.js";
import { searchBlueprints } from "../../services/blueprintService.js";

let blueprintCache = [];
let allBlueprintsList = [];

export function renderBlueprintsPage() {
  const container = $("view-blueprints");
  if (!container) return;

  container.innerHTML = `
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-4xl font-display font-bold text-white uppercase tracking-widest flex items-center gap-4">
          <span class="w-3 h-10 bg-accent"></span>
          BLUEPRINT REGISTRY
        </h2>
        <p class="text-[12px] font-display font-bold text-muted uppercase tracking-widest mt-2 ml-7">Corporation blueprint ownership directory</p>
      </div>
      <button id="add-blueprint-btn" class="veldex-btn-primary h-12 px-6">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
        ADD BLUEPRINT
      </button>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-8">
      <!-- Blueprints List (Left/Main) -->
      <div class="xl:col-span-2 space-y-6">
        <section class="veldex-panel p-6">
          <div class="flex items-center justify-between mb-6 border-b border-line pb-4">
            <input id="search-blueprint-input" type="text" placeholder="Search blueprint..." class="veldex-input w-full max-w-sm" />
            <button id="refresh-blueprints" class="veldex-btn-secondary px-4 h-9 text-[10px]" type="button">
              UPDATE DATABASE
            </button>
          </div>
          
          <div class="overflow-x-auto veldex-scroll border border-line rounded-sm">
            <table class="veldex-table">
              <thead>
                <tr>
                  <th class="w-1/3">BLUEPRINT NAME</th>
                  <th>CATEGORY</th>
                  <th>OWNER</th>
                  <th>NOTES</th>
                  <th class="text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody id="blueprints-list-body">
                <tr>
                  <td colspan="5" class="py-12 text-center text-muted font-display uppercase tracking-widest opacity-50">
                    Initializing data streams...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <!-- Add Blueprint Form (Right/Sidebar) -->
      <div id="add-blueprint-panel" class="space-y-6 hidden">
        <section class="veldex-panel p-6 border border-accent/30 shadow-[0_0_15px_rgba(0,224,255,0.1)]">
          <h3 class="text-lg font-display font-bold uppercase tracking-widest text-accent mb-6 border-b border-line pb-4 flex items-center justify-between">
            Register Blueprint
            <button id="close-blueprint-panel" class="text-muted hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </h3>

          <div class="space-y-4">
            <div class="space-y-2">
              <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block">Blueprint Name / Search</label>
              <input id="new-blueprint-name" type="text" placeholder="Search or type custom name..." autocomplete="off" class="veldex-input w-full" />
            </div>

            <div id="blueprint-results-container" class="bg-bg/50 border border-line rounded-sm p-2 relative min-h-[150px] max-h-[250px] overflow-y-auto veldex-scroll hidden">
              <div id="blueprint-results-loading" class="hidden absolute inset-0 bg-bg/90 backdrop-blur-sm flex flex-col items-center justify-center text-xs text-accent font-medium z-10 gap-2">
                <div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
                SEARCHING...
              </div>
              <ul id="blueprint-autocomplete-list" class="space-y-1"></ul>
              
              <div id="blueprint-results-empty" class="hidden flex flex-col items-center justify-center text-center opacity-60 h-full py-4">
                <p class="text-[12px] font-display font-bold text-muted uppercase tracking-widest">No matching blueprints</p>
                <p class="text-[10px] text-muted/80 font-sans mt-1">Manual entry will be saved as custom.</p>
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block">Category (Optional)</label>
              <input id="new-blueprint-category" type="text" placeholder="e.g. Weapon, Shield" class="veldex-input w-full" />
            </div>

            <div class="space-y-2">
              <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block">Notes (Optional)</label>
              <input id="new-blueprint-notes" type="text" placeholder="Any details..." class="veldex-input w-full" />
            </div>

            <input type="hidden" id="new-blueprint-uuid" />
            <input type="hidden" id="new-output-uuid" />

            <div class="pt-4 mt-4 border-t border-line">
              <button id="save-blueprint-btn" class="veldex-btn-primary w-full h-11">
                REGISTER BLUEPRINT
              </button>
              <p id="blueprint-status" class="mt-3 text-[10px] text-muted font-sans italic text-center"></p>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

export function bindBlueprintsEvents() {
  $("add-blueprint-btn")?.addEventListener("click", () => {
    $("add-blueprint-panel")?.classList.remove("hidden");
    $("new-blueprint-name")?.focus();
  });

  $("close-blueprint-panel")?.addEventListener("click", () => {
    $("add-blueprint-panel")?.classList.add("hidden");
    resetBlueprintForm();
  });

  $("refresh-blueprints")?.addEventListener("click", loadBlueprints);

  $("search-blueprint-input")?.addEventListener("input", (e) => {
    renderBlueprintsList(e.target.value);
  });

  $("save-blueprint-btn")?.addEventListener("click", saveBlueprint);

  // Autocomplete
  const nameInput = $("new-blueprint-name");
  const autocompleteList = $("blueprint-autocomplete-list");
  let debounceTimer;

  if (nameInput) {
    nameInput.addEventListener("input", (e) => {
      clearTimeout(debounceTimer);
      const inputValue = e.target.value;
      const query = inputValue.trim();
      
      const resultsContainer = $("blueprint-results-container");
      const loadingIndicator = $("blueprint-results-loading");
      const emptyState = $("blueprint-results-empty");
      
      // Clear hidden fields when typing manually to avoid sending wrong UUIDs
      $("new-blueprint-uuid").value = "";
      $("new-output-uuid").value = "";
      $("new-blueprint-category").value = "";
      
      if (query.length < 2) {
        resultsContainer?.classList.add("hidden");
        autocompleteList.innerHTML = "";
        return;
      }
      
      resultsContainer?.classList.remove("hidden");
      loadingIndicator?.classList.remove("hidden");
      emptyState?.classList.add("hidden");
      autocompleteList.innerHTML = "";

      debounceTimer = setTimeout(async () => {
        if (!allBlueprintsList || allBlueprintsList.length === 0) {
          allBlueprintsList = await searchBlueprints(""); // Fetch all once and cache
        }
        
        const results = await searchBlueprints(query, allBlueprintsList);

        loadingIndicator?.classList.add("hidden");

        if (results.length === 0) {
          emptyState?.classList.remove("hidden");
          return;
        }

        autocompleteList.innerHTML = results.slice(0, 8).map(bp => `
          <li class="blueprint-suggestion p-3 border border-line/50 rounded-sm bg-panel2/50 hover:bg-accent/10 cursor-pointer flex flex-col gap-1 transition-colors"
               data-name="${escapeHtml(bp.name || '')}"
               data-cat="${escapeHtml(bp.category || '')}"
               data-uuid="${escapeHtml(bp.blueprint_uuid || '')}"
               data-outuuid="${escapeHtml(bp.output_item_uuid || '')}">
            <div class="flex items-center justify-between">
              <span class="text-sm font-display font-bold text-white">${escapeHtml(bp.name || 'Unnamed Blueprint')}</span>
              <span class="text-[10px] px-2 py-0.5 bg-bg/50 border border-line text-muted uppercase tracking-widest rounded-sm">${escapeHtml(bp.category || 'Unknown')}</span>
            </div>
            ${bp.blueprint_uuid ? `<span class="text-[9px] font-mono text-muted/50">${escapeHtml(bp.blueprint_uuid.split('-')[0])}</span>` : ''}
          </li>
        `).join("");
      }, 300);
    });

    // Remove close autocomplete on click outside, to keep it visible while editing manually if desired.
    // Or we can close it if they click outside the whole form.
    document.addEventListener("click", (e) => {
      const resultsContainer = $("blueprint-results-container");
      if (nameInput && resultsContainer && !nameInput.contains(e.target) && !resultsContainer.contains(e.target)) {
        // Option: hide results if clicked completely outside
        // resultsContainer.classList.add("hidden");
      }
    });

    // Handle suggestion click
    if (autocompleteList) {
      autocompleteList.addEventListener("click", (e) => {
        const suggestion = e.target.closest(".blueprint-suggestion");
        if (suggestion) {
          nameInput.value = suggestion.dataset.name;
          $("new-blueprint-category").value = suggestion.dataset.cat;
          $("new-blueprint-uuid").value = suggestion.dataset.uuid;
          $("new-output-uuid").value = suggestion.dataset.outuuid;
          
          const resultsContainer = $("blueprint-results-container");
          resultsContainer?.classList.add("hidden");
          
          // Visual feedback that it's selected
          nameInput.classList.add("border-accent");
          setTimeout(() => nameInput.classList.remove("border-accent"), 500);
        }
      });
    }
  }

  // Bind delete actions
  $("blueprints-list-body")?.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest(".delete-blueprint-btn");
    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const name = deleteBtn.dataset.name;
      await deleteBlueprint(id, name);
    }
  });

  window.addEventListener("view-changed", (e) => {
    if (e.detail.viewId === "view-blueprints") {
      loadBlueprints();
    }
  });
}

function resetBlueprintForm() {
  if ($("new-blueprint-name")) $("new-blueprint-name").value = "";
  if ($("new-blueprint-category")) $("new-blueprint-category").value = "";
  if ($("new-blueprint-notes")) $("new-blueprint-notes").value = "";
  if ($("new-blueprint-uuid")) $("new-blueprint-uuid").value = "";
  if ($("new-output-uuid")) $("new-output-uuid").value = "";
  if ($("blueprint-results-container")) $("blueprint-results-container").classList.add("hidden");
  setText("blueprint-status", "");
}

export async function loadBlueprints() {
  const tbody = $("blueprints-list-body");
  if (!tbody) return;

  if (!store.currentCorporationId) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-muted">No active corporation.</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-muted font-display uppercase tracking-widest opacity-50"><div class="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>Syncing...</td></tr>`;

  const { data, error } = await supabase
    .from("corp_blueprints")
    .select("*")
    .eq("corporation_id", store.currentCorporationId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Blueprints", "Fetch error:", error);
    tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-red-400">Error loading blueprints.</td></tr>`;
    return;
  }

  blueprintCache = data || [];
  renderBlueprintsList($("search-blueprint-input")?.value);
}

function renderBlueprintsList(query = "") {
  const tbody = $("blueprints-list-body");
  if (!tbody) return;

  if (blueprintCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-muted font-display uppercase tracking-widest opacity-50">No blueprints registered yet.</td></tr>`;
    return;
  }

  const q = (query || "").toLowerCase();
  const filtered = blueprintCache.filter(bp => {
    return (bp.blueprint_name && bp.blueprint_name.toLowerCase().includes(q)) ||
           (bp.owner_display_name && bp.owner_display_name.toLowerCase().includes(q)) ||
           (bp.notes && bp.notes.toLowerCase().includes(q));
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-muted font-display uppercase tracking-widest opacity-50">No matching blueprints found.</td></tr>`;
    return;
  }

  const currentUserId = store.currentUser?.id;

  tbody.innerHTML = filtered.map(bp => {
    const isOwner = bp.owner_user_id === currentUserId;
    const catBadge = bp.blueprint_category ? `<span class="px-2 py-0.5 bg-panel2 border border-line text-[10px] uppercase tracking-widest text-muted rounded-sm">${escapeHtml(bp.blueprint_category)}</span>` : '<span class="text-muted/30">-</span>';
    
    let actionHtml = '';
    if (isOwner) {
      actionHtml = `
        <button type="button" class="delete-blueprint-btn text-red-400/60 hover:text-red-400 transition-colors p-1" data-id="${bp.id}" data-name="${escapeHtml(bp.blueprint_name)}" title="Delete">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      `;
    }

    return `
      <tr>
        <td>
          <div class="font-display font-bold text-white uppercase tracking-wide">${escapeHtml(bp.blueprint_name)}</div>
        </td>
        <td>${catBadge}</td>
        <td>
          <div class="text-[12px] text-muted font-sans font-medium flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${escapeHtml(bp.owner_display_name || 'Unknown')}
          </div>
        </td>
        <td><div class="text-[12px] text-muted/80 truncate max-w-xs">${escapeHtml(bp.notes || '-')}</div></td>
        <td class="text-right">${actionHtml}</td>
      </tr>
    `;
  }).join("");
}

export async function saveBlueprint() {
  if (!store.currentUser || !store.currentCorporationId) {
    setText("blueprint-status", "Authentication error.");
    return;
  }

  const name = $("new-blueprint-name")?.value.trim();
  const category = $("new-blueprint-category")?.value.trim() || null;
  const notes = $("new-blueprint-notes")?.value.trim() || null;
  const bpUuid = $("new-blueprint-uuid")?.value || null;
  const outUuid = $("new-output-uuid")?.value || null;

  if (!name) {
    setText("blueprint-status", "Name is required.");
    return;
  }

  const btn = $("save-blueprint-btn");
  btn.disabled = true;
  setText("blueprint-status", "Checking duplicates...");

  // Prevent exact duplicates: same corp, same owner, same blueprint name
  const existing = blueprintCache.find(bp => 
    bp.owner_user_id === store.currentUser.id && 
    bp.blueprint_name.toLowerCase() === name.toLowerCase()
  );

  if (existing) {
    setText("blueprint-status", "You already registered this blueprint.");
    btn.disabled = false;
    return;
  }

  setText("blueprint-status", "Registering...");

  // We need the user's username/display name
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", store.currentUser.id)
    .single();

  const { error } = await supabase
    .from("corp_blueprints")
    .insert({
      corporation_id: store.currentCorporationId,
      owner_user_id: store.currentUser.id,
      owner_display_name: profile?.username || "Unknown",
      blueprint_name: name,
      blueprint_category: category,
      blueprint_uuid: bpUuid,
      output_item_uuid: outUuid,
      notes: notes
    });

  btn.disabled = false;

  if (error) {
    logger.error("Blueprints", "Insert error:", error);
    setText("blueprint-status", "Error: " + error.message);
    return;
  }

  resetBlueprintForm();
  $("add-blueprint-panel").classList.add("hidden");
  
  await loadBlueprints();
}

async function deleteBlueprint(id, name) {
  const confirmed = await showConfirm("Delete Blueprint", `Are you sure you want to remove "${name}" from your registry?`);
  if (!confirmed) return;

  const { error } = await supabase
    .from("corp_blueprints")
    .delete()
    .eq("id", id)
    .eq("owner_user_id", store.currentUser.id); // extra safety measure

  if (error) {
    logger.error("Blueprints", "Delete error:", error);
    showAlert("Error", "Could not delete blueprint.");
    return;
  }

  await loadBlueprints();
}
