import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// ==================================================
// CONFIGURATION SUPABASE
// ==================================================
const SUPABASE_URL = "https://heoehyhdjawsoffgkdym.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_L1o2o2uB9PK_CTkkdk812w_UI5JspYz";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==================================================
// STATE GLOBAL
// ==================================================
let editingEntryId = null;
let currentUser = null;
let currentCorporationId = null;
let corporationEntriesCache = [];

// ==================================================
// HELPERS
// ==================================================
function $(id) {
  return document.getElementById(id);
}

function setText(id, message) {
  const el = $(id);
  if (el) el.textContent = message;
}

function isDashboardPage() {
  return !!$("dashboard-page");
}

async function getCurrentUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("Erreur session :", error);
    return null;
  }
  return data.session?.user ?? null;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUnit(unit) {
  if (unit === "scu") return "SCU";
  if (unit === "unit") return "UNIT";
  return unit ?? "-";
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-CA");
}

function showFormError(message) {
  const formMessage = $("form-message");
  if (!formMessage) return;
  formMessage.textContent = message;
  formMessage.className = "text-sm text-red-400";
}

function showFormSuccess(message) {
  const formMessage = $("form-message");
  if (!formMessage) return;
  formMessage.textContent = message;
  formMessage.className = "text-sm text-green-400";
}

function isAuthPage() {
  return !!$("auth-page");
}

async function signup() {
  const email = $("emailInput")?.value.trim();
  const password = $("passwordInput")?.value.trim();
  const username = $("usernameInput")?.value.trim();

  if (!email || !password || !username) {
    setText("auth-status", "Remplis email, mot de passe et username.");
    return;
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });

  if (error) {
    setText("auth-status", "Erreur inscription : " + error.message);
    return;
  }

  setText("auth-status", "Compte créé. Connecte-toi ensuite.");
}

async function login() {
  const email = $("emailInput")?.value.trim();
  const password = $("passwordInput")?.value.trim();
  const username = $("usernameInput")?.value.trim();

  if (!email || !password) {
    setText("auth-status", "Remplis email et mot de passe.");
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    setText("auth-status", "Erreur connexion : " + error.message);
    return;
  }

  const user = data.user;

  if (user) {
    const fallbackUsername =
      username || user.user_metadata?.username || email.split("@")[0];

    const { error: profileError } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        username: fallbackUsername
      });

    if (profileError) {
      setText("auth-status", "Connecté, mais erreur profil : " + profileError.message);
      return;
    }
  }

  setText("auth-status", "Connecté. Redirection...");
  window.location.href = "index.html";
}

async function initAuthPage() {
  $("loginBtn")?.addEventListener("click", login);
  $("signupBtn")?.addEventListener("click", signup);
  $("logoutBtn")?.addEventListener("click", logout);

  const user = await getCurrentUser();

  if (user) {
    setText("auth-status", "Session active.");
  } else {
    setText("auth-status", "Non connecté.");
  }
}

// ==================================================
// NAVIGATION UI
// ==================================================
function showView(viewId) {
  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.add("hidden");
  });

  const target = $(viewId);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.remove("bg-panel2", "border", "border-line");
  });

  document.querySelectorAll(`.nav-btn[data-view="${viewId}"]`).forEach((btn) => {
    btn.classList.add("bg-panel2", "border", "border-line");
  });
}

function initNavigation() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.dataset.view);
    });
  });

  showView("view-dashboard");
}

// ==================================================
// AUTH
// ==================================================
async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Erreur déconnexion :", error);
    return;
  }
  window.location.href = "auth.html";
}

// ==================================================
// CORPORATION
// ==================================================
async function getCurrentUserCorporationId(userId) {
  const { data, error } = await supabase
    .from("corporation_members")
    .select("corporation_id")
    .eq("user_id", userId)
    .limit(1)
    .single();

  if (error) {
    console.error("Erreur récupération corporation :", error);
    return null;
  }

  return data?.corporation_id ?? null;
}

async function createCorporation() {
  const user = await getCurrentUser();
  if (!user) return;

  const corpName = $("corp-name")?.value.trim();
  if (!corpName) {
    setText("corp-status", "Entre un nom de corporation.");
    return;
  }

  const { data: existingMembership, error: membershipError } = await supabase
    .from("corporation_members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    setText("corp-status", "Erreur vérification membre : " + membershipError.message);
    return;
  }

  if (existingMembership) {
    setText("corp-status", "Tu es déjà dans une corporation.");
    return;
  }

  const { data: corpData, error: corpError } = await supabase
    .from("corporations")
    .insert({
      name: corpName,
      owner_id: user.id
    })
    .select()
    .single();

  if (corpError) {
    setText("corp-status", "Erreur création corporation : " + corpError.message);
    return;
  }

  const { error: memberError } = await supabase
    .from("corporation_members")
    .insert({
      user_id: user.id,
      corporation_id: corpData.id,
      role: "owner"
    });

  if (memberError) {
    setText("corp-status", "Corporation créée, mais erreur membre : " + memberError.message);
    return;
  }

  setText("corp-status", "Corporation créée avec succès.");
  $("corp-name").value = "";
  currentCorporationId = corpData.id;

  await reloadAllData();
}

