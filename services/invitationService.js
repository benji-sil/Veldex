import { supabase } from "./supabase.js";
import { appState } from "../scripts/store.js";
import { $, setText, escapeHtml } from "../scripts/utils.js";

export async function inviteUser(reloadAllData) {
  const user = appState.currentUser;
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
      invited_by_user_id: user.id,
    });

  if (inviteError) {
    setText("invite-status", "Erreur invitation : " + inviteError.message);
    return;
  }

  setText("invite-status", "Invitation envoyée.");
  $("invite-username").value = "";

  await reloadAllData();
}

export async function loadInvitations() {
  const user = appState.currentUser;
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

  invitationsList.innerHTML = data
    .map((invite) => {
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
    })
    .join("");
}

export async function acceptInvitation(invitationId, reloadAllData) {
  const user = appState.currentUser;
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
      role: "member",
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

  appState.currentCorporationId = invitation.corporation_id;
  setText("invitations-status", "Invitation acceptée.");

  await reloadAllData();
}

export async function rejectInvitation(invitationId) {
  const user = appState.currentUser;
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