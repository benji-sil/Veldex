export function renderHeader() {
  const container = document.getElementById("header-container");
  if (!container) return;

  container.innerHTML = `
    <header class="sticky top-0 z-40 backdrop-blur-md bg-bg/80 border-b border-line flex items-center justify-between px-6 py-5 h-[84px] gap-4">
      <div class="flex items-center gap-4">
        <h1 class="text-3xl font-display font-bold text-accent md:hidden tracking-wider uppercase">VELDEX</h1>
        <div class="flex flex-col">
          <h2 id="header-title" class="text-2xl font-display font-bold text-white uppercase tracking-widest leading-tight">Chargement...</h2>
          <p id="header-subtitle" class="text-[12px] font-sans font-black text-accent/40 uppercase tracking-[0.3em]">Veuillez patienter</p>
        </div>
      </div>
      
      <div class="flex items-center gap-6">
        <div class="header-profile-block sm:flex hidden cursor-pointer">
          <div class="header-user-info">
            <p id="header-username" class="header-username">UNKNOWN</p>
            <p id="header-role" class="header-user-rank">LEVEL 1 MEMBER</p>
          </div>
          <div id="header-corp" class="header-corp-badge">
            SANS CORPORATION
          </div>
          <div class="relative h-11 w-11 bg-panel border border-line flex items-center justify-center rounded-sm shadow-inner group-hover:border-accent transition-colors">
            <span id="header-avatar-initial" class="text-xl font-display font-black text-white uppercase">?</span>
            <div class="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-accent border-2 border-bg rounded-full shadow-[0_0_8px_rgba(0,224,255,0.4)]"></div>
          </div>
        </div>
      </div>
    </header>
  `;
}

export function updateHeader(title, subtitle) {
  const titleEl = document.getElementById("header-title");
  const subtitleEl = document.getElementById("header-subtitle");
  
  if (titleEl) titleEl.textContent = title;
  if (subtitleEl) subtitleEl.textContent = subtitle;
}

export function updateHeaderUser(username, roleName, corpName) {
  const nameEl = document.getElementById("header-username");
  const roleEl = document.getElementById("header-role");
  const corpEl = document.getElementById("header-corp");
  const avatarEl = document.getElementById("header-avatar-initial");
  
  const displayUsername = username || "UNKNOWN";
  
  if (nameEl) nameEl.textContent = displayUsername;
  if (roleEl) roleEl.textContent = roleName || "LEVEL 1 MEMBER";
  
  if (corpEl) {
    corpEl.textContent = corpName || "Sans corporation";
  }
  
  if (avatarEl) avatarEl.textContent = displayUsername.charAt(0).toUpperCase();
}