async function loadMyCorporation() {
  const user = await getCurrentUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  setText("user-display-name", profile?.username ?? "UNKNOWN");

  const { data, error } = await supabase
    .from("corporation_members")
    .select(`
      role,
      corporation_id,
      corporations (
        id,
        name,
        owner_id
      )
    `)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    setText("corp-display-name", "NO CORPORATION");
    setText("corp-role-badge", "RANK: NONE");
    setText("corp-ref", "REF: N/A");
    setText("user-linked-corp", "NO ACTIVE CORPORATION");
    setText("user-clearance", "LEVEL 1 MEMBER");
    return;
  }

  const corp = data.corporations;
  const role = data.role;

  setText("corp-display-name", corp?.name ?? "UNKNOWN");
  setText("corp-role-badge", `RANK: ${String(role).toUpperCase()}`);
  setText("corp-ref", `REF: VX-${corp?.id ?? "N/A"}`);
  setText("user-linked-corp", corp?.name ?? "UNKNOWN");

  const clearanceMap = {
  owner: "LEVEL 3 — DIRECTEUR",
  admin: "LEVEL 2 — CHEF D'ÉQUIPE",
  member: "LEVEL 1 — MEMBRE"
};

  setText("user-clearance", clearanceMap[role] ?? "LEVEL 1 MEMBER");
}

async function updateCorpStats() {
  const user = await getCurrentUser();
  if (!user) return;

  const { data: membership } = await supabase
    .from("corporation_members")
    .select("corporation_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    setText("corp-operations", "IDLE");
    setText("corp-members-count", "0");
    setText("corp-pending-count", "0");
    return;
  }

  const corporationId = membership.corporation_id;

  const { count: memberCount } = await supabase
    .from("corporation_members")
    .select("*", { count: "exact", head: true })
    .eq("corporation_id", corporationId);

  const { count: pendingCount } = await supabase
    .from("corporation_invitations")
    .select("*", { count: "exact", head: true })
    .eq("corporation_id", corporationId)
    .eq("status", "pending");

  setText("corp-operations", "ACTIVE");
  setText("corp-members-count", String(memberCount ?? 0));
  setText("corp-pending-count", String(pendingCount ?? 0));
}

function getRoleLabel(role) {
  const roleMap = {
    owner: "Directeur",
    admin: "Chef d'équipe",
    member: "Membre"
  };

  return roleMap[role] ?? role;
}

function getNextRole(role) {
  if (role === "member") return "admin";
  return null;
}

function getPreviousRole(role) {
  if (role === "admin") return "member";
  return null;
}

