import { supabase } from "../services/supabase.js";
import { $, logger, escapeHtml, getCurrentUser } from "../scripts/utils.js";

// ==================================================
// STATE
// ==================================================
let cargoGrids = [];
let selectedGridId = null;
let selectedGridZones = [];

// ==================================================
// SUPABASE QUERIES - GRIDS
// ==================================================
export async function loadCargoGrids() {
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('ship_cargo_grids')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error("CargoGrids", "Failed to load grids", error);
    return [];
  }
  
  cargoGrids = data || [];
  return cargoGrids;
}

export async function createCargoGrid({ shipName, gridName, notes }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('ship_cargo_grids')
    .insert([{ user_id: user.id, ship_name: shipName, grid_name: gridName, notes }])
    .select()
    .single();

  if (error) {
    logger.error("CargoGrids", "Failed to create grid", error);
    return null;
  }
  
  return data;
}

export async function updateCargoGrid(gridId, { shipName, gridName, notes }) {
  const { data, error } = await supabase
    .from('ship_cargo_grids')
    .update({ ship_name: shipName, grid_name: gridName, notes, updated_at: new Date().toISOString() })
    .eq('id', gridId)
    .select()
    .single();

  if (error) {
    logger.error("CargoGrids", "Failed to update grid", error);
    return null;
  }
  
  return data;
}

export async function deleteCargoGrid(gridId) {
  const { error } = await supabase
    .from('ship_cargo_grids')
    .delete()
    .eq('id', gridId);

  if (error) {
    logger.error("CargoGrids", "Failed to delete grid", error);
    return false;
  }
  return true;
}

// ==================================================
// SUPABASE QUERIES - ZONES
// ==================================================
export async function loadCargoGridZones(gridId) {
  const { data, error } = await supabase
    .from('ship_cargo_zones')
    .select('*')
    .eq('grid_id', gridId)
    .order('zone_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    logger.error("CargoGrids", "Failed to load zones", error);
    return [];
  }
  
  selectedGridZones = data || [];
  return selectedGridZones;
}

export async function createCargoZone({ gridId, zoneName, capacityScu, zoneOrder, notes }) {
  const { data, error } = await supabase
    .from('ship_cargo_zones')
    .insert([{ grid_id: gridId, zone_name: zoneName, capacity_scu: capacityScu, zone_order: zoneOrder || 0, notes }])
    .select()
    .single();

  if (error) {
    logger.error("CargoGrids", "Failed to create zone", error);
    return null;
  }
  
  return data;
}

export async function updateCargoZone(zoneId, { zoneName, capacityScu, zoneOrder, notes }) {
  const { data, error } = await supabase
    .from('ship_cargo_zones')
    .update({ zone_name: zoneName, capacity_scu: capacityScu, zone_order: zoneOrder || 0, notes, updated_at: new Date().toISOString() })
    .eq('id', zoneId)
    .select()
    .single();

  if (error) {
    logger.error("CargoGrids", "Failed to update zone", error);
    return null;
  }
  
  return data;
}

export async function deleteCargoZone(zoneId) {
  const { error } = await supabase
    .from('ship_cargo_zones')
    .delete()
    .eq('id', zoneId);

  if (error) {
    logger.error("CargoGrids", "Failed to delete zone", error);
    return false;
  }
  return true;
}

// ==================================================
// UI RENDERING
// ==================================================
export function renderCargoGridsPage() {
  const container = $("view-cargo-grids");
  if (!container) return;

  container.innerHTML = `
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-4xl font-display font-bold text-white uppercase tracking-widest flex items-center gap-4">
          <span class="w-3 h-10 bg-accent"></span>
          Cargo Grids
        </h2>
        <p class="text-[12px] font-display font-bold text-muted uppercase tracking-widest mt-2 ml-7">Manage private custom ship layouts</p>
      </div>
    </div>

    <!-- Notice -->
    <div class="bg-accent/5 border border-accent/20 rounded-sm p-3 flex items-center gap-3">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span class="text-[12px] font-sans text-accent/80">These grids are private and bound to your account. Only you can view or assign cargo to them.</span>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
      <!-- Left Panel: My Grids & Create -->
      <div class="xl:col-span-1 space-y-6 flex flex-col min-h-0">
        
        <div class="veldex-panel p-6">
          <div class="flex items-center justify-between mb-4 border-b border-line pb-3">
            <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Create Cargo Grid</h3>
          </div>
          <form id="cg-create-form" class="space-y-4">
            <div class="relative">
              <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Ship Name</label>
              <input type="text" id="cg-new-ship" required autocomplete="off" placeholder="e.g. Hull B" class="veldex-input w-full" />
            </div>
            <div class="relative">
              <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Layout / Grid Name</label>
              <input type="text" id="cg-new-name" required autocomplete="off" placeholder="e.g. Standard Layout" class="veldex-input w-full" />
            </div>
            <div class="relative">
              <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Notes (Optional)</label>
              <input type="text" id="cg-new-notes" autocomplete="off" placeholder="e.g. Optimized for trading" class="veldex-input w-full" />
            </div>
            <button type="submit" class="veldex-btn-primary w-full h-11 mt-2">CREATE GRID</button>
          </form>
        </div>

        <div class="veldex-panel p-6 flex flex-col min-h-0">
          <div class="flex items-center justify-between mb-4 border-b border-line pb-3 shrink-0">
            <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">My Cargo Grids</h3>
          </div>
          <div id="cg-list" class="space-y-3 flex-1 overflow-y-auto veldex-scroll pr-1">
            <!-- Injected via renderCargoGridList -->
            <p class="text-[11px] text-muted font-sans">Loading grids...</p>
          </div>
        </div>
      </div>

      <!-- Center Panel: Grid Editor -->
      <div class="xl:col-span-2 veldex-panel flex flex-col p-6 min-h-0">
        <div id="cg-editor-container">
          <div class="flex flex-col items-center justify-center py-16 text-center opacity-30">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
            <p class="text-sm font-display font-bold uppercase tracking-widest mt-4">NO GRID SELECTED</p>
          </div>
        </div>
      </div>
    </div>
  `;

  bindCargoGridsPageEvents();
  refreshCargoGrids();
}

