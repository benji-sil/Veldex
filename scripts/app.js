import { supabase } from "../services/supabase.js";
import { $, isDashboardPage, getCurrentUser, isAuthPage, fetchGameVersions } from "./utils.js";
import { initNavigation } from "./router.js";
import { initAuthPage, logout } from "../services/authService.js";
import { store } from "./store.js";
import { renderSidebar, updateSidebarVersions } from "../components/sidebar.js";
import { renderMobileNav } from "../components/navbar.js";
import { renderHeader } from "../components/header.js";

import { 
  getCurrentUserCorporationId, createCorporation, loadMyCorporation, 
  loadCorporationMembers, bindCorporationMembersActions,
  inviteUser, loadInvitations, acceptInvitation, rejectInvitation
} from "../pages/corp.js";

import {
  bindUexTest, loadInventoryEntries, bindInventoryEntriesFilters, bindOcr
} from "../pages/inventory.js";

import {
  loadCorporationStats, renderMineralSearchTop3,
  renderRecentEntries, bindDashboardSearch
} from "../pages/dashboard.js";

export async function reloadAllData() {
  await loadMyCorporation();
  await loadInvitations();
  await loadCorporationStats();
  await loadCorporationMembers();
  await loadInventoryEntries();
  renderMineralSearchTop3();
  renderRecentEntries();
}

window.addEventListener("reload-all-data", reloadAllData);
window.addEventListener("view-changed", (e) => {
  if (e.detail.viewId === "view-dashboard") {
    loadCorporationStats();
  }
});
window.acceptInvitation = acceptInvitation;
window.rejectInvitation = rejectInvitation;

async function initDashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  store.currentUser = user;
  store.currentCorporationId = await getCurrentUserCorporationId(user.id);

  renderSidebar();
  renderMobileNav();
  renderHeader();
  initNavigation();
  
  // Fetch game versions and update sidebar once done
  fetchGameVersions().then(() => {
    updateSidebarVersions();
  });

  bindDashboardSearch();
  bindCorporationMembersActions();
  bindUexTest();
  bindInventoryEntriesFilters();
  bindOcr();
  
  $("refresh-members")?.addEventListener("click", loadCorporationMembers);
  $("create-corp-btn")?.addEventListener("click", createCorporation);
  $("logout-btn")?.addEventListener("click", logout);
  $("invite-btn")?.addEventListener("click", inviteUser);
  $("refresh-invitations-btn")?.addEventListener("click", loadInvitations);

  await reloadAllData();
}

if (isAuthPage()) {
  initAuthPage();
}

if (isDashboardPage()) {
  initDashboardPage();
}