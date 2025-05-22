/* ========================================================================
   sessionManager.js  –  single-page auth & session watchdog
   ------------------------------------------------------------------------
   Responsibilities
   • Verify there is an auth user
   • Listen to the worker document for live changes
   • Clear session on sign-out / disable / auth loss
   • Guard against missing docs
   • Update UI + idle logout
   • 👉 Never *write* full session again (sign-in already did)
   ====================================================================== */

import {
  db,
  doc,
  onSnapshot,
  // auth helpers
  getAuth,
  onAuthStateChanged,
  signOut,
} from "./firebase-config.js";

const auth = getAuth();
let   isSigningOut = false;
let   unsubscribe  = null;

/* ------------------------------------------------------------------
   DOM REFS (fail-safe optional chaining)
-------------------------------------------------------------------*/
const $ = (id) => document.getElementById(id) || null;

const loader          = $("loader");
const main            = $("main-content");
const userName        = $("userName");
const userEmail       = $("userEmail");
const userPhoto       = $("userPhoto");
const userIcon        = $("userIcon");
const userMenu        = $("customUserMenu");
const signOutBtn      = $("signOutBtn");
const signOutModalElm = $("signOutModal");

/* ------------------------------------------------------------------
   GLOBAL PROMISE – lets other scripts wait for session readiness
-------------------------------------------------------------------*/
window.sessionReady = new Promise((resolve, reject) => {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      sessionStorage.clear();
      if (!isSigningOut) window.location.href = "/staff-portal/";
      return reject("No authenticated user.");
    }

    const docRef = doc(db, "workers", user.uid);

    unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (!snap.exists()) {
          alert("No worker record found.");
          return signOutUser();
        }

        const worker = snap.data();

        /* Account disabled while online */
        if (worker.disabled) {
          alert("⛔ Your account has been suspended.");
          return signOutUser();
        }

        /* -----------------------------------------------------------
           Live branch move? – keep *only branch* keys in-sync
           (All other session data is static for this login.)
        ----------------------------------------------------------- */
        sessionStorage.setItem("branchId",   worker.branchId   || "");
        sessionStorage.setItem("branchName", worker.branchName || "");

        /* Update any #branchNamePlaceholder nodes */
        document.querySelectorAll("#branchNamePlaceholder")
          .forEach((el) => (el.textContent = worker.branchName || ""));

        applyRoleUI(worker);
        updateHeaderInfo(worker);
        setupIdleLogout();

        if (loader) loader.style.display = "none";
        if (main)   main.style.display   = "block";

        resolve(worker); // 🎯 let dependent modules run
      },
      (err) => {
        console.error("Snapshot error:", err);
        alert("Something went wrong. Please reload or contact admin.");
        reject(err);
      }
    );
  });
});

/* ------------------------------------------------------------------
   NETWORK STATUS
-------------------------------------------------------------------*/
window.addEventListener("offline", () =>
  alert("📡 Network connection lost! Please check your internet.")
);

/* ------------------------------------------------------------------
   ROLE-BASED UI VISIBILITY
-------------------------------------------------------------------*/
function applyRoleUI(worker) {
  const role = worker.accessLevel;
  const MAP  = {
    "Top Level Manager": ".top-level-only",
    "Branch Manager":    ".manager-only",
    "Nutritionist":      ".nutritionist-only",
    "Front Desk":        ".front-desk-only",
  };

  /* hide all by default */
  Object.values(MAP).forEach((sel) =>
    document.querySelectorAll(sel).forEach((el) => (el.style.display = "none"))
  );

  /* reveal allowed group */
  if (MAP[role]) {
    document.querySelectorAll(MAP[role])
      .forEach((el) => (el.style.display = "block"));
  }
}

/* ------------------------------------------------------------------
   HEADER INFO UPDATE
-------------------------------------------------------------------*/
function updateHeaderInfo(worker) {
  if (userName)  userName.textContent  = worker.fullName || "";
  if (userEmail) userEmail.textContent = worker.email    || "";
  if (userPhoto && worker.photoURL) userPhoto.src = worker.photoURL;
}

/* ------------------------------------------------------------------
   IDLE LOGOUT – 15 min inactivity or tab hidden too long
-------------------------------------------------------------------*/
function setupIdleLogout() {
  const MAX   = 15 * 60 * 1000; // 15 min
  let   timer = null;
  let   hiddenSince = null;

  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => autoLogout("⚠️ Session expired due to inactivity."),
      MAX
    );
  };

  const autoLogout = (msg) => {
    if (!isSigningOut) {
      alert(msg);
      signOutUser(msg);
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenSince = Date.now();
    else if (hiddenSince && Date.now() - hiddenSince > MAX) {
      autoLogout("🕓 You were away too long. Logged out for your security.");
    }
    hiddenSince = null;
  });

  ["mousemove", "keydown", "touchstart", "scroll"].forEach((evt) =>
    document.addEventListener(evt, reset)
  );

  reset(); // kick-off
}

/* ------------------------------------------------------------------
   SIGN-OUT SHARED LOGIC
-------------------------------------------------------------------*/
async function signOutUser(message) {
  if (unsubscribe) unsubscribe(); // stop snapshot

  try {
    await signOut(auth);
    sessionStorage.clear();

    if (message) {
      localStorage.setItem(
        "postLogoutToast",
        JSON.stringify({ message, type: "success" })
      );
    }
    window.location.href = "/staff-portal/";
  } catch (err) {
    console.error("Sign-out error:", err);
    isSigningOut = false;
    alert("Failed to sign out. Please try again.");
  }
}

/* ------------------------------------------------------------------
   DOM READY – user icon / sign-out menu
-------------------------------------------------------------------*/
document.addEventListener("DOMContentLoaded", () => {
  /* Sign-out button (modal confirmation) */
  if (signOutBtn && signOutModalElm) {
    signOutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (isSigningOut) return;
      isSigningOut = true;

      new bootstrap.Modal(signOutModalElm).show();
      setTimeout(() => signOutUser("👋 Session ended. You’ve been signed out!"), 2000);
    });
  }

  /* User-menu toggle */
  if (userIcon && userMenu) {
    userIcon.addEventListener("click", (e) => {
      e.preventDefault();
      if (!isSigningOut) {
        userMenu.classList.toggle("d-none");
        document.body.classList.toggle("showing-user-menu");
      }
    });

    /* Close menu on outside click */
    document.addEventListener("click", (e) => {
      if (
        !isSigningOut &&
        !userMenu.contains(e.target) &&
        !userIcon.contains(e.target)
      ) {
        userMenu.classList.add("d-none");
        document.body.classList.remove("showing-user-menu");
      }
    });
  }
});
