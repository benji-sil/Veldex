import { supabase } from "../services/supabase.js";
const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

export const logger = {
  log: (...args) => {
    if (isDev) console.log(...args);
  },
  warn: (...args) => {
    if (isDev) console.warn(...args);
  },
  error: (module, ...args) => {
    console.error(`[${module} Error]`, ...args);
  }
};

// ==================================================
// HELPERS
// ==================================================
export function $(id) {
  return document.getElementById(id);
}

export function setText(id, message) {
  const el = $(id);
  if (el) el.textContent = message;
}

export function isDashboardPage() {
  return !!$("dashboard-page");
}

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    logger.error("System", "Session error:", error);
    return null;
  }
  return data.session?.user ?? null;
}

export function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatUnit(unit) {
  if (unit === "scu") return "SCU";
  if (unit === "unit") return "UNIT";
  return unit ?? "-";
}

export function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-CA");
}

export function showFormError(message) {
  const formMessage = $("form-message");
  if (!formMessage) return;
  formMessage.textContent = message;
  formMessage.className = "text-sm text-red-400";
}

export function showFormSuccess(message) {
  const formMessage = $("form-message");
  if (!formMessage) return;
  formMessage.textContent = message;
  formMessage.className = "text-sm text-green-400";
}

export function isAuthPage() {
  return !!$("auth-page");
}

export function showToast(message, type = "success") {
  const container = $("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const bgColor = type === "success" ? "bg-green-500/20 border-green-500/50 text-green-400" : "bg-red-500/20 border-red-500/50 text-red-400";
  
  toast.className = `flex items-center gap-2 px-4 py-3 rounded-sm border ${bgColor} backdrop-blur-md transition-all duration-300 transform translate-y-4 opacity-0 pointer-events-auto shadow-lg`;
  
  toast.innerHTML = `
    <span class="font-sans text-sm font-medium">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.remove("translate-y-4", "opacity-0");
  });

  // Auto remove
  setTimeout(() => {
    toast.classList.add("translate-y-4", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export async function fetchGameVersions() {
  try {
    const resp = await fetch("https://api.uexcorp.space/2.0/game_versions");
    if (!resp.ok) throw new Error("API response not ok");
    const json = await resp.json();
    
    const live = json?.live ?? json?.data?.live ?? "N/A";
    const ptu = json?.ptu ?? json?.data?.ptu ?? "N/A";
    
    window.VELDEX_GAME_VERSIONS = { live, ptu, status: "ok" };
    return { live, ptu, status: "ok" };
  } catch (err) {
    logger.error("System", "Fetch game versions failed:", err);
    window.VELDEX_GAME_VERSIONS = { live: "N/A", ptu: "N/A", status: "error" };
    return { live: "N/A", ptu: "N/A", status: "error" };
  }
}