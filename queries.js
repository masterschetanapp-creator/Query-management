const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

import { auth, db } from './firebase-config.js';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  addDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

let savedQueries = [];
let activeQuery = null;

let unsubscribeQueries = null;
const QUERIES_COLLECTION = "savedQueries";
const LEADS_COLLECTION = "leads";

export function initQueries() {
  if (unsubscribeQueries) unsubscribeQueries();
  unsubscribeQueries = onSnapshot(
    collection(db, QUERIES_COLLECTION),
    (snapshot) => {
      savedQueries = [];
      snapshot.forEach((doc) => {
        savedQueries.push({ id: doc.id, ...doc.data() });
      });
      savedQueries.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
      renderQueries();
    },
  );
}

export function renderQueries() {
  const container = document.getElementById("queriesChips");
  if (!container) return;
  let html = "";
  for (const q of savedQueries) {
    const count = getQueryMatchCount(q);
    html += `<span class="query-chip ${activeQuery?.id === q.id ? "active" : ""}" data-id="${q.id}">
      <span class="query-chip-name" onclick="window.applySavedQuery('${q.id}')">${esc(q.name)}</span>
      <span class="query-chip-count">${count}</span>
      <span class="query-chip-actions">
        <button class="btn-link" onclick="window.editSavedQuery('${q.id}')" title="Edit">E</button>
        <button class="btn-link" onclick="window.duplicateSavedQuery('${q.id}')" title="Duplicate">D</button>
        <button class="btn-link" onclick="window.deleteSavedQuery('${q.id}')" title="Delete">X</button>
      </span>
    </span>`;
  }
  html += `<button class="btn gray" style="font-size:12px;padding:4px 10px" onclick="window.openQueryBuilder()">+ New</button>`;
  container.innerHTML = html;
}

export function getQueryMatchCount(query) {
  if (!window.leads) return 0;
  return window.leads.filter((l) => evaluateQuery(l, query)).length;
}

export function openQueryBuilder(editId) {
  const modal = document.getElementById("queryModal");
  if (!modal) return;

  if (editId) {
    const existing = savedQueries.find((q) => q.id === editId);
    if (existing) {
      document.getElementById("queryModalTitle").textContent = "Edit Query";
      document.getElementById("queryName").value = existing.name || "";
      document.getElementById("queryMatch").value = existing.match || "all";
      activeQuery = { ...existing, _editingId: editId };
      renderConditions(existing.conditions || []);
      updateQueryPreview();
      modal.classList.add("open");
      return;
    }
  }

  document.getElementById("queryModalTitle").textContent = "New Query";
  document.getElementById("queryName").value = "";
  document.getElementById("queryMatch").value = "all";
  activeQuery = { match: "all", conditions: [], _isBuilder: true };
  renderConditions([]);
  updateQueryPreview();
  modal.classList.add("open");
}

function renderConditions(conditions) {
  const container = document.getElementById("queryConditions");
  if (!container) return;
  let html = "";
  for (let i = 0; i < conditions.length; i++) {
    html += conditionRowHtml(i, conditions[i]);
  }
  container.innerHTML = html;
  for (let i = 0; i < conditions.length; i++) {
    const row = container.children[i];
    if (row) {
      const fieldSel = row.querySelector(".qf-field");
      const opSel = row.querySelector(".qf-op");
      const valInput = row.querySelector(".qf-val");
      if (fieldSel) fieldSel.addEventListener("change", () => onFieldChange(i));
      if (opSel) opSel.addEventListener("change", () => onOpChange(i));
      if (valInput) {
        valInput.addEventListener("change", () => onValChange(i));
        if (valInput.tagName === "SELECT" && valInput.multiple) {
          valInput.addEventListener("change", () => onValChange(i));
        }
      }
    }
  }
}

