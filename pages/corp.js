import { supabase } from "../services/supabase.js";
import { $, setText, escapeHtml, getCurrentUser, logger } from "../scripts/utils.js";
import { store } from "../scripts/store.js";
import { showAlert, showConfirm, showPrompt } from "../components/modal.js";

import { updateHeaderUser } from "../components/header.js";

const triggerReload = () => window.dispatchEvent(new Event("reload-all-data"));

export async function getCurrentUserCorporationId(userId) {
  const { data, error } = await supabase
    .from("corporation_members")
    .select("corporation_id")
    .eq("user_id", userId)
    .limit(1)
    .single();

  if (error) {
    logger.error("Corporation", "Fetch membership error:", error);
    return null;
  }
  return data?.corporation_id ?? null;
}

export async function createCorporation() {
  const user = await getCurrentUser();
  if (!user) {
    await showAlert("Connexion requise", "Vous devez être connecté pour créer une corporation.");
    return;
  }

  // Check if already in a corporation
  const { data: existingMembership, error: membershipError } = await supabase
    .from("corporation_members")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    logger.error("Corporation", "Check membership error:", membershipError);
    return;
  }

  if (existingMembership) {
    await showAlert("Action impossible", "Vous faites déjà partie d'une corporation.");
    return;
  }

  const corpName = await showPrompt("Créer une corporation", "Entrez le nom de votre nouvelle corporation :", "Nom de la corporation");
  
  if (!corpName) return; // User cancelled or entered empty string

  // Create the corporation
  const { data: corpData, error: corpError } = await supabase
    .from("corporations")
    .insert({
      name: corpName,
      owner_id: user.id
    })
    .select()
    .single();

  if (corpError) {
    logger.error("Corporation", "Create corp error:", corpError);
    await showAlert("Erreur", "Impossible de créer la corporation : " + corpError.message);
    return;
  }

  // Add the owner as the first member
  const { error: memberError } = await supabase
    .from("corporation_members")
    .insert({
      user_id: user.id,
      corporation_id: corpData.id,
      role: "owner"
    });

  if (memberError) {
    logger.error("Corporation", "Add owner member error:", memberError);
    await showAlert("Erreur", "Corporation créée, mais erreur lors de votre ajout en tant que membre.");
    return;
  }

  store.currentCorporationId = corpData.id;
  await loadMyCorporation();
  triggerReload();
  
  showToast(`Corporation "${corpName}" créée !`);
}



export async function loadMyCorporation() {
  const user = await getCurrentUser();
  if (!user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

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
    updateHeaderUser(profile?.username, "LEVEL 1 MEMBER", "Sans corporation");
    if ($("corp-page-title")) $("corp-page-title").textContent = "Aucune corporation";
    if ($("create-corp-btn")) $("create-corp-btn").classList.remove("hidden");
    return;
  }

  const role = data.role;
  const corp = data.corporations;
  const corpName = corp?.name || "Sans corporation";

  const clearanceMap = {
    owner: "LEVEL 3 — DIRECTEUR",
    admin: "LEVEL 2 — CHEF D'ÉQUIPE",
    member: "LEVEL 1 — MEMBRE"
  };

  const roleLabel = clearanceMap[role] ?? "LEVEL 1 MEMBER";

  // Sync with store
  store.currentCorporationId = data.corporation_id;

  updateHeaderUser(profile?.username, roleLabel, corpName);
  if ($("corp-page-title")) $("corp-page-title").textContent = corpName;
  if ($("create-corp-btn")) $("create-corp-btn").classList.add("hidden");
}


export function getRoleLabel(role) {
  const roleMap = {
    owner: "Directeur",
    admin: "Chef d'équipe",
    member: "Membre"
  };
  return roleMap[role] ?? role;
}

export function getNextRole(role) {
  if (role === "member") return "admin";
  return null;
}

export function getPreviousRole(role) {
  if (role === "admin") return "member";
  return null;
}

export async function loadCorporationMembers() {
  const membersBody = $("corp-members-body");
  if (!membersBody) return;

  if (!store.currentUser || !store.currentCorporationId) {
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

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", store.currentUser.id)
    .eq("corporation_id", store.currentCorporationId)
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
    .eq("corporation_id", store.currentCorporationId);

  if (error) {
    logger.error("Corporation", "Load members error:", error);
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
    let actionHtml = `<span class="text-muted italic opacity-30 text-[10px]">FIXED</span>`;

    if (myRole === "owner" && member.user_id !== store.currentUser.id) {
      const actions = [];
      const nextRole = getNextRole(member.role);
      const previousRole = getPreviousRole(member.role);

      if (nextRole) {
        actions.push(`
          <button
            type="button"
            class="promote-member veldex-btn-primary h-8 px-3 text-[10px]"
            data-member-id="${member.id}"
            data-current-role="${member.role}"
          >
            PROMOTE
          </button>
        `);
      }

      if (previousRole) {
        actions.push(`
          <button
            type="button"
            class="demote-member veldex-btn-secondary h-8 px-3 text-[10px]"
            data-member-id="${member.id}"
            data-current-role="${member.role}"
          >
            DEMOTE
          </button>
        `);
      }

      if (member.role !== "owner") {
        actions.push(`
          <button
            type="button"
            class="kick-member veldex-btn-danger h-8 px-3 text-[10px]"
            data-member-id="${member.id}"
            data-username="${escapeHtml(username)}"
          >
            KICK
          </button>
        `);
      }

      actionHtml = `<div class="flex gap-2 justify-end">${actions.join("")}</div>`;
    }

    const memberId = String(member.id ?? member.user_id ?? "unknown");

    return `
      <tr data-entry-id="${member.id}">
        <td>
          <div class="font-display font-bold text-white uppercase tracking-wide">${escapeHtml(username)}</div>
          <div class="text-[10px] text-muted font-sans uppercase tracking-widest mt-0.5">MEMBER ID: ${memberId.substring(0, 8)}</div>
        </td>
        <td><span class="veldex-badge-corpo">${escapeHtml(getRoleLabel(member.role).toUpperCase())}</span></td>
        <td class="text-right">${actionHtml}</td>
      </tr>
    `;
  }).join("");
}