async function loadCorporationMembers() {
  const membersBody = $("corp-members-body");
  if (!membersBody) return;

  if (!currentUser || !currentCorporationId) {
    membersBody.innerHTML = `
      <tr>
        <td colspan="3" class="py-4 text-muted">Aucune corporation active.</td>
      </tr>
    `;
    return;
  }

  membersBody.innerHTML = `
    <tr>
      <td colspan="3" class="py-4 text-muted">Chargement...</td>
    </tr>
  `;

  // récupérer le rôle de l'utilisateur actuel
  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", currentUser.id)
    .eq("corporation_id", currentCorporationId)
    .single();

  if (myMembershipError || !myMembership) {
    membersBody.innerHTML = `
      <tr>
        <td colspan="3" class="py-4 text-red-400">Erreur récupération rôle utilisateur.</td>
      </tr>
    `;
    return;
  }

  const myRole = myMembership.role;

  // récupérer les membres
  const { data, error } = await supabase
    .from("corporation_members")
    .select(`
      id,
      user_id,
      role,
      profiles:user_id (
        username
      )
    `)
    .eq("corporation_id", currentCorporationId);

  if (error) {
    console.error("Erreur chargement membres :", error);
    membersBody.innerHTML = `
      <tr>
        <td colspan="3" class="py-4 text-red-400">Erreur lors du chargement.</td>
      </tr>
    `;
    return;
  }

  if (!data || data.length === 0) {
    membersBody.innerHTML = `
      <tr>
        <td colspan="3" class="py-4 text-muted">Aucun membre trouvé.</td>
      </tr>
    `;
    return;
  }

  membersBody.innerHTML = data.map((member) => {
    const username = member.profiles?.username ?? "Inconnu";
    const nextRole = getNextRole(member.role);

    let actionHtml = `<span class="text-muted">-</span>`;

if (myRole === "owner" && member.user_id !== currentUser.id) {
  const actions = [];

  const nextRole = getNextRole(member.role);
  const previousRole = getPreviousRole(member.role);

  if (nextRole) {
    actions.push(`
      <button
        type="button"
        class="promote-member bg-accent hover:bg-cyan-400 text-black px-3 py-1 rounded text-xs font-medium"
        data-member-id="${member.id}"
        data-current-role="${member.role}"
      >
        Promouvoir
      </button>
    `);
  }

  if (previousRole) {
    actions.push(`
      <button
        type="button"
        class="demote-member bg-amber-500 hover:bg-amber-400 text-black px-3 py-1 rounded text-xs font-medium"
        data-member-id="${member.id}"
        data-current-role="${member.role}"
      >
        Dépromouvoir
      </button>
    `);
  }

  if (member.role !== "owner") {
    actions.push(`
      <button
        type="button"
        class="kick-member bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs font-medium"
        data-member-id="${member.id}"
        data-username="${escapeHtml(username)}"
      >
        Expulser
      </button>
    `);
  }

  actionHtml = `<div class="flex gap-2 flex-wrap">${actions.join("")}</div>`;
}

    return `
      <tr class="border-b border-line">
        <td class="py-3 pr-4">${escapeHtml(username)}</td>
        <td class="py-3 pr-4">${escapeHtml(getRoleLabel(member.role))}</td>
        <td class="py-3 pr-4">${actionHtml}</td>
      </tr>
    `;
  }).join("");
}

async function promoteMember(memberId, currentRole) {
  if (!currentUser || !currentCorporationId) return;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", currentUser.id)
    .eq("corporation_id", currentCorporationId)
    .single();

  if (myMembershipError || !myMembership || myMembership.role !== "owner") {
    alert("Seul le directeur peut promouvoir un membre.");
    return;
  }

  const nextRole = getNextRole(currentRole);

  if (!nextRole) {
    alert("Ce membre ne peut pas être promu davantage.");
    return;
  }

  console.log("PROMOTE memberId =", memberId);
  console.log("PROMOTE currentRole =", currentRole);
  console.log("PROMOTE nextRole =", nextRole);

  const { data, error } = await supabase
    .from("corporation_members")
    .update({ role: nextRole })
    .eq("id", memberId)
    .eq("corporation_id", currentCorporationId)
    .select();

  console.log("PROMOTE result data =", data);
  console.log("PROMOTE result error =", error);

  if (error) {
    alert("Erreur lors de la promotion : " + error.message);
    return;
  }

  await loadCorporationMembers();
}

async function demoteMember(memberId, currentRole) {
  if (!currentUser || !currentCorporationId) return;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", currentUser.id)
    .eq("corporation_id", currentCorporationId)
    .single();

  if (myMembershipError || !myMembership || myMembership.role !== "owner") {
    alert("Seul le directeur peut dépromouvoir un membre.");
    return;
  }

  const previousRole = getPreviousRole(currentRole);

  if (!previousRole) {
    alert("Ce membre ne peut pas être dépromu.");
    return;
  }

  const { error } = await supabase
    .from("corporation_members")
    .update({ role: previousRole })
    .eq("id", memberId)
    .eq("corporation_id", currentCorporationId);

  if (error) {
    console.error("Erreur dépromotion membre :", error);
    alert("Erreur lors de la dépromotion.");
    return;
  }

  await loadCorporationMembers();
}

async function kickMember(memberId, username) {
  if (!currentUser || !currentCorporationId) return;

  const confirmed = window.confirm(
    `Expulser ${username} de la corporation ?`
  );

  if (!confirmed) return;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", currentUser.id)
    .eq("corporation_id", currentCorporationId)
    .single();

  if (myMembershipError || !myMembership || myMembership.role !== "owner") {
    alert("Seul le directeur peut expulser un membre.");
    return;
  }

  const { data: targetMember, error: targetError } = await supabase
    .from("corporation_members")
    .select("role, user_id")
    .eq("id", memberId)
    .eq("corporation_id", currentCorporationId)
    .single();

  if (targetError || !targetMember) {
    alert("Membre introuvable.");
    return;
  }

  if (targetMember.user_id === currentUser.id) {
    alert("Tu ne peux pas t'expulser toi-même.");
    return;
  }

  if (targetMember.role === "owner") {
    alert("Impossible d'expulser le directeur.");
    return;
  }

  const { error } = await supabase
    .from("corporation_members")
    .delete()
    .eq("id", memberId)
    .eq("corporation_id", currentCorporationId);

  if (error) {
    console.error("Erreur expulsion membre :", error);
    alert("Erreur lors de l'expulsion.");
    return;
  }

  await loadCorporationMembers();
  await updateCorpStats();
}


