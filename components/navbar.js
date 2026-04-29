export function renderMobileNav() {
  const container = document.getElementById("mobile-nav-container");
  if (!container) return;

  container.innerHTML = `
    <button data-view="view-dashboard" class="nav-btn px-3 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors">Dashboard</button>
    <button data-view="view-inventory" class="nav-btn px-3 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors">Inventory</button>
    <button data-view="view-corporation" class="nav-btn px-3 py-2 rounded-sm font-display text-sm font-semibold uppercase tracking-wide text-muted hover:text-white transition-colors">Corporation</button>
  `;
}
