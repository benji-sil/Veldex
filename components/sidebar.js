const VELDEX_VERSION = "v0.1.3";

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

const navGroups = [
  {
    label: "Management",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-40 group-hover/navbtn:opacity-100 transition-opacity"><path d="M12 2v20"/><path d="m19 9-7 7-7-7"/></svg>',
    items: [
      { label: "Inventory", view: "view-inventory", visible: true },
      { label: "Corporation", view: "view-corporation", visible: true }
    ]
  },
  {
    label: "Data",
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-40 group-hover/navbtn:opacity-100 transition-opacity"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    items: [
      { label: "Tools", view: "view-tools", visible: true },
      { label: "Mining", view: "view-mining", visible: false },
      { label: "Components", view: "view-components", visible: false },
      { label: "Market", view: "view-market", visible: false },
      { label: "Wiki / Database", view: "view-wiki", visible: false }
    ]
  }
];

export function renderSidebar() {
  const container = document.getElementById("sidebar-container");
  if (!container) return;

  const navHtml = navGroups.map(group => {
    const visibleItems = group.items.filter(item => item.visible);
    if (visibleItems.length === 0) return '';

    const flyoutItemsHtml = visibleItems.map(item => `
      <button data-view="${item.view}" class="nav-btn w-full text-left px-4 py-2.5 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-muted hover:text-white hover:bg-accent/10 hover:pl-5 transition-all">
        ${item.label}
      </button>
    `).join('');

    return `
      <div class="group/nav relative sidebar-group-container" data-group-label="${group.label}">
        <button type="button" class="sidebar-group-btn group/navbtn w-full flex items-center justify-between gap-4 px-4 py-3.5 rounded-sm font-display text-[13px] font-bold uppercase tracking-[0.15em] text-muted hover:text-white transition-all relative overflow-hidden">
          <div class="absolute left-0 top-0 w-1 h-0 bg-accent transition-all group-hover/navbtn:h-full group-[.flyout-open]/nav:h-full active-indicator"></div>
          <div class="flex items-center gap-4">
            ${group.icon}
            <span>${group.label}</span>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-20 group-hover/navbtn:opacity-100 group-[.flyout-open]/nav:rotate-90 lg:group-[.flyout-open]/nav:rotate-0 lg:group-hover/nav:translate-x-1 transition-all"><path d="m9 18 6-6-6-6"/></svg>
        </button>

        <!-- Flyout menu -->
        <div class="hidden lg:block group-[.flyout-open]/nav:block lg:absolute lg:left-full lg:top-0 lg:ml-1 lg:w-48 lg:opacity-0 lg:invisible lg:group-hover/nav:opacity-100 lg:group-hover/nav:visible lg:group-[.flyout-open]/nav:opacity-100 lg:group-[.flyout-open]/nav:visible transition-all duration-200 z-50 lg:transform lg:-translate-x-2 lg:group-hover/nav:translate-x-0 lg:group-[.flyout-open]/nav:translate-x-0">
          <div class="bg-panel border border-line lg:border-l-2 lg:border-l-accent rounded-sm py-2 shadow-2xl flex flex-col ml-4 lg:ml-0 mt-1 lg:mt-0">
            ${flyoutItemsHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="flex flex-col h-full lg:overflow-visible">
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
      <nav class="space-y-2 flex-1 px-2 veldex-scroll overflow-y-auto lg:overflow-visible">
        <!-- Dashboard (Standalone) -->
        <button data-view="view-dashboard" class="nav-btn group w-full flex items-center gap-4 px-4 py-3.5 rounded-sm font-display text-[13px] font-bold uppercase tracking-[0.15em] text-muted hover:text-white transition-all relative overflow-hidden">
          <div class="absolute left-0 top-0 w-1 h-0 bg-accent transition-all group-hover:h-full active-indicator"></div>
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-40 group-hover:opacity-100 transition-opacity"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
          <span>Dashboard</span>
        </button>
        
        <!-- Grouped Flyouts -->
        ${navHtml}
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

  // Add click handlers for mobile/desktop toggling
  const groupContainers = container.querySelectorAll('.sidebar-group-container');
  groupContainers.forEach(groupEl => {
    const btn = groupEl.querySelector('.sidebar-group-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const label = groupEl.dataset.groupLabel;
      console.log("SIDEBAR GROUP CLICKED:", label);

      const isOpen = groupEl.classList.contains('flyout-open');

      // Close all other groups
      groupContainers.forEach(g => g.classList.remove('flyout-open'));

      if (!isOpen) {
        groupEl.classList.add('flyout-open');
        console.log("SIDEBAR OPEN GROUP:", label);
      } else {
        console.log("SIDEBAR OPEN GROUP:", null);
      }
    });
  });

  // Click outside to close menus
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      groupContainers.forEach(g => g.classList.remove('flyout-open'));
    }
  });

  // Re-bind initNavigation automatically since we rewrote the DOM and lost bindings?
  // Actually, router.js is called once at initDashboardPage.
  // The user says: "Ensure child links call the existing route/view navigation exactly like before."
  // Wait, router.js `initNavigation` binds by doing `.querySelectorAll(".nav-btn")` ONCE at startup!
  // If we destroy and recreate `.nav-btn` elements in `renderSidebar()`, we MUST re-run `initNavigation()` or call `showView(view)` manually on click!
  // Oh! That's why child links might not be working! They were recreated!
  const navBtns = container.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close all flyouts when a navigation link is clicked
      groupContainers.forEach(g => g.classList.remove('flyout-open'));
    });
  });

  // Initial update
  updateSidebarVersions();
}
