import { supabase } from "./supabase.js";
import { $, setText, logger } from "../scripts/utils.js";

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    logger.error("Auth", "Session error:", error);
    return null;
  }

  return data.session?.user ?? null;
}

export async function signup() {
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
      data: { username },
    },
  });

  if (error) {
    setText("auth-status", "Erreur inscription : " + error.message);
    return;
  }

  setText("auth-status", "Compte créé. Connecte-toi ensuite.");
}

export async function login() {
  const email = $("emailInput")?.value.trim();
  const password = $("passwordInput")?.value.trim();
  const username = $("usernameInput")?.value.trim();

  if (!email || !password) {
    setText("auth-status", "Remplis email et mot de passe.");
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
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
        username: fallbackUsername,
      });

    if (profileError) {
      setText("auth-status", "Connecté, mais erreur profil : " + profileError.message);
      return;
    }
  }

  setText("auth-status", "Connecté. Redirection...");
  window.location.href = "index.html";
}

export async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    logger.error("Auth", "Logout error:", error);
    return;
  }

  window.location.href = "auth.html";
}

export async function requestPasswordReset() {
  const email = $("resetEmailInput")?.value.trim();

  if (!email) {
    setText("auth-status", "Veuillez entrer votre email.");
    return;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password.html`,
  });

  if (error) {
    setText("auth-status", "Erreur : " + error.message);
    return;
  }

  setText("auth-status", "Lien de réinitialisation envoyé ! Vérifiez vos emails.");
}

export async function handleUpdatePassword() {
  const newPassword = $("newPasswordInput")?.value.trim();
  const confirmPassword = $("confirmPasswordInput")?.value.trim();

  if (!newPassword || !confirmPassword) {
    setText("reset-status", "Remplissez tous les champs.");
    return;
  }

  if (newPassword.length < 8) {
    setText("reset-status", "Le mot de passe doit faire au moins 8 caractères.");
    return;
  }

  if (newPassword !== confirmPassword) {
    setText("reset-status", "Les mots de passe ne correspondent pas.");
    return;
  }

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) {
    setText("reset-status", "Erreur : " + error.message);
    return;
  }

  setText("reset-status", "Mot de passe mis à jour ! Redirection...");
  setTimeout(() => {
    window.location.href = "auth.html";
  }, 3000);
}

export async function initAuthPage() {
  $("loginBtn")?.addEventListener("click", login);
  $("signupBtn")?.addEventListener("click", signup);
  $("logoutBtn")?.addEventListener("click", logout);
  $("sendResetLinkBtn")?.addEventListener("click", requestPasswordReset);
  $("updatePasswordBtn")?.addEventListener("click", handleUpdatePassword);

  const user = await getCurrentUser();

  if (user) {
    setText("auth-status", "Session active.");
  } else {
    setText("auth-status", "Non connecté.");
  }
}