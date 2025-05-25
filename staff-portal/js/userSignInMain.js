/* ========================================================================
   userSignInMain.js  –  interactive sign-in + first-time session cache
   ------------------------------------------------------------------------
   Responsibilities
   • Authenticate credentials with Firebase Auth
   • Fetch the worker document
   • Guard against disabled / missing accounts
   • Cache *all* session data exactly once (no duplicates)
   • Stamp lastLoginAt
   • Route user to the correct dashboard
   ====================================================================== */

import {
  db,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  // auth helpers
  getAuth,
  signInWithEmailAndPassword,
} from "./firebase-config.js";

const auth           = getAuth();
const loginForm      = document.getElementById("loginForm");
const emailField     = document.getElementById("emailInp");
const passwordField  = document.getElementById("passwordInp");
const loginButton    = document.getElementById("loginBtn");
const togglePassword = document.getElementById("togglePassword");

/* ------------------------------------------------------------------
   UTILITIES
-------------------------------------------------------------------*/

/** Show a dismissible Bootstrap toast (danger by default). */
function showToast(message, type = "danger") {
  const toast = document.createElement("div");
  toast.className =
    `toast align-items-center text-bg-${type} border-0 position-fixed 
     top-0 end-0 m-3`;
  toast.role       = "alert";
  toast.ariaLive   = "assertive";
  toast.ariaAtomic = "true";
  toast.innerHTML  = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" 
              class="btn-close btn-close-white me-2 m-auto" 
              data-bs-dismiss="toast" aria-label="Close"></button>
    </div>`;
  document.body.appendChild(toast);
  new bootstrap.Toast(toast).show();
  toast.addEventListener("hidden.bs.toast", () => toast.remove());
}

/** Disable the login button and show spinner text. */
function blockLoginUI(state) {
  loginButton.disabled = state;
  loginButton.innerHTML = state
    ? `<span class="spinner-border spinner-border-sm me-2"
              role="status" aria-hidden="true"></span>Signing in…`
    : "Login";
}

/** Cache everything the rest of the app needs – once per login. */
function cacheSession(worker, user) {
  sessionStorage.setItem("user-information", JSON.stringify(worker));
  sessionStorage.setItem(
    "user-credentials",
    JSON.stringify({ uid: user.uid, email: user.email })
  );
  sessionStorage.setItem("branchId",   worker.branchId   || "");
  sessionStorage.setItem("branchName", worker.branchName || "");
}

/* ------------------------------------------------------------------
   EVENT HANDLERS
-------------------------------------------------------------------*/

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email    = emailField.value.trim();
  const password = passwordField.value;

  // 💡 trivial form guard
  if (!email || !password) {
    showToast("⚠️ Please fill in both email and password.");
    return;
  }

  blockLoginUI(true);

  try {
    /* 1️⃣  Firebase Auth ------------------------------------------------ */
    const { user } = await signInWithEmailAndPassword(auth, email, password);

    /* 2️⃣  Firestore worker doc --------------------------------------- */
    const snap = await getDoc(doc(db, "workers", user.uid));
    if (!snap.exists()) throw new Error("No worker record found.");

    const worker = snap.data();
    if (worker.disabled) throw new Error("Account suspended.");

    /* 3️⃣  Cache session once ----------------------------------------- */
    cacheSession(worker, user);

    /* 4️⃣  Audit: lastLoginAt ----------------------------------------- */
    await updateDoc(doc(db, "workers", user.uid), { lastLoginAt: serverTimestamp() })
      .catch((err) => console.warn("lastLoginAt update failed:", err));

    /* 5️⃣  Role-based redirect ---------------------------------------- */
    const ROUTES = {
      "Top Level Manager": "/staff-portal/superadmin/",
      "Branch Manager":    "/staff-portal/branch-manager/",
      "Nutritionist":      "/staff-portal/nutritionist/",
      "Front Desk":        "/staff-portal/front-desk/",
    };
    const path = ROUTES[worker.accessLevel];
    if (!path) throw new Error("Access level not recognized.");

    localStorage.setItem(
      "postLoginToast",
      JSON.stringify({ message: "✅ Login successful!", type: "success" })
    );

    window.location.href = path; // 🎉

  } catch (err) {
    // Tight messaging for UX
    let msg = "❌ Invalid email or password!";
    if (err.code === "auth/user-disabled" || err.message.includes("suspend")) {
      msg = "⛔ Account suspended. Contact admin!";
    } else if (err.code === "auth/network-request-failed") {
      msg = "🌐 Network error. Check your connection!";
    } else if (err.code === "auth/too-many-requests") {
      msg = "🚫 Too many attempts. Try again later!";
    } else if (err.code === "auth/internal-error") {
      msg = "⚠️ Internal error. Please try again!";
    }
    showToast(msg);
  } finally {
    blockLoginUI(false);
  }
});

/* Toggle password eye / slash */
togglePassword.addEventListener("click", () => {
  const isPwd = passwordField.type === "password";
  passwordField.type = isPwd ? "text" : "password";
  togglePassword.classList.toggle("fa-eye",      !isPwd);
  togglePassword.classList.toggle("fa-eye-slash", isPwd);
});
