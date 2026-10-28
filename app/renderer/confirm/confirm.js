/**
 * Confirmation dialog renderer — dangerous-open prompt, spec section 3.7.
 *
 * All data comes through the preload API (window.orbit).
 * This file never touches node APIs.
 */
// ---- DOM refs ----
const api = window.orbit;
const dialog = document.getElementById('confirm');
const titleEl = document.getElementById('confirm-title');
const extTag = document.getElementById('ext-tag');
const fileName = document.getElementById('file-name');
const bodyEl = document.getElementById('confirm-body');
const notepadLink = document.getElementById('notepad-link');
const btnCancel = document.getElementById('btn-cancel');
const btnAction = document.getElementById('btn-action');
// ---- Helpers ----
function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// ---- Render ----
function show(data) {
    titleEl.textContent = data.title;
    extTag.textContent = data.extLabel;
    fileName.textContent = data.fileName;
    // Build description with "run it" bolded
    let descHtml = escapeHtml(data.description);
    descHtml = descHtml.replace(/run it/gi, '<strong>run it</strong>');
    // Append MOTW line if applicable
    if (data.hasMotw) {
        descHtml += ' This file was downloaded from the internet and may be unsafe.';
    }
    bodyEl.innerHTML = descHtml;
    // Notepad link for script types only
    if (data.showNotepadLink) {
        notepadLink.style.display = '';
    }
    else {
        notepadLink.style.display = 'none';
    }
    // Action button label
    btnAction.textContent = data.actionLabel;
    dialog.style.display = '';
    // Cancel is focused by default (Enter = Cancel)
    btnCancel.focus();
}
// ---- Event wiring ----
api.onShow(show);
btnCancel.addEventListener('click', () => {
    api.cancel();
});
btnAction.addEventListener('click', () => {
    api.confirm();
});
notepadLink.addEventListener('click', (e) => {
    e.preventDefault();
    api.openInNotepad();
});
// Esc = Cancel
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        e.preventDefault();
        api.cancel();
    }
});
