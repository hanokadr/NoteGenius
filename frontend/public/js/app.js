"use strict";

const $ = (id) => document.getElementById(id);
// Backend address comes from config.js
const API_BASE = ((window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "http://127.0.0.1:5000").replace(/\/$/, "");
const MAX_CHARS = Number($("noteText").dataset.max) || 12000;

// What is currently on screen
const state = { source: null, result: null, noteId: null, busy: false, saving: false };
let searchTimer = null;
let messageTimer = null;

/* ---------- Small helpers ---------- */

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, { ...options, headers: typeof options.body === "string" ? { "Content-Type": "application/json" } : {} });
  } catch {
    throw new Error("Cannot reach the NoteGenius backend. Make sure it is running and API_BASE_URL in config.js is correct.");
  }
  let data = {};
  try { data = await response.json(); } catch { /* ignore */ }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function showMessage(text, type = "error") {
  const box = $("message");
  clearTimeout(messageTimer);
  if (!text) { box.hidden = true; return; }
  box.textContent = text;
  box.className = `message ${type}`;
  box.hidden = false;
  messageTimer = setTimeout(() => { box.hidden = true; }, type === "success" ? 5000 : 12000);
}

function setStatus(kind, text) {
  $("aiStatus").className = `status ${kind}`;
  $("aiStatusText").textContent = text;
}

function makeButton(label, className, onClick, ariaLabel) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  if (ariaLabel) btn.setAttribute("aria-label", ariaLabel);
  btn.addEventListener("click", onClick);
  return btn;
}

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";

function setDrawer(open) {
  $("sidebar").classList.toggle("open", open);
  $("menuBtn").setAttribute("aria-expanded", String(open));
}

/* ---------- Showing results (all text uses textContent, never innerHTML) ---------- */

function setSaved(saved) {
  $("saveBtn").disabled = saved;
  $("saveBtn").textContent = saved ? "Saved ✓" : "Save Notes";
}

function renderResult(result, saved) {
  $("summaryText").textContent = result.summary;

  const points = $("pointsList");
  points.replaceChildren();
  for (const point of result.key_points) {
    const li = document.createElement("li");
    li.textContent = point;
    points.appendChild(li);
  }

  const concepts = $("conceptsList");
  concepts.replaceChildren();
  if (result.important_concepts.length === 0) {
    const dd = document.createElement("dd");
    dd.textContent = "No concepts were returned for these notes.";
    concepts.appendChild(dd);
  }
  for (const item of result.important_concepts) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = item.term;
    dd.textContent = item.explanation;
    concepts.append(dt, dd);
  }

  $("conclusionText").textContent = result.conclusion || "No conclusion was returned.";
  $("results").hidden = false;
  setSaved(saved);
}

function pickResult(data) {
  return {
    summary: data.summary,
    key_points: data.key_points,
    important_concepts: data.important_concepts,
    conclusion: data.conclusion,
  };
}

function updateCounter() {
  const length = $("noteText").value.length;
  $("charCount").textContent = `${length} / ${MAX_CHARS}`;
  $("charCount").classList.toggle("warn", length > MAX_CHARS * 0.9);
}

function resetAll() {
  $("noteTitle").value = "";
  $("noteText").value = "";
  $("results").hidden = true;
  Object.assign(state, { source: null, result: null, noteId: null });
  updateCounter();
  showMessage("");
  setDrawer(false);
  loadNotes();
  $("noteTitle").focus();
}

/* ---------- Summarize ---------- */

function setBusy(on, text = "Generating your summary. This can take a minute.") {
  state.busy = on;
  $("summarizeBtn").disabled = on;
  $("fileInput").disabled = on;
  $("loadingText").textContent = text;
  $("loading").hidden = !on;
}

function summarize(event) {
  event.preventDefault();
  summarizeCurrent();
}

async function summarizeCurrent(notice = "") {
  if (state.busy) return;

  const title = $("noteTitle").value.trim();
  const text = $("noteText").value.trim();
  if (!title) { showMessage("Please enter a title for your notes."); $("noteTitle").focus(); return; }
  if (!text) { showMessage("Please paste your study notes or upload a file first."); $("noteText").focus(); return; }

  showMessage("");
  setBusy(true);
  $("results").hidden = true;
  setStatus("busy", "AI is working…");

  try {
    const data = await api("/api/summarize", {
      method: "POST",
      body: JSON.stringify({ title, original_text: text }),
    });
    state.source = { title, text };
    state.result = pickResult(data);
    state.noteId = null;
    renderResult(state.result, false);
    setStatus("ok", "Summary ready");
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
    let saved = false;
    if ($("autoSave").checked) {
      $("loadingText").textContent = "Saving to MongoDB…";
      saved = await saveNote();
    }
    if (notice) showMessage(saved ? `${notice} The note was saved.` : notice, "warn");
  } catch (err) {
    showMessage(err.message);
    setStatus("error", "AI unavailable");
  } finally {
    setBusy(false);
  }
}

/* ---------- Save, copy ---------- */

async function saveNote() {
  if (!state.result || !state.source || state.saving || state.noteId) return false;
  state.saving = true;
  $("saveBtn").disabled = true;
  $("saveBtn").textContent = "Saving…";

  try {
    const data = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: state.source.title, original_text: state.source.text, ...state.result }),
    });
    state.noteId = data.id;
    setSaved(true);
    const hint = window.matchMedia("(max-width: 900px)").matches ? " Open the ☰ menu to see it in Saved notes." : "";
    showMessage(data.message + hint, "success");   // shown only after MongoDB confirmed the save
    await loadNotes();
    return true;
  } catch (err) {
    showMessage("Not saved: " + err.message);
    setSaved(false);
    return false;
  } finally {
    state.saving = false;
  }
}