async function refreshCargoGrids() {
  await loadCargoGrids();
  renderCargoGridList();
  
  if (selectedGridId) {
    const gridExists = cargoGrids.find(g => g.id === selectedGridId);
    if (!gridExists) {
      selectedGridId = null;
    }
  }
  
  renderSelectedGridEditor();
}

function renderCargoGridList() {
  const container = $("cg-list");
  if (!container) return;

  if (cargoGrids.length === 0) {
    container.innerHTML = `<p class="text-[11px] text-muted font-sans italic">You have no cargo grids.</p>`;
    return;
  }

  container.innerHTML = cargoGrids.map(g => `
    <div class="cursor-pointer border ${selectedGridId === g.id ? 'border-accent bg-accent/10' : 'border-line/50 bg-panel2/40 hover:border-line'} rounded-sm p-3 transition-colors" data-id="${g.id}" onclick="window.selectCargoGrid('${g.id}')">
      <div class="flex items-center justify-between mb-1">
        <h4 class="text-[12px] font-display font-bold text-white tracking-widest uppercase">${escapeHtml(g.ship_name)}</h4>
      </div>
      <p class="text-[11px] text-accent font-sans">${escapeHtml(g.grid_name)}</p>
      ${g.notes ? `<p class="text-[10px] text-muted font-sans italic mt-1 line-clamp-1">${escapeHtml(g.notes)}</p>` : ''}
    </div>
  `).join('');
}

window.selectCargoGrid = async function(gridId) {
  selectedGridId = gridId;
  renderCargoGridList();
  
  // Show loading state in editor
  const editor = $("cg-editor-container");
  if (editor) {
    editor.innerHTML = `<p class="text-[11px] text-accent font-sans">Loading zones...</p>`;
  }
  
  await loadCargoGridZones(gridId);
  renderSelectedGridEditor();
};

