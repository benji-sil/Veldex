const VELDEX_VERSION = "v0.1.1";

export function updateSidebarVersions() {
  const container = document.getElementById("sidebar-versions-content");
  if (!container) return;

  const versions = window.VELDEX_GAME_VERSIONS || { live: "...", ptu: "...", status: "none" };
  const status = versions.status;

  let ledClass = "bg-accent shadow-[0_0_6px_#00E0FF]"; // Fallback Cyan
  if (status === "ok") ledClass = "bg-green-400 shadow-[0_0_6px_#22c55e]";
  if (status === "error") ledClass = "bg-red-500 shadow-[0_0_6px_#ef4444]";

  container.innerHTML = `
    <div class="flex items-center justify-between text-[12px] font-sans">
      <div class="flex items-center gap-2">
        <div class="w-1.5 h-1.5 rounded-full ${ledClass}"></div>
        <span class="text-muted/60 uppercase tracking-wider">LIVE</span>
      </div>
      <span class="text-accent font-bold tabular-nums">${versions.live}</span>
    </div>
    <div class="flex items-center justify-between text-[12px] font-sans">
      <div class="flex items-center gap-2">
        <div class="w-1.5 h-1.5 rounded-full ${ledClass}"></div>
        <span class="text-muted/60 uppercase tracking-wider">PTU</span>
      </div>
      <span class="text-accent font-bold tabular-nums">${versions.ptu}</span>
    </div>
    <div class="flex items-center justify-between text-[12px] font-sans pt-1 border-t border-line/30">
      <span class="text-muted/60 uppercase tracking-wider pl-3.5">VELDEX</span>
      <span class="text-accent font-bold tabular-nums">${VELDEX_VERSION}</span>
    </div>
  `;
}

export function renderSidebar() {
  const container = document.getElementById("sidebar-container");
  if (!container) return;

  container.innerHTML = `
    <div class="flex flex-col h-full">
      <!-- Top Branding -->
      <div class="mb-10 px-4 pt-6">
        <div class="flex items-center gap-3">
          <div class="flex flex-col">
            <h1 class="text-2xl font-display font-black text-white tracking-[0.1em] leading-none">VELDEX</h1>
            <p class="text-[11px] font-display font-bold text-accent/60 uppercase tracking-[0.3em] mt-1.5">Industrial Intelligence</p>
          </div>
        </div>
      </div>

      <!-- Navigation (Scrollable if needed) -->
      <nav class="space-y-2 flex-1 px-2 veldex-scroll overflow-y-auto">
        <button data-view="view-dashboard" class="nav-btn group w-full flex items-center gap-4 px-4 py-3.5 rounded-sm font-display text-[13px] font-bold uppercase tracking-[0.15em] text-muted hover:text-white transition-all relative overflow-hidden">
          <div class="absolute left-0 top-0 w-1 h-0 bg-accent transition-all group-hover:h-full active-indicator"></div>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-40 group-hover:opacity-100 transition-opacity"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
          <span>Dashboard</span>
        </button>
        
        <button data-view="view-inventory" class="nav-btn group w-full flex items-center gap-4 px-4 py-3.5 rounded-sm font-display text-[13px] font-bold uppercase tracking-[0.15em] text-muted hover:text-white transition-all relative overflow-hidden">
          <div class="absolute left-0 top-0 w-1 h-0 bg-accent transition-all group-hover:h-full active-indicator"></div>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-40 group-hover:opacity-100 transition-opacity"><path d="M12 2v20"/><path d="m19 9-7 7-7-7"/></svg>
          <span>Inventory</span>
        </button>

        <button data-view="view-corporation" class="nav-btn group w-full flex items-center gap-4 px-4 py-3.5 rounded-sm font-display text-[13px] font-bold uppercase tracking-[0.15em] text-muted hover:text-white transition-all relative overflow-hidden">
          <div class="absolute left-0 top-0 w-1 h-0 bg-accent transition-all group-hover:h-full active-indicator"></div>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-40 group-hover:opacity-100 transition-opacity"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span>Corporation</span>
        </button>

        <button data-view="view-ocr" class="nav-btn group w-full flex items-center gap-4 px-4 py-3.5 rounded-sm font-display text-[13px] font-bold uppercase tracking-[0.15em] text-muted hover:text-white transition-all relative overflow-hidden">
          <div class="absolute left-0 top-0 w-1 h-0 bg-accent transition-all group-hover:h-full active-indicator"></div>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-40 group-hover:opacity-100 transition-opacity"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/><path d="M12 7v10"/></svg>
          <span>OCR Scanner</span>
        </button>

        <button class="group w-full flex items-center gap-4 px-4 py-3.5 rounded-sm font-display text-[13px] font-bold uppercase tracking-[0.15em] text-muted/30 cursor-not-allowed">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-20"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.72V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          <span>Paramètres</span>
        </button>
      </nav>

      <!-- Versions & Branding -->
      <div class="mt-auto pt-6 px-2 space-y-4">
        <!-- SYSTEM VERSIONS BLOCK -->
        <div class="px-4 py-3 rounded-sm bg-panel2/40 border border-line space-y-2">
          <p class="text-[10px] font-display font-black text-muted uppercase tracking-[0.2em] mb-1">System Versions</p>
          <div id="sidebar-versions-content" class="space-y-2">
             <!-- Injected by updateSidebarVersions -->
          </div>
        </div>

        <div class="relative p-4 rounded-sm bg-accent/5 border border-accent/10 overflow-hidden group">
          <div class="absolute -right-4 -bottom-4 w-16 h-16 bg-accent/10 rounded-full blur-2xl transition-all group-hover:scale-150 group-hover:bg-accent/20"></div>
          <div class="flex items-center justify-between mb-1">
            <p class="text-[11px] font-display font-black text-accent uppercase tracking-[0.4em]">Sector 01</p>
            <div class="w-1.5 h-1.5 bg-accent rounded-full animate-veldex-pulse"></div>
          </div>
          <p class="text-[12px] font-sans font-medium text-white/40">Verified Operator</p>
        </div>

        <button id="logout-btn" class="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-sm border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-400 font-display uppercase tracking-[0.2em] text-[12px] font-black transition-all group">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover:-translate-x-1 transition-transform"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>System Logoff</span>
        </button>
      </div>
    </div>
  `;

  // Initial update
  updateSidebarVersions();
}
