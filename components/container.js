export function renderPanel(contentHtml, customClasses = "") {
  return `<section class="bg-panel border border-line rounded-xl p-6 ${customClasses}">${contentHtml}</section>`;
}
