import { $, logger, escapeHtml, toggleMobileSticky } from "../scripts/utils.js";
import { searchUexStations, searchUexItems, fetchAllUexItems, fetchUexStations, fetchUexCommodities } from "../services/uexApi.js";
import { runOcrOnImage } from "../services/ocrService.js";
import { loadCargoGrids, loadCargoGridZones } from "./cargoGrids.js";

let availableGrids = [];
let activeZones = [];

const MANIFEST_KEY = "veldex_cargo_manifest_v1";

function getManifest() {
  try {
    const data = localStorage.getItem(MANIFEST_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      if (!parsed.hasOwnProperty('selectedCargoGridId')) {
        parsed.selectedCargoGridId = null;
      }
      if (!parsed.hasOwnProperty('showDeliveredTasks')) {
        parsed.showDeliveredTasks = false;
      }
      if (parsed.tasks) {
        parsed.tasks.forEach(t => {
          if (!t.status) t.status = "pending";
          if (!t.cargoZoneId) t.cargoZoneId = "";
        });
      }
      return parsed;
    }
  } catch (e) {
    logger.error("Manifest", "Failed to parse local manifest", e);
  }
  return { tasks: [], dropoffCargoNotes: {}, selectedCargoGridId: null, showDeliveredTasks: false };
}

function saveManifest(data) {
  try {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(data));
    updateManifestUI();
  } catch (e) {
    logger.error("Manifest", "Failed to save local manifest", e);
  }
}

function updateTaskStatus(taskId, newStatus) {
  const data = getManifest();
  const task = data.tasks.find(t => t.id === taskId);
  if (task) {
    task.status = newStatus;
    saveManifest(data);
  }
}

function updateTaskZone(taskId, newZoneId) {
  const data = getManifest();
  const task = data.tasks.find(t => t.id === taskId);
  if (task) {
    task.cargoZoneId = newZoneId;
    saveManifest(data);
  }
}

function applyZoneToDropoffGroup(dropoffStation, newZoneId) {
  const data = getManifest();
  let modified = false;
  data.tasks.forEach(t => {
    if (t.dropoffStation === dropoffStation) {
      t.cargoZoneId = newZoneId || null;
      modified = true;
    }
  });
  if (modified) {
    saveManifest(data);
  }
}

function updateSelectedGrid(gridId) {
  const data = getManifest();
  data.selectedCargoGridId = gridId || null;
  saveManifest(data);
  refreshCargoGridsForManifest();
}

function toggleShowDeliveredTasks() {
  const data = getManifest();
  data.showDeliveredTasks = !data.showDeliveredTasks;
  saveManifest(data);
}

function getZoneNameById(zoneId) {
  if (!zoneId) return "No zone";
  const zone = activeZones.find(z => z.id === zoneId);
  return zone ? zone.zone_name : "No zone";
}

function generateId() {
  return 'task_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// ----------------------------------------------------
// PARSER LOGIC
// ----------------------------------------------------
// ----------------------------------------------------
// PARSER LOGIC
// ----------------------------------------------------
function normalizeOcrText(rawText) {
  let text = rawText;
  
  // Replace noise characters with spaces
  text = text.replace(/[<>©¢◆◇♦|•·~]/g, ' ');

  // Common OCR mistakes
  text = text.replace(/Aluminium/gi, 'Aluminum');
  text = text.replace(/Baijini Paint/gi, 'Baijini Point');
  text = text.replace(/Tressler abave/gi, 'Tressler above');
  text = text.replace(/micro\s*Tech/gi, 'microTech');
  text = text.replace(/Arc\s*Corp?/gi, 'ArcCorp');
  text = text.replace(/\babove\s+[Il\|1]\s+(microTech|Hurston|ArcCorp|Crusader)\b/gi, 'above $1');

  // Remove obvious UI noise lines
  const noiseLines = [
    "OFFERS ACCEPTED HISTORY",
    "OFFERS", "ACCEPTED", "HISTORY",
    "Contract Availability",
    "Contracted By",
    "DETAILS PRIMARY OBJECTIVES",
    "DETAILS", "PRIMARY OBJECTIVES",
    "Reward =",
    "ACCEPT OFFER",
    "Covalex Shipping",
    "Chase Hewitt",
    "By the way",
    "Happy travels"
  ];
  const lines = text.split('\n');
  const filteredLines = lines.filter(line => {
    const l = line.trim();
    for (const noise of noiseLines) {
      if (l.includes(noise)) return false;
    }
    return true;
  });
  text = filteredLines.join('\n');

  // Merge broken lines when a sentence continues after "above"
  text = text.replace(/above\s*\n\s*/gi, 'above ');

  // Replace line breaks with spaces to allow sequence extraction
  text = text.replace(/\n/g, ' ');

  // Normalize multiple spaces into one
  text = text.replace(/[ \t]+/g, ' ').trim();

  return text;
}

function extractObjectiveFragments(normalizedText) {
  const regex = /\b(Deliver|Collect)\b/gi;
  let match;
  const indices = [];
  while ((match = regex.exec(normalizedText)) !== null) {
    indices.push({ type: match[1], index: match.index });
  }

  const fragments = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].index;
    const end = i + 1 < indices.length ? indices[i+1].index : normalizedText.length;
    let fragment = normalizedText.substring(start, end).trim();
    fragments.push(fragment);
  }
  return fragments;
}

function cleanDropoffLocation(value) {
  if (!value) return "";
  let loc = value.trim();
  
  const stopPhrases = [
    "By the way", "Happy travels", "Chase Hewitt", "Collect", "Deliver", 
    "Contract", "Details", "Primary Objectives", "Accept Offer"
  ];
  
  let minIdx = loc.length;
  for (const phrase of stopPhrases) {
    const idx = loc.toLowerCase().indexOf(phrase.toLowerCase());
    if (idx !== -1 && idx < minIdx) {
      minIdx = idx;
    }
  }
  loc = loc.substring(0, minIdx).trim();

  loc = loc.replace(/[.,;:]+$/, '').trim();
  return loc;
}

function cleanPickupLocation(value) {
  if (!value) return "";
  let loc = value.trim();
  loc = loc.replace(/[.,;:]+$/, '').trim();
  return loc;
}

function cleanItemName(value) {
  if (!value) return "";
  let item = value.trim();
  item = item.replace(/[^a-zA-Z0-9\s-]/g, '');
  item = item.replace(/\s+/g, ' ');
  return item.trim();
}