async function copySummary() {
  if (!state.result) return;
  const r = state.result;
  const concepts = r.important_concepts.map((c) => `- ${c.term}: ${c.explanation}`);
  const text = [r.summary, "", "Key points:", ...r.key_points.map((p) => `- ${p}`), "", "Important concepts:", ...concepts, "", `Conclusion: ${r.conclusion}`].join("\n");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const temp = document.createElement("textarea");   // fallback for older browsers
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    const ok = document.execCommand("copy");
    temp.remove();
    if (!ok) { showMessage("Could not copy. Please select the text and copy it manually."); return; }
  }
  showMessage("Summary copied to the clipboard.", "success");
}

/* ---------- Saved notes ---------- */

function renderNotes(notes, query) {
  const list = $("notesList");
  list.replaceChildren();
  const empty = $("notesEmpty");
  empty.hidden = notes.length > 0;
  empty.textContent = query
    ? "No saved notes match your search."
    : "No saved notes yet. Summarize some notes and click Save Notes.";

  for (const note of notes) {
    const li = document.createElement("li");
    li.className = "note-item" + (note.id === state.noteId ? " active" : "");

    const title = document.createElement("h3");
    title.textContent = note.title;
    const time = document.createElement("time");
    time.dateTime = note.created_at || "";
    time.textContent = formatDate(note.created_at);
    const preview = document.createElement("p");
    preview.textContent = note.preview;

    const actions = document.createElement("div");
    actions.className = "note-actions";
    actions.append(
      makeButton("Open", "btn small", () => openNote(note.id), `Open ${note.title}`),
      makeButton("Delete", "btn small danger", () => deleteNote(note.id, note.title), `Delete ${note.title}`),
    );

    li.append(title, time, preview, actions);
    list.appendChild(li);
  }
}

async function loadNotes() {
  const query = $("searchInput").value.trim();
  try {
    const data = await api(`/api/notes?q=${encodeURIComponent(query)}`);
    renderNotes(data.notes, query);
  } catch (err) {
    showMessage(err.message);
  }
}

async function openNote(id) {
  try {
    const note = await api(`/api/notes/${encodeURIComponent(id)}`);   // from MongoDB, no AI call
    $("noteTitle").value = note.title;
    $("noteText").value = note.original_text;
    updateCounter();
    state.source = { title: note.title, text: note.original_text };
    state.result = pickResult(note);
    state.noteId = note.id;
    renderResult(state.result, true);
    showMessage("");
    setDrawer(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    loadNotes();
  } catch (err) {
    showMessage(err.message);
    loadNotes();
  }
}

async function deleteNote(id, title) {
  if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
  try {
    await api(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (state.noteId === id) { state.noteId = null; if (state.result) setSaved(false); }
    showMessage("Note deleted.", "success");
  } catch (err) {
    showMessage(err.message);
  }
  loadNotes();
}

/* ---------- File upload ---------- */

const ALLOWED_EXTENSIONS = [".txt", ".md", ".pdf", ".docx"];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
let lastAutoTitle = "";

async function handleFile(file) {
  if (!file || state.busy) return;
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    showMessage("Unsupported file type. Upload a .txt, .md, .pdf or .docx file.");
    return;
  }
  if (file.size === 0) { showMessage("The file is empty."); return; }
  if (file.size > MAX_UPLOAD_BYTES) { showMessage("The file is too large (maximum 20 MB)."); return; }

  showMessage("");
  setBusy(true, "Reading your file…");
  setStatus("busy", "Reading file…");

  let data;
  try {
    const form = new FormData();
    form.append("file", file);
    data = await api("/api/upload", { method: "POST", body: form });
  } catch (err) {
    setBusy(false);
    setStatus("error", "Upload failed");
    showMessage(err.message);
    return;
  }
  setBusy(false);

  const titleBox = $("noteTitle");
  if (!titleBox.value.trim() || titleBox.value === lastAutoTitle) {
    titleBox.value = data.title;
    lastAutoTitle = data.title;
  }
  $("noteText").value = data.text;
  updateCounter();
  $("results").hidden = true;
  Object.assign(state, { source: null, result: null, noteId: null });
  loadNotes();

  const notice = data.truncated ? `The file is long, so only the first ${MAX_CHARS} characters were summarized.` : "";
  await summarizeCurrent(notice);
}

/* ---------- Wire up the page ---------- */

$("message").addEventListener("click", () => showMessage(""));
$("noteForm").addEventListener("submit", summarize);
$("fileInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";                       // lets you pick the same file again later
  handleFile(file);
});
const dropZone = $("dropZone");
["dragenter", "dragover"].forEach((type) => dropZone.addEventListener(type, (e) => {
  e.preventDefault();
  dropZone.classList.add("over");
}));
["dragleave", "drop"].forEach((type) => dropZone.addEventListener(type, (e) => {
  e.preventDefault();
  dropZone.classList.remove("over");
}));
dropZone.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
// Stop the browser from opening a file that is dropped outside the drop area
["dragover", "drop"].forEach((type) => window.addEventListener(type, (e) => e.preventDefault()));
$("noteText").addEventListener("input", updateCounter);
$("saveBtn").addEventListener("click", saveNote);
$("copyBtn").addEventListener("click", copySummary);
$("clearBtn").addEventListener("click", resetAll);
$("againBtn").addEventListener("click", resetAll);
$("newBtn").addEventListener("click", resetAll);
$("menuBtn").addEventListener("click", () => setDrawer(!$("sidebar").classList.contains("open")));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setDrawer(false); });
$("searchInput").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadNotes, 300);
});

updateCounter();
loadNotes();
