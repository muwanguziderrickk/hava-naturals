/* ------------------------------------------------------------------
   Branch‑Scoped Staff Table
   ------------------------------------------------------------------ */
import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot
} from "../../js/firebase-config.js";

/* ---------- 1.  Branch + DOM references ------------------------- */
const user  = JSON.parse(sessionStorage.getItem("user-information") || "{}");
const branchId   = user.branchId;    // e.g. "Branch002"
const branchName = user.branchName;  // just for info

if (!branchId) {
  console.error("No branch in session‑storage; aborting staff table render.");
  /* Optionally show an alert : Swal.fire("Error","Branch unknown","error"); */
  throw new Error("BranchId missing");
}
/* tbody inside <table> */
const tbody = document.querySelector('#staff tbody');

/* ---------- 2.  Realtime query ---------------------------------- */
const staffQ = query(
  collection(db, "workers"),
  where("branchId", "==", branchId),
  orderBy("fullName")               // nice alphabetical order; change if needed
);

/* ---------- 3.  Render helper ----------------------------------- */
function buildRow(idx, d) {
  const safe = txt => (txt ?? "").replaceAll("<","&lt;");  // tiny XSS guard
  return `
    <tr>
      <td class="text-muted">${idx}</td>
      <td>${safe(d.fullName)}</td>
      <td>${safe(d.position)}</td>
      <td>${safe(d.accessLevel)}</td>
      <td>${safe(d.contact)}</td>
      <td>${safe(d.email)}</td>
      <td>${safe(d.schedule)}</td>
      <td>
        <span class="badge ${d.disabled ? 'bg-danger' : 'bg-success'}">
          ${d.disabled ? 'Inactive' : 'Active'}
        </span>
      </td>
    </tr>`;
}

/* ---------- 4.  Live listener ----------------------------------- */
onSnapshot(staffQ, snapshot => {
  /* clear > rebuild, keeps things super‑simple & flicker‑free */
  tbody.innerHTML = "";
  let i = 1;
  snapshot.forEach(docSnap => {
    tbody.insertAdjacentHTML("beforeend", buildRow(i++, docSnap.data()));
  });
});

/* ---------- 5.  Lightweight “responsive” table  -----------------
   If your page can get very long with many staff members,
   wrap the table in a scroll‑box using a one‑liner of CSS.
   (You already have <table class="table table-hover"> … </table>)
------------------------------------------------------------------*/
const table = document.querySelector('#staff table');
table.classList.add('table-sm');  /* tighter rows */

table.parentElement.style.maxHeight = "70vh";   /* Occupy max 70% viewport */
table.parentElement.style.overflowY = "auto";   /* Give it its own scroll bar */
