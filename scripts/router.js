import { supabase } from "../services/supabase.js";
import { $, setText, getCurrentUser, logger } from "./utils.js";
import { updateHeader } from "../components/header.js";

const VIEW_TITLES = {
  "view-dashboard": ["Dashboard", "Vue globale"],
  "view-inventory": ["Inventory", "Gestion des ressources"],
  "view-corporation": ["Corporation", "Membres et Invitations"]
};

// ==================================================
// NAVIGATION UI
// ==================================================
export function showView(viewId) {
  // Handle OCR Scanner special case
  let targetViewId = viewId;
  let scrollToOcr = false;
  if (viewId === "view-ocr") {
    targetViewId = "view-inventory";
    scrollToOcr = true;
  }

  document.querySelectorAll(".view-section").forEach((section) => {
    section.classList.add("hidden");
  });

  const target = $(targetViewId);
  if (target) target.classList.remove("hidden");

  // Toggle dashboard layout class
  if (targetViewId === "view-dashboard") {
    document.body.classList.add("is-dashboard");
  } else {
    document.body.classList.remove("is-dashboard");
  }

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  document.querySelectorAll(`.nav-btn[data-view="${viewId}"]`).forEach((btn) => {
    btn.classList.add("active");
  });

  const [title, subtitle] = VIEW_TITLES[targetViewId] || ["Veldex", "Mining Tool"];
  updateHeader(title, subtitle);

  if (scrollToOcr) {
    setTimeout(() => {
      const ocrSec = $("ocr-section");
      if (ocrSec) ocrSec.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  // Notify other components that view has changed
  window.dispatchEvent(new CustomEvent("view-changed", { detail: { viewId: targetViewId } }));
}

export function initNavigation() {
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
      data: { username }
    }
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

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    logger.error("Auth", "Logout error:", error);
    return;
  }
  window.location.href = "auth.html";
}

export async function initAuthPage() {
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