function bindCorporationMembersActions() {
  const membersBody = $("corp-members-body");
  if (!membersBody) return;

  membersBody.addEventListener("click", async (e) => {
    const promoteBtn = e.target.closest(".promote-member");
    if (promoteBtn) {
      const memberId = promoteBtn.dataset.memberId;
      const currentRole = promoteBtn.dataset.currentRole;
      await promoteMember(memberId, currentRole);
      return;
    }

    const demoteBtn = e.target.closest(".demote-member");
    if (demoteBtn) {
      const memberId = demoteBtn.dataset.memberId;
      const currentRole = demoteBtn.dataset.currentRole;
      await demoteMember(memberId, currentRole);
      return;
    }

    const kickBtn = e.target.closest(".kick-member");
    if (kickBtn) {
      const memberId = kickBtn.dataset.memberId;
      const username = kickBtn.dataset.username ?? "ce membre";
      await kickMember(memberId, username);
    }
  });
}

// ==================================================
// INVITATIONS
// ==================================================
async function inviteUser() {
  const user = await getCurrentUser();
  if (!user) {
    setText("invite-status", "Tu dois être connecté.");
    return;
  }

  const username = $("invite-username")?.value.trim();
  if (!username) {
    setText("invite-status", "Entre un username.");
    return;
  }

  const { data: targetUser, error: userError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (userError || !targetUser) {
    setText("invite-status", "Utilisateur introuvable.");
    return;
  }

  if (targetUser.id === user.id) {
    setText("invite-status", "Tu ne peux pas t’inviter toi-même.");
    return;
  }

  const { data: myCorp, error: corpError } = await supabase
    .from("corporation_members")
    .select("corporation_id")
    .eq("user_id", user.id)
    .single();

  if (corpError || !myCorp) {
    setText("invite-status", "Erreur récupération corporation.");
    return;
  }

  const { data: targetMembership } = await supabase
    .from("corporation_members")
    .select("id")
    .eq("user_id", targetUser.id)
    .maybeSingle();

  if (targetMembership) {
    setText("invite-status", "Cet utilisateur est déjà dans une corporation.");
    return;
  }

  const { data: existingInvite } = await supabase
    .from("corporation_invitations")
    .select("id")
    .eq("corporation_id", myCorp.corporation_id)
    .eq("invited_user_id", targetUser.id)
    .eq("status", "pending")
    .maybeSingle();

  if (existingInvite) {
    setText("invite-status", "Une invitation est déjà en attente pour cet utilisateur.");
    return;
  }

  const { error: inviteError } = await supabase
    .from("corporation_invitations")
    .insert({
      corporation_id: myCorp.corporation_id,
      invited_user_id: targetUser.id,
      invited_by_user_id: user.id
    });

  if (inviteError) {
    setText("invite-status", "Erreur invitation : " + inviteError.message);
    return;
  }

  setText("invite-status", "Invitation envoyée.");
  $("invite-username").value = "";

  await updateCorpStats();
  await loadInvitations();
}

async function loadInvitations() {
  const user = await getCurrentUser();
  const invitationsList = $("invitations-list");
  if (!user || !invitationsList) return;

  const { data, error } = await supabase
    .from("corporation_invitations")
    .select(`
      id,
      status,
      created_at,
      corporations (
        id,
        name
      ),
      profiles!corporation_invitations_invited_by_user_id_fkey (
        username
      )
    `)
    .eq("invited_user_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    setText("invitations-status", "Erreur chargement invitations : " + error.message);
    return;
  }

  setText("pending-invitations-badge", `${data?.length ?? 0} PENDING`);

  if (!data || data.length === 0) {
    invitationsList.innerHTML = `<div class="text-sm text-muted">No pending invitations.</div>`;
    return;
  }

  invitationsList.innerHTML = data.map((invite) => {
    const corpName = invite.corporations?.name ?? "Corporation inconnue";
    const invitedBy = invite.profiles?.username ?? "Inconnu";

    return `
      <div class="bg-panel2 border border-line rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p class="text-sm font-semibold">${escapeHtml(corpName)}</p>
          <p class="text-xs text-muted">Invited by: ${escapeHtml(invitedBy)}</p>
        </div>

        <div class="flex gap-2">
          <button
            onclick="acceptInvitation(${invite.id})"
            class="px-4 py-2 rounded bg-accent text-black text-sm font-medium"
          >
            Accept
          </button>

          <button
            onclick="rejectInvitation(${invite.id})"
            class="px-4 py-2 rounded bg-red-600 text-white text-sm font-medium"
          >
            Reject
          </button>
        </div>
      </div>
    `;
  }).join("");
}

async function acceptInvitation(invitationId) {
  const user = await getCurrentUser();
  if (!user) return;

  const { data: invitation, error: invitationError } = await supabase
    .from("corporation_invitations")
    .select("id, corporation_id, invited_user_id")
    .eq("id", invitationId)
    .eq("invited_user_id", user.id)
    .single();

  if (invitationError || !invitation) {
    setText("invitations-status", "Invitation introuvable.");
    return;
  }

  const { data: existingMembership } = await supabase
    .from("corporation_members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMembership) {
    setText("invitations-status", "Tu es déjà dans une corporation.");
    return;
  }

  const { error: memberError } = await supabase
    .from("corporation_members")
    .insert({
      user_id: user.id,
      corporation_id: invitation.corporation_id,
      role: "member"
    });

  if (memberError) {
    setText("invitations-status", "Erreur ajout corporation : " + memberError.message);
    return;
  }

  const { error: updateError } = await supabase
    .from("corporation_invitations")
    .update({ status: "accepted" })
    .eq("id", invitationId);

  if (updateError) {
    setText("invitations-status", "Membre ajouté, mais erreur update invitation.");
    return;
  }

  currentCorporationId = invitation.corporation_id;
  setText("invitations-status", "Invitation acceptée.");
  await reloadAllData();
}

async function rejectInvitation(invitationId) {
  const user = await getCurrentUser();
  if (!user) return;

  const { error } = await supabase
    .from("corporation_invitations")
    .update({ status: "rejected" })
    .eq("id", invitationId)
    .eq("invited_user_id", user.id);

  if (error) {
    setText("invitations-status", "Erreur refus invitation : " + error.message);
    return;
  }

  setText("invitations-status", "Invitation refusée.");
  await loadInvitations();
  await updateCorpStats();
}

window.acceptInvitation = acceptInvitation;
window.rejectInvitation = rejectInvitation;

// ==================================================
// MINERAIS / UNITÉS
// ==================================================
const UNIT_MINERALS = [
  "jacluium",
  "carinite",
  "aphorite",
  "glacosite",
  "dolivine",
  "beradom",
  "feynmaline",
  "hadanite",
  "janalite",
  "saldynium"
];

const SCU_MINERALS = [
  "agricium",
  "aluminium",
  "aslarite",
  "beryl",
  "bexalite",
  "borase",
  "copper",
  "corundum",
  "gold",
  "hephaestanite",
  "ice",
  "iron",
  "laranite",
  "lindinium",
  "quartz",
  "quantainium",
  "riccite",
  "sadaryx",
  "savrilum",
  "silicon",
  "stileron",
  "taranite",
  "tin",
  "titanium",
  "torite",
  "tungsten"
];

function getUnitTypeForMineral(mineralName) {
  if (!mineralName) return "";
  const key = mineralName.trim().toLowerCase();
  if (UNIT_MINERALS.includes(key)) return "unit";
  if (SCU_MINERALS.includes(key)) return "scu";
  return "scu";
}

// ==================================================
// STORAGE / ENTRIES
// ==================================================
function bindMineralUnitAuto() {
  const mineralSelect = $("mineral_name");
  const unitInput = $("unit_type");
  const quantityInput = $("quantity");

  if (mineralSelect && unitInput && quantityInput) {
    const updateUnitAndQuantityMode = () => {
      const unitType = getUnitTypeForMineral(mineralSelect.value);
      unitInput.value = unitType;

      if (unitType === "unit") {
        quantityInput.step = "1";
        quantityInput.min = "1";
        quantityInput.value = quantityInput.value
          ? String(Math.round(Number(quantityInput.value)))
          : "";
        quantityInput.placeholder = "Ex : 12";
      } else {
        quantityInput.step = "0.01";
        quantityInput.min = "0.01";
        quantityInput.placeholder = "Ex : 0.03";
      }
    };

    mineralSelect.addEventListener("change", updateUnitAndQuantityMode);
    updateUnitAndQuantityMode();
  }
}

function sortMineralSelect() {
  const select = $("mineral_name");
  if (!select) return;

  const options = Array.from(select.options);
  const firstOption = options.shift();

  const sorted = options.sort((a, b) =>
    a.text.localeCompare(b.text, "fr", { sensitivity: "base" })
  );

  select.innerHTML = "";
  select.appendChild(firstOption);

  sorted.forEach((opt) => select.appendChild(opt));
}

function fillFormForEdit(entry) {
  editingEntryId = entry.id;
  $("mineral_name").value = entry.mineral_name;
  $("unit_type").value = entry.unit_type;
  $("quantity").value = entry.quantity;
  $("quality").value = entry.quality;

  const submitBtn = $("add-entry-form")?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = "Enregistrer";

  showView("view-add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetEntryForm() {
  editingEntryId = null;
  $("add-entry-form")?.reset();
  if ($("unit_type")) $("unit_type").value = "";

  const submitBtn = $("add-entry-form")?.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.textContent = "Ajouter";
}

async function loadMyStorage() {
  const myStorageBody = $("my-storage-body");
  if (!myStorageBody) return;

  if (!currentUser || !currentCorporationId) {
    myStorageBody.innerHTML = `<tr><td colspan="5" class="py-4 text-muted">Aucune donnée chargée.</td></tr>`;
    return;
  }

  myStorageBody.innerHTML = `<tr><td colspan="5" class="py-4 text-muted">Chargement...</td></tr>`;

  const { data, error } = await supabase
    .from("corp_entries")
    .select("id, mineral_name, quantity, unit_type, quality, created_at")
    .eq("user_id", currentUser.id)
    .eq("corporation_id", currentCorporationId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erreur chargement stockage perso :", error);
    myStorageBody.innerHTML = `<tr><td colspan="5" class="py-4 text-red-400">Erreur lors du chargement.</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    myStorageBody.innerHTML = `<tr><td colspan="5" class="py-4 text-muted">Aucune entrée trouvée.</td></tr>`;
    return;
  }

  myStorageBody.innerHTML = data.map((entry) => `
    <tr class="border-b border-line">
      <td class="py-3 pr-4">${escapeHtml(entry.mineral_name)}</td>
      <td class="py-3 pr-4">${entry.quantity}</td>
      <td class="py-3 pr-4">${formatUnit(entry.unit_type)}</td>
      <td class="py-3 pr-4">${entry.quality}</td>
      <td class="py-3 pr-4">
        <div class="flex gap-2">
          <button
            type="button"
            class="edit-entry bg-panel2 hover:bg-line px-2 py-1 rounded text-xs"
            data-id="${entry.id}"
          >
            Modifier
          </button>
          <button
            type="button"
            class="delete-entry bg-red-600 hover:bg-red-500 px-2 py-1 rounded text-xs text-white"
            data-id="${entry.id}"
          >
            Supprimer
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

async function loadCorporationStorage() {
  const corpStorageBody = $("corp-storage-body");
  if (!corpStorageBody) return;

  if (!currentUser || !currentCorporationId) {
    corpStorageBody.innerHTML = `<tr><td colspan="5" class="py-4 text-muted">Aucune donnée chargée.</td></tr>`;
    return;
  }

  corpStorageBody.innerHTML = `<tr><td colspan="5" class="py-4 text-muted">Chargement...</td></tr>`;

  const { data, error } = await supabase
    .from("corp_entries")
    .select(`
      id,
      mineral_name,
      quantity,
      unit_type,
      quality,
      created_at,
      user_id,
      profiles:user_id (
        username
      )
    `)
    .eq("corporation_id", currentCorporationId)
    .order("quality", { ascending: false });

  if (error) {
    console.error("Erreur chargement stockage corporation :", error);
    corpStorageBody.innerHTML = `<tr><td colspan="5" class="py-4 text-red-400">Erreur lors du chargement.</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    corpStorageBody.innerHTML = `<tr><td colspan="5" class="py-4 text-muted">Aucune donnée.</td></tr>`;
    return;
  }

  corpStorageBody.innerHTML = data.map((entry) => `
    <tr class="border-b border-line">
      <td class="py-3 pr-4">${escapeHtml(entry.mineral_name)}</td>
      <td class="py-3 pr-4">${entry.quantity}</td>
      <td class="py-3 pr-4">${formatUnit(entry.unit_type)}</td>
      <td class="py-3 pr-4">${entry.quality}</td>
      <td class="py-3 pr-4">${escapeHtml(entry.profiles?.username ?? "Inconnu")}</td>
    </tr>
  `).join("");
}

function bindAddEntryForm() {
  const addEntryForm = $("add-entry-form");
  if (!addEntryForm) return;

  addEntryForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentUser || !currentCorporationId) {
      showFormError("Utilisateur ou corporation introuvable.");
      return;
    }

    const mineral_name = $("mineral_name")?.value.trim() ?? "";
    const unit_type = getUnitTypeForMineral(mineral_name);
    const quantity = Number($("quantity")?.value);
    const quality = Number($("quality")?.value);

    if (!mineral_name) {
      showFormError("Choisis un minerai.");
      return;
    }

    if (!quantity || quantity <= 0) {
      showFormError("La quantité doit être supérieure à 0.");
      return;
    }

    if (Number.isNaN(quality) || quality < 0 || quality > 1000) {
      showFormError("La qualité doit être entre 0 et 1000.");
      return;
    }

    let saveError = null;

    if (editingEntryId) {
      const { error } = await supabase
        .from("corp_entries")
        .update({
          mineral_name,
          quantity,
          unit_type,
          quality
        })
        .eq("id", editingEntryId)
        .eq("user_id", currentUser.id)
        .eq("corporation_id", currentCorporationId);

      saveError = error;
    } else {
      const { error } = await supabase
        .from("corp_entries")
        .insert({
          mineral_name,
          quantity,
          unit_type,
          quality,
          user_id: currentUser.id,
          corporation_id: currentCorporationId
        });

      saveError = error;
    }

    if (saveError) {
      console.error("Erreur sauvegarde :", saveError);
      showFormError("Erreur lors de la sauvegarde.");
      return;
    }

    showFormSuccess(editingEntryId ? "Entrée modifiée avec succès." : "Minerai ajouté avec succès.");
    resetEntryForm();
    await reloadAllData();
  });
}

function bindMyStorageActions() {
  const myStorageBody = $("my-storage-body");
  if (!myStorageBody) return;

  myStorageBody.addEventListener("click", async (e) => {
    if (!currentUser || !currentCorporationId) return;

    const editBtn = e.target.closest(".edit-entry");
    const deleteBtn = e.target.closest(".delete-entry");

    if (editBtn) {
      const id = editBtn.dataset.id;

      const { data, error } = await supabase
        .from("corp_entries")
        .select("id, mineral_name, quantity, unit_type, quality")
        .eq("id", id)
        .eq("user_id", currentUser.id)
        .eq("corporation_id", currentCorporationId)
        .single();

      if (error) {
        console.error("Erreur chargement entrée :", error);
        return;
      }

      fillFormForEdit(data);
      return;
    }

    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const confirmed = window.confirm("Supprimer cette entrée ?");
      if (!confirmed) return;

      const { error } = await supabase
        .from("corp_entries")
        .delete()
        .eq("id", id)
        .eq("user_id", currentUser.id)
        .eq("corporation_id", currentCorporationId);

      if (error) {
        console.error("Erreur suppression :", error);
        alert("Erreur lors de la suppression.");
        return;
      }

      if (String(editingEntryId) === String(id)) {
        resetEntryForm();
      }

      await reloadAllData();
    }
  });
}

// ==================================================
// DASHBOARD STATS
// ==================================================
async function loadCorporationStats() {
  if (!currentUser || !currentCorporationId) return;

  const { data, error } = await supabase
    .from("corp_entries")
    .select(`
      id,
      mineral_name,
      quantity,
      unit_type,
      quality,
      created_at,
      user_id,
      profiles:user_id (
        username
      )
    `)
    .eq("corporation_id", currentCorporationId);

  if (error) {
    console.error("Erreur stats corporation :", error);
    return;
  }

  corporationEntriesCache = data || [];

  let totalSCU = 0;
  let totalUNIT = 0;

  corporationEntriesCache.forEach((entry) => {
    if (entry.unit_type === "scu") totalSCU += Number(entry.quantity) || 0;
    if (entry.unit_type === "unit") totalUNIT += Number(entry.quantity) || 0;
  });

  setText("stat-total-scu", totalSCU.toFixed(2));
  setText("stat-total-unit", String(totalUNIT));
}

function renderMineralSearchTop3() {
  const searchTopResults = $("search-top-results");
  const mineralSearchInput = $("mineral-search");
  if (!searchTopResults) return;

  const query = mineralSearchInput?.value.trim().toLowerCase() || "";

  if (!query) {
    searchTopResults.innerHTML = `<p class="text-muted">Tape un minerai pour voir les 3 meilleurs.</p>`;
    return;
  }

  const filtered = corporationEntriesCache
    .filter((entry) => (entry.mineral_name || "").toLowerCase().includes(query))
    .sort((a, b) => b.quality - a.quality || b.quantity - a.quantity)
    .slice(0, 3);

  if (filtered.length === 0) {
    searchTopResults.innerHTML = `<p class="text-muted">Aucun résultat pour "${escapeHtml(query)}".</p>`;
    return;
  }

  searchTopResults.innerHTML = filtered.map((entry, index) => {
    const username = entry.profiles?.username ?? "Inconnu";

    return `
      <div class="bg-panel2 rounded-lg p-3 border border-line flex items-center justify-between gap-4">
        <div>
          <p class="font-semibold text-white">#${index + 1} — ${escapeHtml(entry.mineral_name)}</p>
          <p class="text-sm text-muted">Ajouté par : ${escapeHtml(username)}</p>
        </div>
        <div class="text-right">
          <p class="font-bold">${entry.quality}</p>
          <p class="text-sm text-muted">${entry.quantity} ${formatUnit(entry.unit_type)}</p>
        </div>
      </div>
    `;
  }).join("");
}

function renderTotalsByMineral() {
  const container = $("totals-by-mineral");
  if (!container) return;

  if (!corporationEntriesCache.length) {
    container.innerHTML = `<p class="text-muted">Aucune donnée.</p>`;
    return;
  }

  const totals = {};

  corporationEntriesCache.forEach((entry) => {
    const key = entry.mineral_name;
    if (!totals[key]) {
      totals[key] = {
        unit: entry.unit_type,
        total: 0
      };
    }
    totals[key].total += Number(entry.quantity) || 0;
  });

  const sorted = Object.entries(totals).sort((a, b) => b[1].total - a[1].total);

  container.innerHTML = sorted.map(([name, value]) => `
    <div class="flex justify-between border-b border-line py-2 text-sm">
      <span>${escapeHtml(name)}</span>
      <span>${value.total.toFixed(2)} ${formatUnit(value.unit)}</span>
    </div>
  `).join("");
}

function renderRecentEntries() {
  const container = $("recent-entries");
  if (!container) return;

  if (!corporationEntriesCache.length) {
    container.innerHTML = `<p class="text-muted">Aucune donnée.</p>`;
    return;
  }

  const recent = [...corporationEntriesCache]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3);

  container.innerHTML = recent.map((entry) => {
    const username = entry.profiles?.username ?? "Inconnu";

    return `
      <div class="flex justify-between border-b border-line py-2 text-sm">
        <div>
          <span class="font-medium">${escapeHtml(entry.mineral_name)}</span>
          <span class="text-muted">
            — ${entry.quantity} ${formatUnit(entry.unit_type)}
          </span>
          <div class="text-xs text-muted">
            par ${escapeHtml(username)}
          </div>
        </div>

        <div class="text-right">
          <span class="font-semibold">Q${entry.quality}</span>
        </div>
      </div>
    `;
  }).join("");
}

function bindDashboardSearch() {
  const mineralSearchInput = $("mineral-search");
  if (!mineralSearchInput) return;
  mineralSearchInput.addEventListener("input", renderMineralSearchTop3);
}

// ==================================================
// GLOBAL RELOAD
// ==================================================
async function reloadAllData() {
  await loadMyCorporation();
  await updateCorpStats();
  await loadInvitations();
  await loadMyStorage();
  await loadCorporationStorage();
  await loadCorporationStats();
  await loadCorporationMembers();
  renderMineralSearchTop3();
  renderTotalsByMineral();
  renderRecentEntries();
}

// ==================================================
// INIT DASHBOARD
// ==================================================
async function initDashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    window.location.href = "auth.html";
    return;
  }

  currentUser = user;
  currentCorporationId = await getCurrentUserCorporationId(user.id);

  initNavigation();
  bindMineralUnitAuto();
  bindAddEntryForm();
  bindMyStorageActions();
  bindDashboardSearch();
  sortMineralSelect();
  bindCorporationMembersActions();
$("refresh-members")?.addEventListener("click", loadCorporationMembers);

  $("create-corp-btn")?.addEventListener("click", createCorporation);
  $("logout-btn")?.addEventListener("click", logout);
  $("invite-btn")?.addEventListener("click", inviteUser);
  $("refresh-invitations-btn")?.addEventListener("click", loadInvitations);
  $("refresh-my-storage")?.addEventListener("click", loadMyStorage);
  $("refresh-corp-storage")?.addEventListener("click", loadCorporationStorage);

  await reloadAllData();
}

// ==================================================
// ENTRY POINT
// ==================================================
if (isAuthPage()) {
  initAuthPage();
}

if (isDashboardPage()) {
  initDashboardPage();
}