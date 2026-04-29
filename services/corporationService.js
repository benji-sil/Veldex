import { supabase } from "./supabase.js";
import { appState } from "../scripts/store.js";
import { $, setText, escapeHtml, logger } from "../scripts/utils.js";

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

export async function createCorporation(reloadAllData) {
  const user = appState.currentUser;
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
      owner_id: user.id,
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
      role: "owner",
    });

  if (memberError) {
    setText("corp-status", "Corporation créée, mais erreur membre : " + memberError.message);
    return;
  }

  setText("corp-status", "Corporation créée avec succès.");
  $("corp-name").value = "";
  appState.currentCorporationId = corpData.id;

  await reloadAllData();
}

export async function loadMyCorporation() {
  const user = appState.currentUser;
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
    member: "LEVEL 1 — MEMBRE",
  };

  setText("user-clearance", clearanceMap[role] ?? "LEVEL 1 MEMBER");
}

export async function updateCorpStats() {
  const user = appState.currentUser;
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

export function getRoleLabel(role) {
  const roleMap = {
    owner: "Directeur",
    admin: "Chef d'équipe",
    member: "Membre",
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

  if (!appState.currentUser || !appState.currentCorporationId) {
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
    .eq("user_id", appState.currentUser.id)
    .eq("corporation_id", appState.currentCorporationId)
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
    .eq("corporation_id", appState.currentCorporationId);

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

  membersBody.innerHTML = data
    .map((member) => {
      const username = member.profiles?.username ?? "Inconnu";

      let actionHtml = `<span class="text-muted">-</span>`;

      if (myRole === "owner" && member.user_id !== appState.currentUser.id) {
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
    })
    .join("");
}

export async function promoteMember(memberId, currentRole) {
  if (!appState.currentUser || !appState.currentCorporationId) return;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", appState.currentUser.id)
    .eq("corporation_id", appState.currentCorporationId)
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

  const { data, error } = await supabase
    .from("corporation_members")
    .update({ role: nextRole })
    .eq("id", memberId)
    .eq("corporation_id", appState.currentCorporationId)
    .select();


  if (error) {
    alert("Erreur lors de la promotion : " + error.message);
    return;
  }

  await loadCorporationMembers();
}

export async function demoteMember(memberId, currentRole) {
  if (!appState.currentUser || !appState.currentCorporationId) return;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", appState.currentUser.id)
    .eq("corporation_id", appState.currentCorporationId)
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
    .eq("corporation_id", appState.currentCorporationId);

  if (error) {
    logger.error("Corporation", "Demote error:", error);
    alert("Erreur lors de la dépromotion.");
    return;
  }

  await loadCorporationMembers();
}

export async function kickMember(memberId, username) {
  if (!appState.currentUser || !appState.currentCorporationId) return;

  const confirmed = window.confirm(`Expulser ${username} de la corporation ?`);
  if (!confirmed) return;

  const { data: myMembership, error: myMembershipError } = await supabase
    .from("corporation_members")
    .select("role")
    .eq("user_id", appState.currentUser.id)
    .eq("corporation_id", appState.currentCorporationId)
    .single();

  if (myMembershipError || !myMembership || myMembership.role !== "owner") {
    alert("Seul le directeur peut expulser un membre.");
    return;
  }

  const { data: targetMember, error: targetError } = await supabase
    .from("corporation_members")
    .select("role, user_id")
    .eq("id", memberId)
    .eq("corporation_id", appState.currentCorporationId)
    .single();

  if (targetError || !targetMember) {
    alert("Membre introuvable.");
    return;
  }

  if (targetMember.user_id === appState.currentUser.id) {
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
    .eq("corporation_id", appState.currentCorporationId);

  if (error) {
    logger.error("Corporation", "Kick error:", error);
    alert("Erreur lors de l'expulsion.");
    return;
  }

  await loadCorporationMembers();
  await updateCorpStats();
}

export function bindCorporationMembersActions() {
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