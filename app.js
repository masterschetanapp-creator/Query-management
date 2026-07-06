import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import {
  initQueries,
  renderQueries,
  openQueryBuilder,
  closeQueryBuilder,
  saveQuery,
  applyCurrentQuery,
  applySavedQuery,
  editSavedQuery,
  duplicateSavedQuery,
  deleteSavedQuery,
  addQueryCondition,
  removeQueryCondition,
  getActiveQuery,
  clearActiveQuery,
  evaluateQuery,
} from './queries.js';

window.openQueryBuilder = openQueryBuilder;
window.closeQueryBuilder = closeQueryBuilder;
window.saveQuery = saveQuery;
window.applyCurrentQuery = applyCurrentQuery;
window.applySavedQuery = applySavedQuery;
window.editSavedQuery = editSavedQuery;
window.duplicateSavedQuery = duplicateSavedQuery;
window.deleteSavedQuery = deleteSavedQuery;
window.addQueryCondition = addQueryCondition;
window.removeQueryCondition = removeQueryCondition;
window.clearActiveQuery = clearActiveQuery;

let leads = [];
let editingId = null;
const pageSize = 25;
let unsubscribeLeads = null;
let authInitialized = false;

const state = { q: "", status: "", product: "", source: "", due: "", page: 1 };
window.state = state;

const today = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (s) => String(s ?? "").trim();

function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  document.getElementById("toasts").appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function showAuth() {
  document.getElementById("authOverlay").classList.add("open");
  document.getElementById("authError").textContent = "";
}
function hideAuth() {
  document.getElementById("authOverlay").classList.remove("open");
}
function showApp() {
  document.getElementById("appContainer").style.display = "block";
}
function hideApp() {
  document.getElementById("appContainer").style.display = "none";
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    hideAuth();
    showApp();
    if (!authInitialized) {
      authInitialized = true;
      setupLeadsListener();
      initQueries();
    }
  } else {
    showAuth();
    hideApp();
  }
});

async function handleSignIn() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPass").value;
  const errorEl = document.getElementById("authError");
  if (!email || !password) {
    errorEl.textContent = "Please enter email and password.";
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
    errorEl.textContent = "";
  } catch (e) {
    const msg =
      e.code === "auth/user-not-found"
        ? "User not found. Add the user in Firebase Console → Authentication."
        : e.code === "auth/wrong-password" || e.code === "auth/invalid-credential"
          ? "Incorrect password."
          : e.code === "auth/invalid-email"
            ? "Invalid email format."
            : e.code === "auth/too-many-requests"
              ? "Too many attempts. Try again later."
              : "Sign-in failed: " + e.message;
    errorEl.textContent = msg;
  }
}

window.handleSignIn = handleSignIn;

async function handleSignOut() {
  try {
    if (unsubscribeLeads) unsubscribeLeads();
    await signOut(auth);
    leads = [];
    authInitialized = false;
  } catch (e) {
    console.error("Sign out failed", e);
  }
}

window.handleSignOut = handleSignOut;

function handleKeyDown(e) {
  if (e.key === "Enter") handleSignIn();
}

window.handleKeyDown = handleKeyDown;

function setupLeadsListener() {
  if (unsubscribeLeads) unsubscribeLeads();
  unsubscribeLeads = onSnapshot(
    collection(db, "leads"),
    (snapshot) => {
      leads = [];
      snapshot.forEach((d) => {
        leads.push({ id: d.id, ...d.data() });
      });
      render();
    },
    (err) => {
      console.error("Leads listener error", err);
      toast("Firestore sync error: " + err.message, "err");
    },
  );
}

function stats() {
  const t = today();
  let converted = 0,
    follow = 0,
    overdue = 0,
    dueToday = 0,
    open = 0;
  for (const l of leads) {
    const st = norm(l.status).toLowerCase();
    if (st.includes("convert")) converted++;
    else open++;
    if (st.includes("follow")) follow++;
    if (l.followupDate) {
      if (l.followupDate < t && !st.includes("convert") && !st.includes("not")) overdue++;
      if (l.followupDate === t) dueToday++;
    }
  }
  return { total: leads.length, converted, follow, overdue, dueToday, open };
}

function fillFilters() {
  fillSelect(
    document.getElementById("statusFilter"),
    [...new Set(leads.map((l) => norm(l.status)).filter(Boolean))],
    state.status,
    "All Status",
  );
  fillSelect(
    document.getElementById("productFilter"),
    [...new Set(leads.map((l) => norm(l.product)).filter(Boolean))],
    state.product,
    "All Products",
  );
  fillSelect(
    document.getElementById("sourceFilter"),
    [...new Set(leads.map((l) => norm(l.source)).filter(Boolean))],
    state.source,
    "All Sources",
  );
  fillList(document.getElementById("sourceList"), leads.map((l) => l.source));
  fillList(document.getElementById("productList"), leads.map((l) => l.product));
  fillList(document.getElementById("statusList"), leads.map((l) => l.status));
}