function renderSelectedGridEditor() {
  const container = $("cg-editor-container");
  if (!container) return;

  if (!selectedGridId) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-center opacity-30">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line>
        </svg>
        <p class="text-sm font-display font-bold uppercase tracking-widest mt-4">NO GRID SELECTED</p>
      </div>
    `;
    return;
  }

  const grid = cargoGrids.find(g => g.id === selectedGridId);
  if (!grid) return;

  const totalScu = selectedGridZones.reduce((sum, z) => sum + parseFloat(z.capacity_scu), 0);

  container.innerHTML = `
    <!-- Grid Editing Header -->
    <div class="flex items-center justify-between mb-4 border-b border-line pb-3">
      <h3 class="text-[14px] font-display font-black text-accent uppercase tracking-[0.2em] flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
        Grid Settings
      </h3>
      <div class="flex gap-2">
        <span class="text-[10px] font-mono text-muted bg-bg px-2 py-0.5 rounded border border-line">Total Capacity: ${totalScu} SCU</span>
        <button id="cg-delete-btn" class="text-red-500 hover:text-red-400 border border-red-500/20 bg-red-500/10 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase transition-colors" data-id="${grid.id}">DELETE GRID</button>
      </div>
    </div>

    <!-- Grid Properties Edit Form -->
    <form id="cg-edit-grid-form" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 pb-6 border-b border-line/30">
      <div>
        <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Ship Name</label>
        <input type="text" id="cg-edit-ship" required value="${escapeHtml(grid.ship_name)}" class="veldex-input w-full text-[11px]" />
      </div>
      <div>
        <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Grid Name</label>
        <input type="text" id="cg-edit-name" required value="${escapeHtml(grid.grid_name)}" class="veldex-input w-full text-[11px]" />
      </div>
      <div class="flex items-end gap-2">
        <div class="flex-1">
          <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Notes</label>
          <input type="text" id="cg-edit-notes" value="${escapeHtml(grid.notes || '')}" class="veldex-input w-full text-[11px]" />
        </div>
        <button type="submit" class="veldex-btn-secondary h-[34px] px-3 shrink-0 text-[10px]">SAVE</button>
      </div>
    </form>

    <!-- Cargo Zones Management -->
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Cargo Zones</h3>
    </div>

    <div class="space-y-4">
      <!-- Add Zone Form -->
      <form id="cg-add-zone-form" class="bg-panel2/30 border border-line/50 p-3 rounded-sm flex flex-col md:flex-row gap-3 items-end">
        <div class="flex-1 w-full">
          <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Zone Name</label>
          <input type="text" id="cg-zone-name" required placeholder="e.g. Zone A" class="veldex-input w-full text-[11px]" />
        </div>
        <div class="w-full md:w-24 shrink-0">
          <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">SCU</label>
          <input type="number" id="cg-zone-scu" required min="0" step="1" placeholder="0" class="veldex-input w-full text-[11px]" />
        </div>
        <div class="flex-1 w-full hidden md:block">
          <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Location / Notes</label>
          <input type="text" id="cg-zone-notes" placeholder="e.g. Front left" class="veldex-input w-full text-[11px]" />
        </div>
        <button type="submit" class="veldex-btn-primary h-[34px] px-4 shrink-0 w-full md:w-auto text-[10px]">ADD ZONE</button>
      </form>

      <!-- Zones List -->
      <div class="border border-line rounded-sm overflow-hidden mt-4">
        <table class="veldex-table w-full">
          <thead>
            <tr>
              <th class="w-8 text-center">#</th>
              <th>ZONE NAME</th>
              <th>CAPACITY</th>
              <th>NOTES</th>
              <th class="text-right">ACT</th>
            </tr>
          </thead>
          <tbody>
            ${selectedGridZones.length === 0 
              ? `<tr><td colspan="5" class="py-6 text-center text-muted text-[11px]">No zones defined.</td></tr>`
              : selectedGridZones.map((z, idx) => `
                <tr class="group/zone">
                  <td class="text-center text-muted/60 text-[10px]">${idx + 1}</td>
                  <td>
                    <input type="text" class="cg-edit-zname veldex-input h-7 px-2 w-full text-[11px] bg-transparent border-transparent group-hover/zone:border-line/50 focus:border-accent" data-id="${z.id}" value="${escapeHtml(z.zone_name)}" />
                  </td>
                  <td>
                    <div class="flex items-center gap-1">
                      <input type="number" min="0" class="cg-edit-zscu veldex-input h-7 px-2 w-16 text-[11px] bg-transparent border-transparent group-hover/zone:border-line/50 focus:border-accent text-accent font-mono font-bold" data-id="${z.id}" value="${z.capacity_scu}" />
                      <span class="text-[9px] text-muted font-mono">SCU</span>
                    </div>
                  </td>
                  <td>
                    <input type="text" class="cg-edit-znotes veldex-input h-7 px-2 w-full text-[11px] bg-transparent border-transparent group-hover/zone:border-line/50 focus:border-accent text-muted focus:text-white" data-id="${z.id}" value="${escapeHtml(z.notes || '')}" placeholder="-" />
                  </td>
                  <td class="text-right">
                    <button class="cg-del-zone-btn text-red-500 hover:text-red-400 p-1 opacity-0 group-hover/zone:opacity-100 transition-opacity" data-id="${z.id}" title="Delete Zone">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </td>
                </tr>
              `).join('')
            }
          </tbody>
        </table>
      </div>
      <p class="text-[10px] text-muted italic font-sans px-1">Tip: Edit zone fields directly. They save automatically when you click away or press Enter.</p>
    </div>
  `;

  bindCargoGridEditorEvents();
}

// ==================================================
// EVENT BINDINGS
// ==================================================
function bindCargoGridsPageEvents() {
  const createForm = $("cg-create-form");
  if (createForm) {
    createForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const shipName = $("cg-new-ship").value.trim();
      const gridName = $("cg-new-name").value.trim();
      const notes = $("cg-new-notes").value.trim();

      if (shipName && gridName) {
        const createBtn = createForm.querySelector("button[type='submit']");
        createBtn.disabled = true;
        createBtn.textContent = "CREATING...";

        const newGrid = await createCargoGrid({ shipName, gridName, notes });
        if (newGrid) {
          createForm.reset();
          await refreshCargoGrids();
          window.selectCargoGrid(newGrid.id); // Auto-select the newly created grid
        }
        
        createBtn.disabled = false;
        createBtn.textContent = "CREATE GRID";
      }
    });
  }
}

function bindCargoGridEditorEvents() {
  const editGridForm = $("cg-edit-grid-form");
  if (editGridForm) {
    editGridForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!selectedGridId) return;

      const shipName = $("cg-edit-ship").value.trim();
      const gridName = $("cg-edit-name").value.trim();
      const notes = $("cg-edit-notes").value.trim();

      if (shipName && gridName) {
        const btn = editGridForm.querySelector("button");
        btn.textContent = "SAVING...";
        const updated = await updateCargoGrid(selectedGridId, { shipName, gridName, notes });
        btn.textContent = "SAVE";
        if (updated) {
          await refreshCargoGrids();
        }
      }
    });
  }

  const deleteGridBtn = $("cg-delete-btn");
  if (deleteGridBtn) {
    deleteGridBtn.addEventListener("click", async (e) => {
      if (confirm("Are you sure you want to delete this grid? This will also delete all its zones.")) {
        const success = await deleteCargoGrid(selectedGridId);
        if (success) {
          selectedGridId = null;
          await refreshCargoGrids();
        }
      }
    });
  }

  const addZoneForm = $("cg-add-zone-form");
  if (addZoneForm) {
    addZoneForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!selectedGridId) return;

      const zoneName = $("cg-zone-name").value.trim();
      const capacityScu = parseFloat($("cg-zone-scu").value);
      const notes = $("cg-zone-notes").value.trim();
      
      const nextOrder = selectedGridZones.length > 0 
        ? Math.max(...selectedGridZones.map(z => z.zone_order)) + 1 
        : 1;

      if (zoneName && capacityScu >= 0) {
        const btn = addZoneForm.querySelector("button");
        btn.disabled = true;
        btn.textContent = "ADDING...";
        
        const newZone = await createCargoZone({ 
          gridId: selectedGridId, 
          zoneName, 
          capacityScu, 
          zoneOrder: nextOrder, 
          notes 
        });

        if (newZone) {
          await loadCargoGridZones(selectedGridId);
          renderSelectedGridEditor();
        } else {
          btn.disabled = false;
          btn.textContent = "ADD ZONE";
        }
      }
    });
  }

  document.querySelectorAll(".cg-del-zone-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const zoneId = e.currentTarget.dataset.id;
      if (confirm("Delete this zone?")) {
        const success = await deleteCargoZone(zoneId);
        if (success) {
          await loadCargoGridZones(selectedGridId);
          renderSelectedGridEditor();
        }
      }
    });
  });

  // Auto-save on blur for zone edits
  const handleZoneEdit = async (e) => {
    const input = e.target;
    const zoneId = input.dataset.id;
    const tr = input.closest('tr');
    
    const zoneName = tr.querySelector('.cg-edit-zname').value.trim();
    const capacityScu = parseFloat(tr.querySelector('.cg-edit-zscu').value);
    const notes = tr.querySelector('.cg-edit-znotes').value.trim();

    // Small visual feedback
    const originalBorder = input.style.borderColor;
    input.style.borderColor = "#00E0FF";

    const zone = selectedGridZones.find(z => z.id === zoneId);
    if (zone && (zone.zone_name !== zoneName || parseFloat(zone.capacity_scu) !== capacityScu || (zone.notes || '') !== notes)) {
      if (zoneName && capacityScu >= 0) {
        const updated = await updateCargoZone(zoneId, { zoneName, capacityScu, zoneOrder: zone.zone_order, notes });
        if (updated) {
          // Update local memory without full refresh to avoid input losing focus aggressively
          Object.assign(zone, updated);
          
          // Re-calculate total SCU in the header
          const totalScu = selectedGridZones.reduce((sum, z) => sum + parseFloat(z.capacity_scu), 0);
          const headerBadge = $("cg-editor-container").querySelector('.bg-bg.px-2.border-line');
          if (headerBadge) {
            headerBadge.textContent = `Total Capacity: ${totalScu} SCU`;
          }
        }
      }
    }

    setTimeout(() => {
      input.style.borderColor = originalBorder;
    }, 300);
  };

  document.querySelectorAll(".cg-edit-zname, .cg-edit-zscu, .cg-edit-znotes").forEach(input => {
    input.addEventListener("change", handleZoneEdit);
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        input.blur();
      }
    });
  });
}

// Initial UI sync
window.addEventListener("view-changed", (e) => {
  if (e.detail.viewId === "view-cargo-grids") {
    renderCargoGridsPage();
  }
});
