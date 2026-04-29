export function initModalContainer() {
  let container = document.getElementById("modal-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "modal-container";
    document.body.appendChild(container);
  }
}

export function showAlert(title, message) {
  return new Promise((resolve) => {
    initModalContainer();
    const container = document.getElementById("modal-container");

    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity";
    
    overlay.innerHTML = `
      <div class="bg-panel border border-line rounded-xl shadow-2xl max-w-sm w-full p-6 transform transition-all">
        <h3 class="text-xl font-bold text-white mb-2">${title}</h3>
        <p class="text-muted mb-6 text-sm">${message}</p>
        <div class="flex justify-end">
          <button class="bg-accent hover:bg-cyan-400 text-black px-4 py-2 rounded font-medium text-sm transition-colors w-full sm:w-auto">
            OK
          </button>
        </div>
      </div>
    `;

    const btn = overlay.querySelector("button");
    btn.addEventListener("click", () => {
      overlay.remove();
      resolve();
    });

    container.appendChild(overlay);
  });
}

export function showConfirm(title, message, confirmText = "Confirmer", cancelText = "Annuler") {
  return new Promise((resolve) => {
    initModalContainer();
    const container = document.getElementById("modal-container");

    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity";
    
    overlay.innerHTML = `
      <div class="bg-panel border border-line rounded-xl shadow-2xl max-w-sm w-full p-6 transform transition-all">
        <h3 class="text-xl font-bold text-white mb-2">${title}</h3>
        <p class="text-muted mb-6 text-sm">${message}</p>
        <div class="flex justify-end gap-3 flex-wrap sm:flex-nowrap">
          <button id="modal-cancel-btn" class="bg-panel2 hover:bg-line border border-line text-white px-4 py-2 rounded font-medium text-sm transition-colors w-full sm:w-auto">
            ${cancelText}
          </button>
          <button id="modal-confirm-btn" class="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded font-medium text-sm transition-colors w-full sm:w-auto">
            ${confirmText}
          </button>
        </div>
      </div>
    `;

    const cancelBtn = overlay.querySelector("#modal-cancel-btn");
    const confirmBtn = overlay.querySelector("#modal-confirm-btn");

    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(false);
    });

    confirmBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(true);
    });

    container.appendChild(overlay);
  });
}
export function showPrompt(title, message, placeholder = "") {
  return new Promise((resolve) => {
    initModalContainer();
    const container = document.getElementById("modal-container");

    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity";
    
    overlay.innerHTML = `
      <div class="bg-panel border border-line rounded-xl shadow-2xl max-w-sm w-full p-6 transform transition-all">
        <h3 class="text-xl font-bold text-white mb-2">${title}</h3>
        <p class="text-muted mb-4 text-sm">${message}</p>
        <input type="text" id="modal-prompt-input" placeholder="${placeholder}" class="veldex-input w-full mb-6" autofocus>
        <div class="flex justify-end gap-3">
          <button id="modal-cancel-btn" class="bg-panel2 hover:bg-line border border-line text-white px-4 py-2 rounded font-medium text-sm transition-colors flex-1">
            Annuler
          </button>
          <button id="modal-confirm-btn" class="bg-accent hover:bg-cyan-400 text-black px-4 py-2 rounded font-medium text-sm transition-colors flex-1">
            Créer
          </button>
        </div>
      </div>
    `;

    const input = overlay.querySelector("#modal-prompt-input");
    const cancelBtn = overlay.querySelector("#modal-cancel-btn");
    const confirmBtn = overlay.querySelector("#modal-confirm-btn");

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    cancelBtn.addEventListener("click", () => close(null));
    confirmBtn.addEventListener("click", () => close(input.value.trim()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") close(input.value.trim());
      if (e.key === "Escape") close(null);
    });

    container.appendChild(overlay);
    setTimeout(() => input.focus(), 100);
  });
}