function fillSelect(el, vals, current, label) {
  el.innerHTML =
    '<option value="">' +
    label +
    "</option>" +
    vals
      .sort()
      .map((v) => `<option ${v === current ? "selected" : ""}>${esc(v)}</option>`)
      .join("");
}

function fillList(el, vals) {
  el.innerHTML = [...new Set(vals.map(norm).filter(Boolean))]
    .sort()
    .map((v) => `<option value="${esc(v)}"></option>`)
    .join("");
}

function filtered() {
  const q = state.q;
  const t = today();
  const activeQuery = getActiveQuery();

  return leads
    .filter((l) => {
      if (!activeQuery) {
        if (state.status && l.status !== state.status) return false;
        if (state.product && l.product !== state.product) return false;
        if (state.source && l.source !== state.source) return false;
        if (state.due === "today" && l.followupDate !== t) return false;
        if (state.due === "overdue" && (!l.followupDate || l.followupDate >= t)) return false;
        if (state.due === "upcoming" && (!l.followupDate || l.followupDate < t)) return false;
        if (state.due === "none" && l.followupDate) return false;
      }
      if (activeQuery && !evaluateQuery(l, activeQuery)) return false;
      if (q && !Object.values(l).join(" ").toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => (a.followupDate || "9999").localeCompare(b.followupDate || "9999"));
}

function render() {
  window.leads = leads;
  fillFilters();
  const s = stats();
  document.getElementById("hTotal").textContent = s.total;
  document.getElementById("cTotal").textContent = s.total;
  document.getElementById("hOpen").textContent = s.open;
  document.getElementById("cOpen").textContent = s.open;
  document.getElementById("hFollow").textContent = s.follow;
  document.getElementById("hConverted").textContent = s.converted;
  document.getElementById("cConverted").textContent = s.converted;
  document.getElementById("cOverdue").textContent = s.overdue;
  document.getElementById("cToday").textContent = s.dueToday;
  document.getElementById("saveStatus").textContent =
    "Syncing via Firebase — " + leads.length + " leads";

  const data = filtered();
  const pages = Math.max(1, Math.ceil(data.length / pageSize));
  state.page = Math.min(state.page, pages);
  const part = data.slice((state.page - 1) * pageSize, state.page * pageSize);
  document.getElementById("rows").innerHTML =
    part.map(rowHtml).join("") ||
    '<tr><td colspan="10" style="text-align:center;color:#6b7b88;padding:28px">No leads found</td></tr>';
  document.getElementById("pageInfo").textContent =
    "Page " + state.page + " of " + pages + " - " + data.length + " lead" + (data.length === 1 ? "" : "s");

  renderQueries();
}

window.render = render;

function rowHtml(l) {
  const st = norm(l.status);
  return `<tr><td>${esc(l.sno)}</td><td class="name">${esc(l.leadName)}<br><span style="font-weight:400;color:#6b7b88">${esc(l.emailId)}</span></td><td>${esc(l.contactNumber)}</td><td>${fmt(l.inquiryDate)}</td><td>${esc(l.source)}</td><td>${esc(l.product)}</td><td><span class="pill ${pill(st)}">${esc(st || "Open")}</span></td><td>${fmt(l.followupDate)}</td><td class="note">${esc(l.notes)}</td><td><button class="btn gray" onclick="window.openLead('${l.id}')">Edit</button></td></tr>`;
}

function pill(st) {
  st = st.toLowerCase();
  if (st.includes("convert")) return "converted";
  if (st.includes("follow")) return "follow";
  if (st.includes("not")) return "not";
  if (st.includes("w8") || st.includes("wait")) return "wait";
  return "";
}

function fmt(s) {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}-${m}-${y}`;
  }
  return esc(s);
}

function prevPage() {
  if (state.page > 1) {
    state.page--;
    render();
  }
}
function nextPage() {
  state.page++;
  render();
}

window.prevPage = prevPage;
window.nextPage = nextPage;

function openLead(id = "") {
  editingId = id;
  const l = leads.find((x) => x.id === id) || {};
  document.getElementById("modalTitle").textContent = id ? "Edit Lead" : "Add Lead";
  document.getElementById("deleteBtn").style.display = id ? "inline-block" : "none";
  document.getElementById("fName").value = l.leadName || "";
  document.getElementById("fPhone").value = l.contactNumber || "";
  document.getElementById("fEmail").value = l.emailId || "";
  document.getElementById("fInquiry").value = l.inquiryDate || "";
  document.getElementById("fSource").value = l.source || "";
  document.getElementById("fProduct").value = l.product || "";
  document.getElementById("fStatus").value = l.status || "";
  document.getElementById("fFollow").value = l.followupDate || "";
  document.getElementById("fNotes").value = l.notes || "";
  document.getElementById("leadModal").classList.add("open");
  setTimeout(() => document.getElementById("fName").focus(), 50);
}

window.openLead = openLead;

function closeLead() {
  document.getElementById("leadModal").classList.remove("open");
}

window.closeLead = closeLead;

async function saveLead() {
  const name = norm(document.getElementById("fName").value);
  if (!name) {
    toast("Lead name is required", "err");
    return;
  }
  const id = editingId || "l_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  const rec = {
    leadName: name,
    contactNumber: norm(document.getElementById("fPhone").value),
    emailId: norm(document.getElementById("fEmail").value),
    inquiryDate: document.getElementById("fInquiry").value,
    source: norm(document.getElementById("fSource").value),
    product: norm(document.getElementById("fProduct").value),
    status: norm(document.getElementById("fStatus").value) || "Follow-up",
    followupDate: document.getElementById("fFollow").value,
    notes: norm(document.getElementById("fNotes").value),
    updatedAt: serverTimestamp(),
  };

  if (!editingId) {
    rec.sno = String(leads.length + 1);
    rec.createdAt = serverTimestamp();
  }

  try {
    await setDoc(doc(db, "leads", id), rec, { merge: true });
    closeLead();
    toast("Lead saved", "ok");
  } catch (e) {
    toast("Save failed: " + e.message, "err");
    console.error("Save error", e);
  }
}

window.saveLead = saveLead;

async function deleteLead() {
  if (!editingId) return;
  if (!confirm("Delete this lead?")) return;
  try {
    await deleteDoc(doc(db, "leads", editingId));
    closeLead();
    toast("Lead deleted");
  } catch (e) {
    toast("Delete failed: " + e.message, "err");
    console.error("Delete error", e);
  }
}

window.deleteLead = deleteLead;

function exportCSV() {
  const cols = [
    "S.No",
    "Lead Name",
    "Contact Number",
    "Email ID",
    "Date of Inquiry",
    "Source of Reference",
    "Product Interested",
    "Lead Status",
    "Follow-up Date",
    "Notes/Remarks",
  ];
  const data = filtered().map((l) => [
    l.sno,
    l.leadName,
    l.contactNumber,
    l.emailId,
    l.inquiryDate,
    l.source,
    l.product,
    l.status,
    l.followupDate,
    l.notes,
  ]);
  const csv = [cols, ...data]
    .map((r) => r.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(","))
    .join("\r\n");
  download("lead_tracker_export_" + today() + ".csv", csv, "text/csv");
}

window.exportCSV = exportCSV;

function downloadDB() {
  const data = { version: 1, exportedAt: new Date().toISOString(), leads };
  download("leadtracker_db.json", JSON.stringify(data, null, 2), "application/json");
}

window.downloadDB = downloadDB;

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function importLegacyJSON() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const importLeads = Array.isArray(data.leads) ? data.leads : [];
      if (importLeads.length === 0) {
        toast("No leads found in the file", "err");
        return;
      }
      const batch = writeBatch(db);
      let count = 0;
      let skipped = 0;
      const existingIds = new Set(leads.map((l) => l.id));
      for (const l of importLeads) {
        if (!l.id) {
          l.id = "l_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
        }
        if (!existingIds.has(l.id)) {
          const ref = doc(db, "leads", l.id);
          batch.set(ref, {
            ...l,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          count++;
        } else {
          skipped++;
        }
      }
      if (count > 0) {
        await batch.commit();
        toast(`Imported ${count} leads${skipped ? ` (${skipped} skipped, duplicate IDs)` : ""}`, "ok");
      } else {
        toast("All leads already exist in Firestore (0 imported)", "");
      }
    } catch (e) {
      toast("Import failed: " + e.message, "err");
      console.error("Import error", e);
    }
  };
  input.click();
}

window.importLegacyJSON = importLegacyJSON;

document.getElementById("leadModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("leadModal")) closeLead();
});
document.getElementById("queryModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("queryModal")) closeQueryBuilder();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("./sw.js").catch(() => {}),
  );
}

render();
