import { $ } from "../../scripts/utils.js";

/**
 * VELDEX - DATA / TOOLS MODULE
 * Renders the System Tools page layout and bindings.
 */
export function renderToolsPage() {
  const container = $("view-tools");
  if (!container) return;

  const createLinkCard = (title, desc, url) => `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-panel2/40 border border-line rounded-sm hover:border-accent/40 transition-all group gap-3">
      <div class="flex-1">
        <p class="text-[13px] font-display font-bold text-white uppercase tracking-[0.1em] group-hover:text-accent transition-colors">${title}</p>
        <p class="text-[11px] font-sans text-muted mt-1 leading-tight">${desc}</p>
      </div>
      <a href="${url}" target="_blank" rel="noopener noreferrer" class="veldex-btn veldex-btn-secondary !px-3 !py-2 !text-[10px] shrink-0 hover:!text-accent hover:!border-accent/40 hover:!bg-accent/5 w-full sm:w-auto flex items-center justify-center">
        Open
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-1 opacity-60"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
      </a>
    </div>
  `;

  container.innerHTML = `
    <div class="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-4xl font-display font-bold text-white uppercase tracking-widest flex items-center gap-4">
          <span class="w-3 h-10 bg-accent"></span>
          System Tools
        </h2>
        <p class="text-[12px] font-display font-bold text-muted uppercase tracking-widest mt-2 ml-7">External Data & Resources</p>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      
      <!-- Official Access -->
      <div class="veldex-panel p-6 flex flex-col min-h-0">
        <div class="flex items-center justify-between mb-4 border-b border-line pb-3 shrink-0">
          <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Official Access</h3>
        </div>
        <div class="space-y-3">
          ${createLinkCard("RSI Download", "Official game client launcher and updates.", "https://robertsspaceindustries.com/en/download")}
          ${createLinkCard("CCU Game", "Fleet management and CCU chain planning.", "https://ccugame.app/your-items/fleet")}
          ${createLinkCard("Hangar Link", "Advanced hangar organization and fleet viewer.", "https://hangar.link/")}
        </div>
      </div>

      <!-- Market & Resources -->
      <div class="veldex-panel p-6 flex flex-col min-h-0">
        <div class="flex items-center justify-between mb-4 border-b border-line pb-3 shrink-0">
          <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Market & Resources</h3>
        </div>
        <div class="space-y-3">
          ${createLinkCard("Regolith", "Real-time mining & salvage calculator.", "https://regolith.rocks/")}
          ${createLinkCard("UEX Corp", "Intergalactic economy, trade, and logistics data.", "https://uexcorp.space/")}
          ${createLinkCard("SC Trade Tools", "Trade routes, commodities, and mining locations.", "https://sc-trade.tools/home")}
        </div>
      </div>

      <!-- Ships & Components -->
      <div class="veldex-panel p-6 flex flex-col min-h-0">
        <div class="flex items-center justify-between mb-4 border-b border-line pb-3 shrink-0">
          <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Ships & Components</h3>
        </div>
        <div class="space-y-3">
          ${createLinkCard("Erkul", "Comprehensive ship loadout and DPS calculator.", "https://www.erkul.games/live/calculator")}
          ${createLinkCard("SC Cargo", "Ship cargo grid and capacity viewer.", "https://sc-cargo.space/#/v1/viewer")}
          ${createLinkCard("SC Blueprints", "Detailed ship schematics and blueprints.", "https://scblueprints.app/")}
        </div>
      </div>

      <!-- Knowledge Base -->
      <div class="veldex-panel p-6 flex flex-col min-h-0">
        <div class="flex items-center justify-between mb-4 border-b border-line pb-3 shrink-0">
          <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Knowledge Base</h3>
        </div>
        <div class="space-y-3">
          ${createLinkCard("Star Citizen Tools", "The largest community-driven Star Citizen wiki.", "https://starcitizen.tools/")}
          ${createLinkCard("SCMDB", "Star Citizen Master Database for game files.", "https://scmdb.net/")}
          ${createLinkCard("SP Viewer", "System Performance Viewer for telemetry and stats.", "https://www.spviewer.eu/")}
        </div>
      </div>

      <!-- Technical Data -->
      <div class="veldex-panel p-6 flex flex-col min-h-0">
        <div class="flex items-center justify-between mb-4 border-b border-line pb-3 shrink-0">
          <h3 class="text-[12px] font-display font-black text-white uppercase tracking-[0.2em]">Technical Data</h3>
        </div>
        <div class="space-y-3">
          ${createLinkCard("Kraken's GitHub", "Repository for game localization and string data.", "https://github.com/MrKraken/StarStrings")}
        </div>
      </div>

    </div>
  `;
}
