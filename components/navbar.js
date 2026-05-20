export function renderMobileNav() {
  const container = document.getElementById("mobile-nav-container");
  if (!container) return;

  container.innerHTML = `
    <button data-view="view-dashboard" class="nav-btn px-4 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors shrink-0">Dashboard</button>
    <button data-view="view-inventory" class="nav-btn px-4 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors shrink-0">Inventory</button>
    <button data-view="view-corporation" class="nav-btn px-4 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors shrink-0">Corporation</button>
    <button data-view="view-blueprints" class="nav-btn px-4 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors shrink-0">Blueprints</button>
    <button data-view="view-tools" class="nav-btn px-4 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors shrink-0">Tools</button>
    <button data-view="view-manifest" class="nav-btn px-4 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors shrink-0">Manifest</button>
    <button data-view="view-cargo-grids" class="nav-btn px-4 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors shrink-0">Cargo Grids</button>
  `;
}
