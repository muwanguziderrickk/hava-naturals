/* ------------------------------------------------------------------
   Branch-Scoped Staff Table
   ------------------------------------------------------------------ */
import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot
} from "../../js/firebase-config.js";

/* ── 1.  Wait until the session is ready ───────────────────────── */
await window.sessionReady;           // provided by sessionManager.js

/* ── 2.  Session & DOM references ──────────────────────────────── */
const user       = JSON.parse(sessionStorage.getItem("user-information") || "{}");
const branchId   = user.branchId   || null;   // null if something went wrong
const branchName = user.branchName || "";     // optional display

const tbody = document.querySelector("#staff tbody");
if (!tbody) {
  console.warn("Staff table <tbody> not found – skipping staff render.");
  /* don’t throw; other modules may still work */
}

/* ── 3.  Guard: branch must exist for branch-scoped table ──────── */
if (!branchId) {
  console.error("BranchId missing – cannot build staff table.");
  if (typeof Swal !== "undefined") {
    Swal.fire("Error", "Your session has no branch assigned.<br>Please reload or contact admin.", "error");
  }
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-danger text-center">
          Branch unknown – staff list unavailable.
        </td>
      </tr>`;
  }
  /* Stop here; no real-time listener created */
} else if (tbody) {

  /* ── 4.  Firestore query (branch-scoped) ────────────────────── */
  const staffQ = query(
    collection(db, "workers"),
    where("branchId", "==", branchId),
    orderBy("fullName")            // alphabetical
  );

  /* ── 5.  Small helpers ──────────────────────────────────────── */
  const esc = (txt = "") => txt.replaceAll("<", "&lt;");  // basic XSS guard

  const buildRow = (idx, d) => `
    <tr>
      <td class="text-muted">${idx}</td>
      <td>${esc(d.fullName)}</td>
      <td>${esc(d.position)}</td>
      <td>${esc(d.contact)}</td>
      <td>${esc(d.email)}</td>
      <td>${esc(d.schedule)}</td>
      <td>
        <span class="badge ${d.disabled ? "bg-danger" : "bg-success"}">
          ${d.disabled ? "Inactive" : "Active"}
        </span>
      </td>
    </tr>`;

  /* ── 6.  Real-time staff listener ───────────────────────────── */
  onSnapshot(staffQ, snap => {
    tbody.innerHTML = "";
    let i = 1;
    snap.forEach(doc => tbody.insertAdjacentHTML("beforeend", buildRow(i++, doc.data())));
    if (i === 1) {
      tbody.innerHTML =
        `<tr><td colspan="8" class="text-center">No staff records found.</td></tr>`;
    }
  });
}

/* ── 7.  Lightweight responsive tweaks (unchanged) ─────────────── */
const table = document.querySelector("#staff table");
if (table && table.parentElement) {
  table.classList.add("table-sm");          // tighter rows
  table.parentElement.style.maxHeight = "70vh";
  table.parentElement.style.overflowY = "auto";
}