export async function promoteMember(memberId, currentRole) {
  if (!store.currentUser || !store.currentCorporationId) return;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", store.currentUser.id)
    .eq("corporation_id", store.currentCorporationId)
    .single();

  if (myMembershipError || !myMembership || myMembership.role !== "owner") {
    await showAlert("Accès refusé", "Seul le directeur peut promouvoir un membre.");
    return;
  }

  const nextRole = getNextRole(currentRole);
  if (!nextRole) {
    await showAlert("Action impossible", "Ce membre ne peut pas être promu davantage.");
    return;
  }

  const { data, error } = await supabase
    .from("corporation_members")
    .update({ role: nextRole })
    .eq("id", memberId)
    .eq("corporation_id", store.currentCorporationId)
    .select();

  if (error) {
    await showAlert("Erreur", "Erreur lors de la promotion : " + error.message);
    return;
  }

  await loadCorporationMembers();
}

export async function demoteMember(memberId, currentRole) {
  if (!store.currentUser || !store.currentCorporationId) return;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", store.currentUser.id)
    .eq("corporation_id", store.currentCorporationId)
    .single();

  if (myMembershipError || !myMembership || myMembership.role !== "owner") {
    await showAlert("Accès refusé", "Seul le directeur peut dépromouvoir un membre.");
    return;
  }

  const previousRole = getPreviousRole(currentRole);
  if (!previousRole) {
    await showAlert("Action impossible", "Ce membre ne peut pas être dépromu.");
    return;
  }

  const { error } = await supabase
    .from("corporation_members")
    .update({ role: previousRole })
    .eq("id", memberId)
    .eq("corporation_id", store.currentCorporationId);

  if (error) {
    logger.error("Corporation", "Demote error:", error);
    await showAlert("Erreur", "Erreur lors de la dépromotion.");
    return;
  }

  await loadCorporationMembers();
}

export async function kickMember(memberId, username) {
  if (!store.currentUser || !store.currentCorporationId) return;

  const confirmed = await showConfirm("Expulser le membre", `Expulser ${username} de la corporation ?`);
  if (!confirmed) return;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", store.currentUser.id)
    .eq("corporation_id", store.currentCorporationId)
    .single();

  if (myMembershipError || !myMembership || myMembership.role !== "owner") {
    await showAlert("Accès refusé", "Seul le directeur peut expulser un membre.");
    return;
  }

  const { data: targetMember, error: targetError } = await supabase
    .from("corporation_members")
    .select("role, user_id")
    .eq("id", memberId)
    .eq("corporation_id", store.currentCorporationId)
    .single();

  if (targetError || !targetMember) {
    await showAlert("Erreur", "Membre introuvable.");
    return;
  }

  if (targetMember.user_id === store.currentUser.id) {
    await showAlert("Action impossible", "Tu ne peux pas t'expulser toi-même.");
    return;
  }

  if (targetMember.role === "owner") {
    await showAlert("Action impossible", "Impossible d'expulser le directeur.");
    return;
  }

  const { error } = await supabase
    .from("corporation_members")
    .delete()
    .eq("id", memberId)
    .eq("corporation_id", store.currentCorporationId);

  if (error) {
    logger.error("Corporation", "Kick error:", error);
    await showAlert("Erreur", "Erreur lors de l'expulsion.");
    return;
  }

  await loadCorporationMembers();
}

export function bindCorporationMembersActions() {
  const membersBody = $("corp-members-body");
  if (!membersBody) return;

  membersBody.addEventListener("click", async (e) => {
    const promoteBtn = e.target.closest(".promote-member");
    if (promoteBtn) {
      await promoteMember(promoteBtn.dataset.memberId, promoteBtn.dataset.currentRole);
      return;
    }

    const demoteBtn = e.target.closest(".demote-member");
    if (demoteBtn) {
      await demoteMember(demoteBtn.dataset.memberId, demoteBtn.dataset.currentRole);
      return;
    }

    const kickBtn = e.target.closest(".kick-member");
    if (kickBtn) {
      await kickMember(kickBtn.dataset.memberId, kickBtn.dataset.username ?? "ce membre");
    }
  });
}

export async function inviteUser() {
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

  await loadInvitations();
}

export async function loadInvitations() {
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
      <div class="veldex-panel p-5 flex flex-col md:flex-row md:items-center justify-between gap-5 animate-slide-up">
        <div class="space-y-1">
          <p class="font-display font-bold text-white text-lg uppercase tracking-wide leading-tight">${escapeHtml(corpName)}</p>
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 bg-accent rounded-full animate-pulse"></span>
            <p class="font-sans text-[10px] font-bold text-muted uppercase tracking-widest">INVITED BY: <span class="text-accent">${escapeHtml(invitedBy)}</span></p>
          </div>
        </div>
        <div class="flex gap-3">
          <button onclick="acceptInvitation(${invite.id})" class="veldex-btn-primary h-11 px-8 text-xs">ACCEPT</button>
          <button onclick="rejectInvitation(${invite.id})" class="veldex-btn-danger h-11 px-8 text-xs">REJECT</button>
        </div>
      </div>
    `;
  }).join("");
}

export async function acceptInvitation(invitationId) {
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

  store.currentCorporationId = invitation.corporation_id;
  setText("invitations-status", "Invitation acceptée.");
  triggerReload();
}

export async function rejectInvitation(invitationId) {
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
}