function parsePrimaryObjectivesText(rawText) {
  const normText = normalizeOcrText(rawText);
  const fragments = extractObjectiveFragments(normText);

  const tasks = [];
  const pendingDelivers = [];

  const deliverRegex = /^Deliver\s+(?:0\s*\/\s*)?(\d{1,4})\s*SCU\s+of\s+([A-Za-z0-9 '\-]+?)\s+to\s+(.+)$/i;
  const collectRegex = /^Collect\s+([A-Za-z0-9 '\-]+?)\s+from\s+(.+)$/i;

  for (const fragment of fragments) {
    if (fragment.toLowerCase().startsWith("deliver")) {
      const match = fragment.match(deliverRegex);
      if (match) {
        pendingDelivers.push({
          quantity: parseInt(match[1], 10),
          itemName: cleanItemName(match[2]),
          dropoffStation: cleanDropoffLocation(match[3]),
          collects: []
        });
      }
    } else if (fragment.toLowerCase().startsWith("collect")) {
      const match = fragment.match(collectRegex);
      if (match) {
        const item = cleanItemName(match[1]);
        const station = cleanPickupLocation(match[2]);
        
        for (let i = pendingDelivers.length - 1; i >= 0; i--) {
          if (pendingDelivers[i].itemName.toLowerCase() === item.toLowerCase()) {
            pendingDelivers[i].collects.push(station);
            break;
          }
        }
      }
    }
  }

  for (const pd of pendingDelivers) {
    let pickup = "Unknown pickup";
    let uncertain = false;
    let pickupStations = [];

    if (pd.collects.length === 1) {
      pickup = pd.collects[0];
    } else if (pd.collects.length > 1) {
      pickup = "Multiple pickups";
      pickupStations = pd.collects;
      uncertain = true;
    }

    let warningMsg = null;
    if (pd.quantity > 500) {
      uncertain = true;
      warningMsg = "High quantity detected";
    }
    if (pickup === "Unknown pickup") {
      uncertain = true;
      warningMsg = warningMsg ? warningMsg + ", Missing pickup" : "Missing pickup";
    }

    tasks.push({
      id: generateId(),
      missionId: "",
      pickupStation: pickup,
      dropoffStation: pd.dropoffStation,
      itemName: pd.itemName,
      quantity: pd.quantity,
      unit: "SCU",
      status: "pending",
      cargoZoneId: "",
      uncertain: uncertain,
      warningMsg: warningMsg,
      pickupStations: pickupStations,
      source: "ocr"
    });
  }

  return { tasks, normText, fragments };
}

// ----------------------------------------------------
// ACTIONS
// ----------------------------------------------------
function addTask(task) {
  const data = getManifest();
  data.tasks.push(task);
  saveManifest(data);
}

function deleteTask(id) {
  const data = getManifest();
  data.tasks = data.tasks.filter(t => t.id !== id);
  saveManifest(data);
}

function clearManifest() {
  if (confirm("Are you sure you want to clear the entire manifest?")) {
    saveManifest({ tasks: [], dropoffCargoNotes: {} });
  }
}

function updateDropoffNote(station, note) {
  const data = getManifest();
  data.dropoffCargoNotes[station] = note;
  saveManifest(data);
}

function markPickupGroupLoaded(pickupStation) {
  const data = getManifest();
  let changed = false;
  data.tasks.forEach(t => {
    if (t.pickupStation === pickupStation && t.status === "pending") {
      t.status = "loaded";
      changed = true;
    }
  });
  if (changed) saveManifest(data);
}

function markDropoffGroupDelivered(dropoffStation) {
  const data = getManifest();
  let changed = false;
  data.tasks.forEach(t => {
    if (t.dropoffStation === dropoffStation && t.status === "loaded") {
      t.status = "delivered";
      changed = true;
    }
  });
  if (changed) saveManifest(data);
}

// ----------------------------------------------------
// UI RENDERING
// ----------------------------------------------------
export function renderManifestPage() {
  const container = $("view-manifest");
  if (!container) return;

  container.innerHTML = `
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-4xl font-display font-bold text-white uppercase tracking-widest flex items-center gap-4">
          <span class="w-3 h-10 bg-accent"></span>
          Cargo Manifest
        </h2>
        <p class="text-[12px] font-display font-bold text-muted uppercase tracking-widest mt-2 ml-7">Organize hauling missions and cargo placement</p>
      </div>
      <div class="flex gap-3">
        <button id="manifest-clear-btn" class="veldex-btn-ghost h-10 px-4 border-red-500/30 text-red-400 hover:bg-red-500/10">CLEAR MANIFEST</button>
      </div>
    </div>

    <!-- Notice -->
    <div class="bg-accent/5 border border-accent/20 rounded-sm p-3 flex items-center gap-3">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      <span class="text-[12px] font-sans text-accent/80">Local manifest only — saved in this browser, not shared with your corporation.</span>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4" id="manifest-stats-container">
      <!-- Injected -->
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
      
      <!-- Left Panel: Forms -->
      <div class="xl:col-span-1 space-y-6 flex flex-col min-h-0">
        <!-- Manual Task Form -->
        <div class="veldex-panel p-6">
          <div class="flex items-center justify-between mb-4 border-b border-line pb-3">
            <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Add Manual Task</h3>
          </div>
          <form id="manifest-manual-form" class="space-y-4">
            <div class="relative">
              <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Pickup Station</label>
              <input type="text" id="manifest-pickup" required autocomplete="off" placeholder="e.g. CRU-L1" class="veldex-input w-full" />
              <div id="manifest-pickup-autocomplete" class="absolute z-50 left-0 right-0 top-full mt-1 bg-panel border border-line rounded-sm shadow-2xl hidden veldex-scroll max-h-48 overflow-y-auto"></div>
            </div>
            <div class="relative">
              <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Drop-off Station</label>
              <input type="text" id="manifest-dropoff" required autocomplete="off" placeholder="e.g. Area18" class="veldex-input w-full" />
              <div id="manifest-dropoff-autocomplete" class="absolute z-50 left-0 right-0 top-full mt-1 bg-panel border border-line rounded-sm shadow-2xl hidden veldex-scroll max-h-48 overflow-y-auto"></div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="relative">
                <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Item Name</label>
                <input type="text" id="manifest-item" required autocomplete="off" placeholder="e.g. Aluminum" class="veldex-input w-full" />
                <div id="manifest-item-autocomplete" class="absolute z-50 left-0 right-0 top-full mt-1 bg-panel border border-line rounded-sm shadow-2xl hidden veldex-scroll max-h-48 overflow-y-auto w-[200%]"></div>
              </div>
              <div>
                <label class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest block mb-1.5">Quantity (SCU)</label>
                <input type="number" id="manifest-qty" required min="1" placeholder="0" class="veldex-input w-full" />
              </div>
            </div>
            <button type="submit" class="veldex-btn-primary w-full h-11 mt-2">ADD TASK</button>
          </form>
        </div>

        <!-- OCR Form -->
        <div class="veldex-panel p-6">
          <div class="flex items-center justify-between mb-4 border-b border-line pb-3">
            <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Import from Mission Screenshot / OCR</h3>
          </div>
          <div class="space-y-4">
            <p class="text-[11px] text-muted font-sans leading-relaxed">Upload or paste a Star Citizen hauling mission screenshot. Veldex will detect cargo tasks from PRIMARY OBJECTIVES.</p>
            
            <div class="flex flex-col gap-2">
              <input type="file" id="manifest-ocr-file" accept="image/*" class="hidden" />
              <div class="flex flex-col sm:flex-row gap-2">
                <button id="manifest-ocr-upload-btn" type="button" class="veldex-btn-primary flex-1 h-11 text-[11px]">UPLOAD SCREENSHOT</button>
                <div class="flex-1 border border-dashed border-line rounded flex items-center justify-center text-[10px] text-muted font-mono bg-bg/50 h-11">
                  Paste supported: Ctrl+V
                </div>
              </div>
              <p id="manifest-ocr-status" class="text-[10px] text-accent font-mono mt-1">Status: Idle</p>
            </div>

            <div class="flex justify-end">
              <button id="manifest-ocr-toggle-text-btn" type="button" class="text-[10px] text-muted hover:text-white uppercase tracking-widest font-display font-bold">Show OCR text</button>
            </div>

            <div id="manifest-ocr-text-container" class="hidden space-y-2 mt-4">
              <textarea id="manifest-ocr-text" class="veldex-input w-full font-mono text-[11px] leading-relaxed h-32" placeholder="Deliver 0/25 SCU of Aluminum to Port Tressler..."></textarea>
              <button id="manifest-ocr-btn" type="button" class="veldex-btn-secondary w-full h-11">DETECT AGAIN</button>
            </div>

            <div id="manifest-ocr-error" class="hidden text-[10px] text-red-400 font-sans mt-2">
              No valid tasks found. Try cropping the screenshot around PRIMARY OBJECTIVES or edit the OCR text manually.
            </div>
            <div id="manifest-ocr-preview-container" class="hidden space-y-4 mt-4 border-t border-line pt-4">
              <h4 class="text-[12px] font-display font-bold text-white uppercase tracking-[0.1em]">Detected Tasks</h4>
              <div id="manifest-ocr-preview-list" class="space-y-2"></div>
              <div class="flex gap-2">
                <button id="manifest-ocr-add-btn" type="button" class="veldex-btn-primary flex-1 h-11 text-[11px]">ADD DETECTED TASKS</button>
                <button id="manifest-ocr-clear-btn" type="button" class="veldex-btn-ghost flex-1 h-11 text-[11px] text-red-400 border-red-500/30 hover:bg-red-500/10">CLEAR DETECTED</button>
              </div>
            </div>

            <div id="manifest-ocr-debug-container" class="mt-4 border border-line rounded bg-panel p-3 hidden">
              <div class="flex justify-between items-center mb-2 cursor-pointer" id="manifest-ocr-debug-toggle">
                <h4 class="text-[10px] font-display font-bold text-muted uppercase tracking-[0.1em]">Debug Info</h4>
                <span class="text-xs text-muted" id="manifest-ocr-debug-icon">▼</span>
              </div>
              <div id="manifest-ocr-debug-content" class="hidden space-y-3">
                <div>
                  <h5 class="text-[9px] text-accent uppercase tracking-widest mb-1">Normalized Text</h5>
                  <div id="manifest-ocr-debug-norm" class="text-[10px] text-muted font-mono bg-bg p-2 rounded"></div>
                </div>
                <div>
                  <h5 class="text-[9px] text-accent uppercase tracking-widest mb-1">Fragments</h5>
                  <div id="manifest-ocr-debug-frag" class="text-[10px] text-muted font-mono bg-bg p-2 rounded"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Center Panel: Table -->
      <div class="xl:col-span-2 veldex-panel flex flex-col p-6 min-h-0">
        <div class="flex items-center justify-between mb-4 border-b border-line pb-3 shrink-0">
          <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">All Cargo Tasks</h3>
        </div>
        <div class="overflow-x-auto veldex-scroll border border-line rounded-sm flex-1">
          <table class="veldex-table min-w-full">
            <thead>
              <tr>
                <th>ITEM</th>
                <th>QTY</th>
                <th>PICKUP</th>
                <th>DROP-OFF</th>
                <th>STATUS</th>
                <th>ZONE</th>
                <th class="text-right">ACT</th>
              </tr>
            </thead>
            <tbody id="manifest-tasks-body">
              <!-- Injected -->
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Ship Load Plan Container -->
    <div id="manifest-ship-load-plan-container"></div>

    <!-- Bottom Plans -->
    <div class="mb-4 flex items-center justify-between border-b border-line pb-4">
      <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Operational Plans</h3>
      <label class="flex items-center gap-2 cursor-pointer group">
        <input type="checkbox" id="manifest-toggle-delivered" class="hidden" />
        <div class="w-8 h-4 bg-bg border border-line rounded-full relative transition-colors group-hover:border-accent/50" id="manifest-toggle-delivered-track">
          <div class="w-3 h-3 bg-muted rounded-full absolute top-0.5 left-0.5 transition-transform" id="manifest-toggle-delivered-thumb"></div>
        </div>
        <span class="text-[10px] font-display font-bold text-muted uppercase tracking-widest group-hover:text-white transition-colors">Show Delivered Tasks</span>
      </label>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      
      <!-- Pickup Plan -->
      <div class="veldex-panel p-6 flex flex-col min-h-0">
        <div class="flex items-center gap-3 mb-6 border-b border-line pb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent2"><path d="m12 14 4-4"/><path d="M3.3 7 8.7 1.6 15 7.9l-5.4 5.4z"/><path d="m5 16 7 7 10.3-10.3-7-7z"/></svg>
          <h3 class="text-xl font-display font-bold uppercase tracking-widest text-white">Pickup Plan</h3>
        </div>
        <div id="manifest-pickup-plan" class="space-y-4">
          <!-- Injected -->
        </div>
      </div>

      <!-- Delivery Plan -->
      <div class="veldex-panel p-6 flex flex-col min-h-0">
        <div class="flex items-center gap-3 mb-6 border-b border-line pb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-400"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <h3 class="text-xl font-display font-bold uppercase tracking-widest text-white">Delivery Plan</h3>
        </div>
        <div id="manifest-delivery-plan" class="space-y-4">
          <!-- Injected -->
        </div>
      </div>

    </div>
  `;
}

// ----------------------------------------------------
// AUTOCOMPLETE HELPERS
// ----------------------------------------------------
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
  return `${escapeHtml(before)}<span class="text-accent font-bold">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

export function bindManifestEvents() {
  // Pre-load UEX data for autocompletes if not already loaded
  (async () => {
    try {
      await fetchAllUexItems();
      await fetchUexStations();
      await fetchUexCommodities();
    } catch (e) {
      logger.error("Manifest", "Failed to pre-load UEX data", e);
    }
  })();

  const manualForm = $("manifest-manual-form");
  if (manualForm) {
    manualForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const pickup = $("manifest-pickup").value.trim();
      const dropoff = $("manifest-dropoff").value.trim();
      const item = $("manifest-item").value.trim();
      const qty = parseInt($("manifest-qty").value.trim(), 10);

      if (pickup && dropoff && item && qty > 0) {
        addTask({
          id: generateId(),
          missionId: "",
          pickupStation: pickup,
          dropoffStation: dropoff,
          itemName: item,
          quantity: qty,
          unit: "SCU",
          status: "pending",
          cargoZoneId: "",
          uncertain: false,
          pickupStations: []
        });
        manualForm.reset();
        $("manifest-pickup").focus();
      }
    });
  }

  // Bind Autocompletes
  let locSearchTimeout;
  document.addEventListener("input", (e) => {
    const targetId = e.target.id;
    if (targetId === "manifest-pickup" || targetId === "manifest-dropoff" || targetId === "manifest-item") {
      const input = e.target;
      const autocompleteList = $(`${targetId}-autocomplete`);
      if (!autocompleteList) return;

      clearTimeout(locSearchTimeout);
      const val = input.value.trim();

      if (val.length < 2) {
        autocompleteList.classList.add("hidden");
        autocompleteList.innerHTML = "";
        return;
      }

      locSearchTimeout = setTimeout(() => {
        let results = [];
        let isItem = targetId === "manifest-item";

        if (isItem) {
          // Find resources primarily
          results = searchUexItems(val).filter(r => r.isCommodity || (r.category && r.category.toLowerCase() === "commodity"));
          if (results.length === 0) results = searchUexItems(val).slice(0, 10); // fallback
          else results = results.slice(0, 10);
        } else {
          results = searchUexStations(val).slice(0, 10);
        }

        if (results.length === 0) {
          autocompleteList.classList.add("hidden");
          autocompleteList.innerHTML = "";
          return;
        }

        autocompleteList.classList.remove("hidden");
        autocompleteList.innerHTML = results.map(res => {
          const name = isItem ? res.name : res;
          const display = highlightMatch(name, val);
          return `
          <div class="cursor-pointer px-3 py-2 text-[11px] font-sans text-white/90 hover:bg-panel2 transition-colors border-b border-line last:border-0 manifest-autocomplete-item" data-value="${escapeHtml(name)}">
            ${display}
          </div>
          `;
        }).join("");

        autocompleteList.querySelectorAll(".manifest-autocomplete-item").forEach(div => {
          div.addEventListener("click", () => {
            input.value = div.dataset.value;
            autocompleteList.classList.add("hidden");
          });
        });
      }, 150);
    }
  });

  document.addEventListener("click", (e) => {
    ["manifest-pickup", "manifest-dropoff", "manifest-item"].forEach(id => {
      const input = $(id);
      const list = $(`${id}-autocomplete`);
      if (input && list && !input.contains(e.target) && !list.contains(e.target)) {
        list.classList.add("hidden");
      }
    });

    const markBtn = e.target.closest(".manifest-mark-btn");
    if (markBtn) {
      const action = markBtn.dataset.action;
      if (action === "mark-pickup-loaded") {
        markPickupGroupLoaded(markBtn.dataset.pickupStation);
      } else if (action === "mark-dropoff-delivered") {
        markDropoffGroupDelivered(markBtn.dataset.dropoffStation);
      } else if (action === "loaded" || action === "delivered") {
        updateTaskStatus(markBtn.dataset.id, action);
      }
    }

    const applyZoneBtn = e.target.closest(".manifest-apply-zone-btn");
    if (applyZoneBtn) {
      const action = applyZoneBtn.dataset.action;
      if (action === "apply-dropoff-zone") {
        const dropoffStation = applyZoneBtn.dataset.dropoffStation;
        const container = applyZoneBtn.closest('div');
        const select = container.querySelector(`.dropoff-zone-select[data-dropoff-station="${CSS.escape(dropoffStation)}"]`);
        if (select) {
          applyZoneToDropoffGroup(dropoffStation, select.value);
        }
      }
    }
  });

  // OCR bindings
  const ocrUploadBtn = $("manifest-ocr-upload-btn");
  const ocrFileInput = $("manifest-ocr-file");
  const ocrStatus = $("manifest-ocr-status");
  const ocrTextarea = $("manifest-ocr-text");
  const ocrTextContainer = $("manifest-ocr-text-container");
  const ocrToggleTextBtn = $("manifest-ocr-toggle-text-btn");
  const ocrBtn = $("manifest-ocr-btn");
  const ocrPreviewContainer = $("manifest-ocr-preview-container");
  const ocrPreviewList = $("manifest-ocr-preview-list");
  const ocrError = $("manifest-ocr-error");
  const ocrAddBtn = $("manifest-ocr-add-btn");
  const ocrClearBtn = $("manifest-ocr-clear-btn");

  let detectedTasks = [];

  const processOcrImage = async (file) => {
    if (!file) return;
    ocrStatus.classList.remove("hidden");
    ocrStatus.textContent = "Status: Initializing OCR...";
    
    try {
      const text = await runOcrOnImage(file, (progress) => {
        ocrStatus.textContent = `Status: Scanning... ${progress}%`;
      });
      
      ocrStatus.textContent = "Status: OCR Complete. Parsing tasks...";
      ocrTextarea.value = text;
      
      detectTasksFromText();
    } catch (err) {
      logger.error("Manifest", "OCR Error:", err);
      ocrStatus.textContent = "Status: Failed to read image.";
    }
    
    if (ocrFileInput) ocrFileInput.value = "";
  };

  const detectTasksFromText = () => {
    const text = ocrTextarea.value;
    if (!text.trim()) return;
    
    const { tasks, normText, fragments } = parsePrimaryObjectivesText(text);
    detectedTasks = tasks;
    
    const debugNorm = $("manifest-ocr-debug-norm");
    const debugFrag = $("manifest-ocr-debug-frag");
    
    if (debugNorm) debugNorm.textContent = normText;
    if (debugFrag) debugFrag.textContent = JSON.stringify(fragments, null, 2);

    if (detectedTasks.length > 0) {
      ocrStatus.textContent = `Status: OCR complete — ${detectedTasks.length} tasks detected`;
      ocrError.classList.add("hidden");
      ocrPreviewContainer.classList.remove("hidden");
      
      ocrPreviewList.innerHTML = detectedTasks.map(t => {
        let warnings = [];
        if (t.uncertain) {
          warnings.push("Uncertain Pickups");
        }
        if (t.warningMsg) {
          warnings.push(t.warningMsg);
        }
        const warningStr = warnings.length > 0 ? `<span class="bg-red-500/20 text-red-400 px-1 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold">${escapeHtml(warnings.join(", "))}</span>` : '';
        const pickups = t.uncertain && t.pickupStations.length > 0 ? escapeHtml(t.pickupStations.join(", ")) : escapeHtml(t.pickupStation);
        return `
          <div class="bg-bg/50 border border-line rounded p-2 text-[11px] font-sans text-muted space-y-1">
            <div class="flex justify-between items-center text-white font-bold">
              <span>${escapeHtml(String(t.quantity))} SCU ${escapeHtml(t.itemName)}</span>
              ${warningStr}
            </div>
            <div><span class="text-accent/60">From:</span> ${pickups}</div>
            <div><span class="text-accent/60">To:</span> ${escapeHtml(t.dropoffStation)}</div>
          </div>
        `;
      }).join("");
    } else {
      ocrStatus.textContent = "Status: No tasks detected";
      ocrPreviewContainer.classList.add("hidden");
      ocrError.classList.remove("hidden");
    }
  };

  if (ocrUploadBtn && ocrFileInput) {
    ocrUploadBtn.addEventListener("click", () => ocrFileInput.click());
    ocrFileInput.addEventListener("change", (e) => {
      processOcrImage(e.target.files[0]);
    });
  }

  // Paste support scoped to Cargo Manifest
  document.addEventListener("paste", async (e) => {
    const viewManifest = $("view-manifest");
    if (!viewManifest || viewManifest.classList.contains("hidden")) return;
    
    // Ignore if typing in an input/textarea, UNLESS it's the OCR textarea itself
    if ((e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") && e.target.id !== "manifest-ocr-text") return;

    const items = e.clipboardData?.items;
    if (!items) return;

    let imageFile = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        imageFile = items[i].getAsFile();
        break;
      }
    }

    if (imageFile) {
      e.preventDefault();
      await processOcrImage(imageFile);
    }
  });

  if (ocrBtn) {
    ocrBtn.addEventListener("click", detectTasksFromText);
  }

  if (ocrToggleTextBtn && ocrTextContainer) {
    ocrToggleTextBtn.addEventListener("click", () => {
      ocrTextContainer.classList.toggle("hidden");
      ocrToggleTextBtn.textContent = ocrTextContainer.classList.contains("hidden") ? "SHOW OCR TEXT" : "HIDE OCR TEXT";
    });
  }

  const debugToggle = $("manifest-ocr-debug-toggle");
  const debugContent = $("manifest-ocr-debug-content");
  const debugIcon = $("manifest-ocr-debug-icon");
  if (debugToggle && debugContent && debugIcon) {
    debugToggle.addEventListener("click", () => {
      debugContent.classList.toggle("hidden");
      debugIcon.textContent = debugContent.classList.contains("hidden") ? "▼" : "▲";
    });
  }

  if (ocrAddBtn) {
    ocrAddBtn.addEventListener("click", () => {
      if (detectedTasks.length > 0) {
        const data = getManifest();
        data.tasks.push(...detectedTasks);
        saveManifest(data);
        
        detectedTasks = [];
        ocrPreviewContainer.classList.add("hidden");
        ocrTextarea.value = "";
        ocrStatus.textContent = "Status: Idle";
      }
    });
  }

  if (ocrClearBtn) {
    ocrClearBtn.addEventListener("click", () => {
      detectedTasks = [];
      ocrPreviewContainer.classList.add("hidden");
      ocrStatus.textContent = "Status: Idle";
    });
  }

  const clearBtn = $("manifest-clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearManifest);
  }

  const toggleDeliveredInput = $("manifest-toggle-delivered");
  if (toggleDeliveredInput) {
    toggleDeliveredInput.addEventListener("change", (e) => {
      toggleShowDeliveredTasks();
    });
  }
}

function updateManifestUI() {
  const data = getManifest();
  const tasks = data.tasks;

  // Stats
  let totalScu = 0;
  const pickups = new Set();
  const dropoffs = new Set();

  tasks.forEach(t => {
    totalScu += t.quantity;
    if (t.pickupStation !== "Multiple pickups") pickups.add(t.pickupStation);
    if (t.pickupStations) t.pickupStations.forEach(ps => pickups.add(ps));
    dropoffs.add(t.dropoffStation);
  });

  const statsHtml = `
    <div class="bg-panel border border-line rounded-sm p-4 flex flex-col justify-center">
      <p class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest">Total Volume</p>
      <p class="text-2xl font-display font-bold text-accent">${totalScu} <span class="text-sm">SCU</span></p>
    </div>
    <div class="bg-panel border border-line rounded-sm p-4 flex flex-col justify-center">
      <p class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest">Pickups</p>
      <p class="text-2xl font-display font-bold text-white">${pickups.size}</p>
    </div>
    <div class="bg-panel border border-line rounded-sm p-4 flex flex-col justify-center">
      <p class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest">Deliveries</p>
      <p class="text-2xl font-display font-bold text-white">${dropoffs.size}</p>
    </div>
    <div class="bg-panel border border-line rounded-sm p-4 flex flex-col justify-center">
      <p class="text-[10px] font-display font-semibold text-muted uppercase tracking-widest">Tasks</p>
      <p class="text-2xl font-display font-bold text-white">${tasks.length}</p>
    </div>
  `;
  const statsContainer = $("manifest-stats-container");
  if (statsContainer) statsContainer.innerHTML = statsHtml;

  // Table
  const tbody = $("manifest-tasks-body");
  if (tbody) {
    if (tasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-muted font-display uppercase tracking-widest opacity-50">No cargo tasks recorded</td></tr>`;
    } else {
      tbody.innerHTML = tasks.map(t => {
        const warning = t.uncertain ? `<span class="text-red-400 font-bold ml-1" title="Multiple pickups detected for this deliver. Quantity not split.">(!)</span>` : '';
        return `
        <tr>
          <td class="font-bold text-white">${t.itemName}</td>
          <td class="font-mono text-accent">${t.quantity} <span class="text-[10px]">SCU</span></td>
          <td class="text-muted/80">${t.pickupStation}${warning}</td>
          <td class="text-muted/80">${t.dropoffStation}</td>
          <td>
             <span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest ${t.status === 'pending' ? 'bg-orange-500/10 border border-orange-500/20 text-orange-400' : (t.status === 'loaded' ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400' : 'bg-green-500/10 border border-green-500/20 text-green-400')}">${t.status}</span>
          </td>
          <td>
             <span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest ${t.cargoZoneId ? 'bg-accent/10 border border-accent/20 text-accent' : 'bg-bg border border-line text-muted'}">${escapeHtml(getZoneNameById(t.cargoZoneId))}</span>
          </td>
          <td class="text-right">
            <button class="manifest-del-btn text-red-500 hover:text-red-400 p-1" data-id="${t.id}" title="Delete Task">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          </td>
        </tr>
      `}).join("");

      // Bind delete
      document.querySelectorAll(".manifest-del-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const id = e.currentTarget.dataset.id;
          deleteTask(id);
        });
      });
    }
  }

  // Pickup Plan
  const pickupPlanContainer = $("manifest-pickup-plan");
  if (pickupPlanContainer) {
    const pGroups = {};
    tasks.forEach(t => {
      // If multiple pickups, we just list it under "Multiple pickups" for now, or we could duplicate it across the locations.
      // For simplicity, keep it grouped exactly by the pickupStation field.
      const p = t.pickupStation;
      if (!pGroups[p]) pGroups[p] = { totalScu: 0, loadedScu: 0, deliveredScu: 0, items: [] };
      pGroups[p].totalScu += t.quantity;
      if (t.status === 'loaded') pGroups[p].loadedScu += t.quantity;
      if (t.status === 'delivered') pGroups[p].deliveredScu += t.quantity;
      pGroups[p].items.push(t);
    });

    if (Object.keys(pGroups).length === 0) {
      pickupPlanContainer.innerHTML = `<p class="text-sm text-muted">No pickups planned.</p>`;
    } else {
      const htmlFragments = Object.entries(pGroups).map(([station, group]) => {
        const visibleItems = data.showDeliveredTasks ? group.items : group.items.filter(t => t.status !== 'delivered');
        if (visibleItems.length === 0) return '';
        
        const hasPending = group.items.some(t => t.status === "pending");
        const bulkLoadedBtn = hasPending 
          ? `<button class="manifest-mark-btn whitespace-nowrap bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest transition-colors ml-3" data-action="mark-pickup-loaded" data-pickup-station="${escapeHtml(station)}">Mark all loaded</button>`
          : '';
        
        return `
        <div class="bg-panel2/40 border border-line rounded-sm p-4 hover:border-accent2/40 transition-colors">
          <div class="flex flex-col xl:flex-row xl:items-center justify-between mb-3 border-b border-line/50 pb-2 gap-2">
            <div class="flex items-center">
              <h4 class="text-sm font-display font-bold text-accent2 uppercase tracking-[0.1em]">${station}</h4>
              ${bulkLoadedBtn}
            </div>
            <span class="text-[10px] font-mono text-muted bg-bg px-2 py-0.5 rounded border border-line w-fit">${group.totalScu} SCU total &middot; ${group.loadedScu} loaded &middot; ${group.deliveredScu} delivered</span>
          </div>
          <ul class="space-y-2">
            ${visibleItems.map(t => {
              const zoneOptions = `<option value="">No zone</option>` + activeZones.map(z => `<option value="${z.id}" ${t.cargoZoneId === z.id ? 'selected' : ''}>${escapeHtml(z.zone_name)}</option>`).join('');
              const zoneSelector = `<select class="manifest-zone-select bg-bg border border-line rounded text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 cursor-pointer outline-none text-white/80 w-full h-[22px]" data-id="${t.id}">${zoneOptions}</select>`;
                
              return `
              <li class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[12px] font-sans">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="w-1.5 h-1.5 bg-accent2/50 rounded-full shrink-0"></span>
                  <span class="text-white whitespace-nowrap">${t.quantity} SCU ${t.itemName}</span>
                  <span class="text-muted/60 flex items-center gap-1 ml-1 truncate">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="m9 18 6-6-6-6"/></svg>
                    <span class="truncate">${t.dropoffStation}</span>
                  </span>
                </div>
                <div class="flex items-center justify-end gap-2 shrink-0 min-w-max">
                  <div class="w-24 shrink-0">${zoneSelector}</div>
                  ${t.status === 'pending' 
                    ? `<button class="manifest-mark-btn whitespace-nowrap w-[100px] h-[22px] flex items-center justify-center bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-2 rounded text-[10px] font-bold uppercase tracking-widest transition-colors shrink-0" data-id="${t.id}" data-action="loaded">Mark Loaded</button>`
                    : `<span class="whitespace-nowrap w-[100px] h-[22px] flex items-center justify-center px-2 rounded text-[10px] uppercase font-bold tracking-widest shrink-0 ${t.status === 'loaded' ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-400' : 'bg-green-500/10 border border-green-500/20 text-green-400'}">${t.status}</span>`
                  }
                </div>
              </li>
              `;
            }).join('')}
          </ul>
        </div>
        `;
      });
      
      const combinedHtml = htmlFragments.filter(Boolean).join('');
      pickupPlanContainer.innerHTML = combinedHtml || `<p class="text-[11px] text-muted italic">All active tasks hidden.</p>`;
    }
  }

  // Delivery Plan
  const deliveryPlanContainer = $("manifest-delivery-plan");
  if (deliveryPlanContainer) {
    const dGroups = {};
    tasks.forEach(t => {
      const d = t.dropoffStation;
      if (!dGroups[d]) dGroups[d] = { totalScu: 0, loadedScu: 0, deliveredScu: 0, items: [] };
      dGroups[d].totalScu += t.quantity;
      if (t.status === 'loaded') dGroups[d].loadedScu += t.quantity;
      if (t.status === 'delivered') dGroups[d].deliveredScu += t.quantity;
      dGroups[d].items.push(t);
    });

    if (Object.keys(dGroups).length === 0) {
      deliveryPlanContainer.innerHTML = `<p class="text-sm text-muted">No deliveries planned.</p>`;
    } else {
      const htmlFragments = Object.entries(dGroups).map(([station, group]) => {
        const visibleItems = data.showDeliveredTasks ? group.items : group.items.filter(t => t.status !== 'delivered');
        if (visibleItems.length === 0) return '';
        
        const hasLoaded = group.items.some(t => t.status === "loaded");
        const bulkDeliveredBtn = hasLoaded 
          ? `<button class="manifest-mark-btn whitespace-nowrap bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest transition-colors ml-3" data-action="mark-dropoff-delivered" data-dropoff-station="${escapeHtml(station)}">Mark all delivered</button>`
          : '';

        // Add group-level zone summary
        const uniqueZones = new Set();
        group.items.forEach(t => {
          if (t.cargoZoneId) {
            uniqueZones.add(t.cargoZoneId);
          } else {
            uniqueZones.add('none');
          }
        });
        
        let groupZoneContent = '';
        if (activeZones && activeZones.length > 0) {
          const isMixed = uniqueZones.size > 1;
          const sharedZone = isMixed ? 'mixed' : Array.from(uniqueZones)[0];
          
          let optionsHtml = '';
          if (isMixed) {
            optionsHtml += `<option value="mixed" disabled selected>Mixed zones</option>`;
          }
          optionsHtml += `<option value="" ${sharedZone === 'none' ? 'selected' : ''}>No zone</option>`;
          optionsHtml += activeZones.map(z => `<option value="${z.id}" ${sharedZone === z.id ? 'selected' : ''}>${escapeHtml(z.zone_name)}</option>`).join('');
          
          groupZoneContent = `
            <div class="flex items-center gap-2 ml-3">
              <select class="dropoff-zone-select bg-bg border border-line rounded text-[9px] uppercase font-bold tracking-widest px-1.5 py-0.5 cursor-pointer outline-none text-white/80 h-[22px]" data-dropoff-station="${escapeHtml(station)}">
                ${optionsHtml}
              </select>
              <button class="manifest-apply-zone-btn bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest transition-colors whitespace-nowrap" data-action="apply-dropoff-zone" data-dropoff-station="${escapeHtml(station)}">Apply Zone</button>
            </div>
          `;
        } else {
          let groupZoneBadge = '';
          if (uniqueZones.size === 1) {
            const zoneVal = Array.from(uniqueZones)[0];
            if (zoneVal === 'none') {
              groupZoneBadge = `<span class="bg-bg border border-line text-muted px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest ml-3">NO ZONE</span>`;
            } else {
              const zName = getZoneNameById(zoneVal);
              groupZoneBadge = `<span class="bg-accent/10 border border-accent/20 text-accent px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest ml-3">${escapeHtml(zName)}</span>`;
            }
          } else if (uniqueZones.size > 1) {
            groupZoneBadge = `<span class="bg-bg border border-line text-muted px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-widest ml-3">MULTI ZONE</span>`;
          }
          groupZoneContent = groupZoneBadge;
        }
        
        return `
        <div class="bg-panel2/40 border border-line rounded-sm p-4 hover:border-green-400/40 transition-colors">
          <div class="flex flex-col xl:flex-row xl:items-center justify-between mb-3 border-b border-line/50 pb-2 gap-2">
            <div class="flex flex-wrap items-center gap-y-2">
              <h4 class="text-sm font-display font-bold text-green-400 uppercase tracking-[0.1em]">${station}</h4>
              ${groupZoneContent}
              ${bulkDeliveredBtn}
            </div>
            <span class="text-[10px] font-mono text-muted bg-bg px-2 py-0.5 rounded border border-line w-fit">${group.totalScu} SCU total &middot; ${group.loadedScu} loaded &middot; ${group.deliveredScu} delivered</span>
          </div>
          <ul class="space-y-2">
            ${visibleItems.map(t => {
              const zoneName = getZoneNameById(t.cargoZoneId);
              const zoneBadge = t.cargoZoneId 
                ? `<span class="w-full text-center bg-accent/10 border border-accent/20 text-accent px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-widest block">${escapeHtml(zoneName)}</span>`
                : `<span class="w-full text-center bg-bg border border-line text-muted px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-widest block">No zone</span>`;
                
              return `
              <li class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[12px] font-sans">
                <div class="flex items-center gap-2 flex-1 min-w-0">
                  <span class="w-1.5 h-1.5 bg-green-400/50 rounded-full shrink-0"></span>
                  <span class="text-white whitespace-nowrap">${t.quantity} SCU ${t.itemName}</span>
                  <span class="text-muted/60 flex items-center gap-1 ml-1 truncate">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="m9 18 6-6-6-6"/></svg>
                    <span class="truncate">${t.pickupStation}</span>
                  </span>
                </div>
                <div class="flex items-center justify-end gap-2 shrink-0 min-w-max">
                  <div class="w-[120px] shrink-0 flex justify-end">${zoneBadge}</div>
                  ${t.status === 'pending'
                    ? `<span class="whitespace-nowrap w-[150px] px-4 h-[22px] flex items-center justify-center py-0.5 bg-bg border border-line rounded text-[10px] uppercase text-muted font-bold tracking-widest">Not Loaded</span>`
                    : t.status === 'loaded'
                      ? `<button class="manifest-mark-btn whitespace-nowrap w-[150px] px-4 h-[22px] flex items-center justify-center bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest transition-colors" data-id="${t.id}" data-action="delivered">Mark Delivered</button>`
                      : `<span class="whitespace-nowrap w-[150px] px-4 h-[22px] flex items-center justify-center py-0.5 bg-green-500/10 border border-green-500/20 rounded text-[10px] uppercase text-green-400 font-bold tracking-widest">Delivered</span>`
                  }
                </div>
              </li>
              `;
            }).join('')}
          </ul>
        </div>
        `;
      });
      
      const combinedHtml = htmlFragments.filter(Boolean).join('');
      deliveryPlanContainer.innerHTML = combinedHtml || `<p class="text-[11px] text-muted italic">All active tasks hidden.</p>`;
    }
  }

  // Ship Load Plan
  const loadPlanContainer = $("manifest-ship-load-plan-container");
  if (loadPlanContainer) {
    const gridOptions = availableGrids.map(g => `<option value="${g.id}" ${data.selectedCargoGridId === g.id ? 'selected' : ''}>${escapeHtml(g.ship_name)} — ${escapeHtml(g.grid_name)}</option>`).join("");
    
    let zonesHtml = "";
    let headerSummaryHtml = "";
    
    if (data.selectedCargoGridId) {
      if (activeZones.length === 0) {
        zonesHtml = `<p class="text-[11px] text-muted italic">No zones defined in this grid.</p>`;
      } else {
        const totalCapacityScu = activeZones.reduce((sum, z) => sum + parseFloat(z.capacity_scu), 0);
        const gridZoneIds = new Set(activeZones.map(z => z.id));
        const totalLoadedScu = tasks.filter(t => gridZoneIds.has(t.cargoZoneId)).reduce((sum, t) => sum + t.quantity, 0);
        
        const pct = totalCapacityScu > 0 ? Math.round((totalLoadedScu / totalCapacityScu) * 100) : 0;
        const isGridOver = totalLoadedScu > totalCapacityScu;
        
        headerSummaryHtml = `
          <div class="mt-2 md:mt-0 md:ml-6 md:pl-6 md:border-l md:border-line">
            <div class="text-[10px] font-display font-bold text-muted uppercase tracking-widest mb-0.5">Capacity Usage</div>
            <div class="text-sm font-mono font-bold ${isGridOver ? 'text-red-400' : 'text-accent'}">${totalLoadedScu} / ${totalCapacityScu} SCU &middot; ${isGridOver ? 'Over capacity' : pct + '% used'}</div>
          </div>
        `;
        
        zonesHtml = activeZones.map(z => {
          const tasksInZone = tasks.filter(t => t.cargoZoneId === z.id);
          const usedScu = tasksInZone.reduce((sum, t) => sum + t.quantity, 0);
          const capacity = parseFloat(z.capacity_scu);
          const isOver = usedScu > capacity;
          
          return `
            <div class="bg-panel2/40 border ${isOver ? 'border-red-500/50' : 'border-line/50'} rounded-sm p-3">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-[12px] font-display font-bold ${isOver ? 'text-red-400' : 'text-white'} uppercase tracking-widest">${escapeHtml(z.zone_name)}</h4>
                <span class="text-[10px] font-mono font-bold ${isOver ? 'text-red-400 bg-red-500/10 border-red-500/30' : 'text-accent bg-accent/10 border-accent/20'} px-2 py-0.5 rounded border">${usedScu} / ${capacity} SCU</span>
              </div>
              ${tasksInZone.length === 0 
                ? `<p class="text-[10px] text-muted italic">Empty</p>` 
                : `<ul class="space-y-1.5 mt-3">
                    ${tasksInZone.map(t => `
                      <li class="flex items-center justify-between gap-2 text-[11px] font-sans text-muted">
                        <div class="flex items-center gap-1.5 min-w-0">
                          <span class="w-1 h-1 bg-muted/50 rounded-full shrink-0"></span>
                          <span class="text-white truncate" title="${t.quantity} SCU ${t.itemName}">${t.quantity} SCU ${t.itemName}</span>
                        </div>
                        <span class="opacity-60 flex items-center gap-1 shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg> ${t.dropoffStation}</span>
                      </li>
                    `).join('')}
                   </ul>`
              }
            </div>
          `;
        }).join("");
      }
    } else {
      zonesHtml = `<p class="text-[11px] text-muted italic text-center py-4 md:col-span-2 xl:col-span-4">Select a grid to view load plan.</p>`;
    }

    loadPlanContainer.innerHTML = `
      <div class="veldex-panel p-6 mb-6">
        <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-6 border-b border-line pb-4">
          <div class="flex flex-col md:flex-row md:items-center">
            <h3 class="text-xl font-display font-bold uppercase tracking-widest text-white flex items-center gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-accent"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
              Ship Load Plan
            </h3>
            ${headerSummaryHtml}
          </div>
          <div class="flex items-center gap-3 w-full xl:w-auto">
            <label class="text-[10px] font-display font-bold text-muted uppercase tracking-[0.1em] whitespace-nowrap">Selected Grid:</label>
            <select id="manifest-grid-select" class="veldex-select h-9 w-full md:w-64 text-[11px] font-display font-bold tracking-widest uppercase py-0 outline-none">
              <option value="">[NO GRID SELECTED]</option>
              ${gridOptions}
            </select>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          ${zonesHtml}
        </div>
      </div>
    `;

    const gridSelect = $("manifest-grid-select");
    if (gridSelect) {
      gridSelect.addEventListener("change", (e) => {
        updateSelectedGrid(e.currentTarget.value);
      });
    }
  }

  // Bind zone selects
  document.querySelectorAll(".manifest-zone-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      updateTaskZone(e.currentTarget.dataset.id, e.currentTarget.value);
    });
  });

  // Bind action buttons are now handled by event delegation on document

  // Sync toggle delivered tasks visual state
  const toggleDeliveredInput = $("manifest-toggle-delivered");
  const track = $("manifest-toggle-delivered-track");
  const thumb = $("manifest-toggle-delivered-thumb");
  if (toggleDeliveredInput && track && thumb) {
    toggleDeliveredInput.checked = data.showDeliveredTasks;
    
    if (data.showDeliveredTasks) {
      track.classList.remove("bg-bg", "border-line");
      track.classList.add("bg-accent", "border-accent");
      thumb.classList.remove("left-0.5", "bg-muted");
      thumb.classList.add("translate-x-3.5", "bg-white");
    } else {
      track.classList.add("bg-bg", "border-line");
      track.classList.remove("bg-accent", "border-accent");
      thumb.classList.add("left-0.5", "bg-muted");
      thumb.classList.remove("translate-x-3.5", "bg-white");
    }
  }
}

// Initial UI sync
window.addEventListener("view-changed", (e) => {
  if (e.detail.viewId === "view-manifest") {
    refreshCargoGridsForManifest();
  }
});

export async function refreshCargoGridsForManifest() {
  availableGrids = await loadCargoGrids();
  const manifest = getManifest();
  if (manifest.selectedCargoGridId) {
    activeZones = await loadCargoGridZones(manifest.selectedCargoGridId);
  } else {
    activeZones = [];
  }
  updateManifestUI();
}