function conditionRowHtml(index, cond) {
  const field = cond?.field || "";
  const op = cond?.operator || "contains";
  const val = cond?.value ?? "";
  const fieldOpts = [
    { v: "leadName", l: "Lead Name" },
    { v: "contactNumber", l: "Contact Number" },
    { v: "emailId", l: "Email" },
    { v: "inquiryDate", l: "Inquiry Date" },
    { v: "source", l: "Source" },
    { v: "product", l: "Product" },
    { v: "status", l: "Status" },
    { v: "followupDate", l: "Follow-up Date" },
    { v: "notes", l: "Notes" },
  ];
  const fhtml = fieldOpts
    .map((f) => `<option ${field === f.v ? "selected" : ""} value="${f.v}">${f.l}</option>`)
    .join("");

  const isDate = field === "inquiryDate" || field === "followupDate";
  const isCat = field === "source" || field === "product" || field === "status";
  const ops = getOperators(isDate, isCat);
  const ohtml = ops
    .map((o) => `<option ${op === o.v ? "selected" : ""} value="${o.v}">${o.l}</option>`)
    .join("");

  let vhtml = "";
  if (op === "is_empty" || op === "not_empty") {
    vhtml = `<input class="qf-val" type="text" disabled style="background:#eee" placeholder="N/A">`;
  } else if (op === "is_one_of" && isCat) {
    const uniqueVals = [...new Set((window.leads || []).map((l) => String(l[field] || "")).filter(Boolean))].sort();
    const selected = Array.isArray(val) ? val : [];
    vhtml = `<select class="qf-val" multiple style="height:60px">${uniqueVals.map((v) => `<option ${selected.includes(v) ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
  } else if (isDate && op === "between") {
    const v = Array.isArray(val) ? val : ["", ""];
    vhtml = `<input class="qf-val from" type="date" value="${v[0] || ""}"> to <input class="qf-val to" type="date" value="${v[1] || ""}">`;
  } else if (isDate && op === "last_n_days") {
    vhtml = `<input class="qf-val" type="number" min="1" value="${val || 7}" style="width:70px"> days`;
  } else if (isDate) {
    vhtml = `<input class="qf-val" type="date" value="${val || ""}">`;
  } else {
    vhtml = `<input class="qf-val" type="text" value="${esc(val)}" placeholder="Value">`;
  }

  return `<div class="qc-row">
    <select class="qf-field">${fhtml}</select>
    <select class="qf-op">${ohtml}</select>
    <span class="qf-val-wrap">${vhtml}</span>
    <button class="btn-link qf-remove" onclick="window.removeQueryCondition(${index})">X</button>
  </div>`;
}

function getOperators(isDate, isCat) {
  if (isDate) {
    return [
      { v: "before", l: "Before" },
      { v: "after", l: "After" },
      { v: "on", l: "On" },
      { v: "between", l: "Between" },
      { v: "last_n_days", l: "In the last N days" },
      { v: "is_empty", l: "Is empty" },
    ];
  }
  if (isCat) {
    return [
      { v: "contains", l: "Contains" },
      { v: "equals", l: "Equals" },
      { v: "is_one_of", l: "Is one of" },
      { v: "is_empty", l: "Is empty" },
      { v: "not_empty", l: "Is not empty" },
    ];
  }
  return [
    { v: "contains", l: "Contains" },
    { v: "not_contains", l: "Does not contain" },
    { v: "equals", l: "Equals" },
    { v: "is_empty", l: "Is empty" },
    { v: "not_empty", l: "Is not empty" },
  ];
}

export function removeQueryCondition(index) {
  const builder = getBuilderState();
  builder.conditions.splice(index, 1);
  renderConditions(builder.conditions);
  updateQueryPreview();
}

function onFieldChange(index) {
  const row = document.getElementById("queryConditions")?.children[index];
  if (!row) return;
  const field = row.querySelector(".qf-field")?.value || "";
  const isDate = field === "inquiryDate" || field === "followupDate";
  const isCat = field === "source" || field === "product" || field === "status";
  const ops = getOperators(isDate, isCat);
  const opSel = row.querySelector(".qf-op");
  if (opSel) {
    opSel.innerHTML = ops.map((o) => `<option value="${o.v}">${o.l}</option>`).join("");
  }
  const valWrap = row.querySelector(".qf-val-wrap");
  if (valWrap) {
    const defOp = ops[0]?.v || "contains";
    if (isDate && defOp === "after") {
      valWrap.innerHTML = `<input class="qf-val" type="date">`;
    } else if (isCat && defOp === "contains") {
      valWrap.innerHTML = `<input class="qf-val" type="text" placeholder="Value">`;
    } else {
      valWrap.innerHTML = `<input class="qf-val" type="text" placeholder="Value">`;
    }
    const newVal = valWrap.querySelector(".qf-val");
    if (newVal) newVal.addEventListener("change", () => updateBuilderFromUI());
  }
  updateBuilderFromUI();
}

function onOpChange(index) {
  const row = document.getElementById("queryConditions")?.children[index];
  if (!row) return;
  const field = row.querySelector(".qf-field")?.value || "";
  const op = row.querySelector(".qf-op")?.value || "contains";
  const isDate = field === "inquiryDate" || field === "followupDate";
  const isCat = field === "source" || field === "product" || field === "status";
  const valWrap = row.querySelector(".qf-val-wrap");
  if (!valWrap) return;
  if (op === "is_empty" || op === "not_empty") {
    valWrap.innerHTML = `<input class="qf-val" type="text" disabled style="background:#eee" placeholder="N/A">`;
  } else if (op === "is_one_of" && isCat) {
    const uniqueVals = [...new Set((window.leads || []).map((l) => String(l[field] || "")).filter(Boolean))].sort();
    valWrap.innerHTML = `<select class="qf-val" multiple style="height:60px">${uniqueVals.map((v) => `<option>${esc(v)}</option>`).join("")}</select>`;
  } else if (isDate && op === "between") {
    valWrap.innerHTML =
      `<input class="qf-val from" type="date"> to <input class="qf-val to" type="date">`;
  } else if (isDate && op === "last_n_days") {
    valWrap.innerHTML = `<input class="qf-val" type="number" min="1" value="7" style="width:70px"> days`;
  } else if (isDate) {
    valWrap.innerHTML = `<input class="qf-val" type="date">`;
  } else {
    valWrap.innerHTML = `<input class="qf-val" type="text" placeholder="Value">`;
  }
  const newVal = valWrap.querySelector(".qf-val") || valWrap.querySelector(".from");
  if (newVal) newVal.addEventListener("change", () => updateBuilderFromUI());
  if (valWrap.querySelector(".to"))
    valWrap.querySelector(".to").addEventListener("change", () => updateBuilderFromUI());
  updateBuilderFromUI();
}

function onValChange(index) {
  updateBuilderFromUI();
}

function updateBuilderFromUI() {
  const builder = getBuilderState();
  builder.match = document.getElementById("queryMatch")?.value || "all";
  const container = document.getElementById("queryConditions");
  if (!container) return;
  builder.conditions = [];
  for (let i = 0; i < container.children.length; i++) {
    const row = container.children[i];
    const field = row.querySelector(".qf-field")?.value || "";
    const op = row.querySelector(".qf-op")?.value || "contains";
    let value = "";
    const valWrap = row.querySelector(".qf-val-wrap");
    if (valWrap) {
      if (op === "is_empty" || op === "not_empty") {
        value = "";
      } else if (op === "is_one_of") {
        const sel = valWrap.querySelector("select.qf-val");
        value = sel ? [...sel.selectedOptions].map((o) => o.value) : [];
      } else if (op === "between") {
        const from = valWrap.querySelector(".from")?.value || "";
        const to = valWrap.querySelector(".to")?.value || "";
        value = [from, to];
      } else if (op === "last_n_days") {
        value = valWrap.querySelector(".qf-val")?.value || "7";
      } else {
        value = valWrap.querySelector(".qf-val")?.value || "";
      }
    }
    builder.conditions.push({ field, operator: op, value });
  }
  updateQueryPreview();
}

function getBuilderState() {
  if (!activeQuery || !activeQuery._isBuilder) {
    activeQuery = { match: "all", conditions: [], _isBuilder: true };
  }
  return activeQuery;
}

function updateQueryPreview() {
  const builder = getBuilderState();
  const count = getQueryMatchCount(builder);
  const el = document.getElementById("queryCount");
  if (el) el.textContent = count;
}

export function closeQueryBuilder() {
  const modal = document.getElementById("queryModal");
  if (modal) modal.classList.remove("open");
}

export function addQueryCondition() {
  const builder = getBuilderState();
  builder.conditions.push({ field: "leadName", operator: "contains", value: "" });
  renderConditions(builder.conditions);
  updateQueryPreview();
}

export function saveQuery() {
  const name = document.getElementById("queryName")?.value?.trim();
  if (!name) {
    alert("Please enter a query name.");
    return;
  }
  const builder = getBuilderState();
  const conditions = builder.conditions || [];
  const match = document.getElementById("queryMatch")?.value || "all";
  const editingId = builder._editingId;

  if (editingId) {
    setDoc(doc(db, QUERIES_COLLECTION, editingId), {
      name,
      match,
      conditions,
      sortBy: null,
      createdBy: auth.currentUser?.uid || "",
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch((e) => console.error("Save query failed", e));
  } else {
    addDoc(collection(db, QUERIES_COLLECTION), {
      name,
      match,
      conditions,
      sortBy: null,
      createdBy: auth.currentUser?.uid || "",
      createdAt: serverTimestamp(),
    }).catch((e) => console.error("Add query failed", e));
  }

  closeQueryBuilder();
}

export function applyCurrentQuery() {
  const builder = getBuilderState();
  activeQuery = {
    match: builder.match || "all",
    conditions: [...(builder.conditions || [])],
  };
  closeQueryBuilder();
  updateQueryActiveUI();
  if (window.render) window.render();
}

export function applySavedQuery(queryId) {
  const q = savedQueries.find((sq) => sq.id === queryId);
  if (!q) return;
  activeQuery = { id: q.id, name: q.name, match: q.match, conditions: [...(q.conditions || [])] };
  updateQueryActiveUI();
  if (window.render) window.render();
}

export function editSavedQuery(queryId) {
  openQueryBuilder(queryId);
}

export function duplicateSavedQuery(queryId) {
  const q = savedQueries.find((sq) => sq.id === queryId);
  if (!q) return;
  addDoc(collection(db, QUERIES_COLLECTION), {
    name: q.name + " (copy)",
    match: q.match,
    conditions: q.conditions || [],
    sortBy: null,
    createdBy: auth.currentUser?.uid || "",
    createdAt: serverTimestamp(),
  }).catch((e) => console.error("Duplicate query failed", e));
}

export function deleteSavedQuery(queryId) {
  if (!confirm("Delete this saved query?")) return;
  deleteDoc(doc(db, QUERIES_COLLECTION, queryId)).catch((e) => console.error("Delete query failed", e));
  if (activeQuery?.id === queryId) {
    clearActiveQuery();
  }
}

export function getActiveQuery() {
  return activeQuery && !activeQuery._isBuilder ? activeQuery : null;
}

export function clearActiveQuery() {
  activeQuery = null;
  updateQueryActiveUI();
  if (window.render) window.render();
}

function updateQueryActiveUI() {
  const barActions = document.getElementById("queriesActions");
  const label = document.getElementById("activeQueryLabel");
  const toolbar = document.getElementById("mainToolbar");
  const legacyFilters = document.querySelectorAll(".legacy-filter");

  if (activeQuery && !activeQuery._isBuilder) {
    if (barActions) barActions.style.display = "flex";
    if (label) label.textContent = activeQuery.name || "Custom query";
    if (toolbar) toolbar.classList.add("query-active");
    legacyFilters.forEach((el) => (el.style.display = "none"));
  } else {
    if (barActions) barActions.style.display = "none";
    if (toolbar) toolbar.classList.remove("query-active");
    legacyFilters.forEach((el) => (el.style.display = ""));
  }
  renderQueries();
}

export function evaluateQuery(lead, query) {
  const conditions = query?.conditions || [];
  if (conditions.length === 0) return true;

  const matchAll = query.match === "all" || query.match === undefined;

  for (const cond of conditions) {
    if (!cond.field) continue;
    const fieldValue = String(lead[cond.field] ?? "").toLowerCase();
    const rawValue = lead[cond.field] ?? "";
    let matches = false;

    switch (cond.operator) {
      case "contains":
        matches = fieldValue.includes(String(cond.value ?? "").toLowerCase());
        break;
      case "not_contains":
        matches = !fieldValue.includes(String(cond.value ?? "").toLowerCase());
        break;
      case "equals":
        matches = fieldValue === String(cond.value ?? "").toLowerCase();
        break;
      case "not_equals":
        matches = fieldValue !== String(cond.value ?? "").toLowerCase();
        break;
      case "is_empty":
        matches = !lead[cond.field] || String(lead[cond.field]).trim() === "";
        break;
      case "not_empty":
        matches = lead[cond.field] && String(lead[cond.field]).trim() !== "";
        break;
      case "is_one_of": {
        const list = Array.isArray(cond.value) ? cond.value : [];
        matches = list.some((v) => String(v).toLowerCase() === fieldValue);
        break;
      }
      case "before":
        matches = !!rawValue && rawValue < cond.value;
        break;
      case "after":
        matches = !!rawValue && rawValue > cond.value;
        break;
      case "on":
        matches = String(rawValue) === String(cond.value);
        break;
      case "between": {
        const range = Array.isArray(cond.value) ? cond.value : [];
        const d = rawValue;
        matches = !!d && (!range[0] || d >= range[0]) && (!range[1] || d <= range[1]);
        break;
      }
      case "last_n_days": {
        const n = parseInt(cond.value) || 7;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - n);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        matches = !!rawValue && rawValue >= cutoffStr;
        break;
      }
      default:
        matches = false;
    }

    if (matchAll && !matches) return false;
    if (!matchAll && matches) return true;
  }

  return matchAll;
}
