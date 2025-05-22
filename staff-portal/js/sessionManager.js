/* =======================================================================
   sessionManager.js  –  single-page auth & session watchdog
   -----------------------------------------------------------------------
   • Keeps sessionStorage in-sync with the worker document in Firestore
   • Clears everything on sign-out / auth loss
   • Guards against disabled accounts, missing docs
   ======================================================================= */

import { db, doc, onSnapshot } from "./firebase-config.js";
import { getAuth, onAuthStateChanged, signOut } from "./firebase-config.js";

const auth = getAuth();
let isSigningOut = false;
let unsubscribe = null;

// DOM references
const loader = document.getElementById("loader");
const main = document.getElementById("main-content");
const userName = document.getElementById("userName");
const userEmail = document.getElementById("userEmail");
const userPhoto = document.getElementById("userPhoto");
const userIcon = document.getElementById("userIcon");
const userMenu = document.getElementById("customUserMenu");
const signOutBtn = document.getElementById("signOutBtn");
const signOutModalElem = document.getElementById("signOutModal");

window.sessionReady = new Promise((resolve, reject) => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      sessionStorage.clear();
      if (!isSigningOut) window.location.href = "/staff-portal/";
      return reject("No user");
    }

    const docRef = doc(db, "workers", user.uid);

    unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (!docSnap.exists()) {
          alert("No worker record found.");
          return signOutUser();
        }

        const workerData = docSnap.data();

        if (workerData.disabled) {
          alert("⛔ Your account has been suspended.");
          return signOutUser();
        }

        try {
          sessionStorage.setItem("user-information", JSON.stringify(workerData));
          sessionStorage.setItem("user-credentials", JSON.stringify({ uid: user.uid, email: user.email }));
          sessionStorage.setItem("branchId", workerData.branchId || "");
          sessionStorage.setItem("branchName", workerData.branchName || "");
        } catch (e) {
          console.error("Session storage error:", e);
          alert("Session error. Please reload or contact admin.");
          return signOutUser();
        }

        document.querySelectorAll("#branchNamePlaceholder").forEach(el => {
          el.textContent = workerData.branchName || "";
        });

        applyRoleUI(workerData);
        updateHeaderInfo(workerData);
        setupIdleLogout();

        if (loader) loader.style.display = "none";
        if (main) main.style.display = "block";

        resolve(workerData); // ✅ Make session ready for dependent scripts
      },
      (error) => {
        console.error("Error fetching user data:", error);
        alert("Something went wrong. Please reload or contact admin.");
        reject(error);
      }
    );
  });
});

// Network check
window.addEventListener("offline", () => {
  alert("Network connection lost! Please check your internet.");
});

// Role-based UI display
function applyRoleUI(worker) {
  const role = worker.accessLevel;
  const visibilityMap = {
    "Top Level Manager": ".top-level-only",
    "Branch Manager": ".manager-only",
    "Nutritionist" : ".nutritionist-only",
    "Front Desk": ".front-desk-only",
  };

  Object.values(visibilityMap).forEach(sel =>
    document.querySelectorAll(sel).forEach(el => el.style.display = "none")
  );

  if (visibilityMap[role]) {
    document.querySelectorAll(visibilityMap[role]).forEach(el => el.style.display = "block");
  }
}

// Header info
function updateHeaderInfo(worker) {
  if (userName) userName.textContent = worker.fullName || "";
  if (userEmail) userEmail.textContent = worker.email || "";
  if (userPhoto && worker.photoURL) userPhoto.src = worker.photoURL;
}

// Idle logout
function setupIdleLogout() {
  const maxIdleTime = 15 * 60 * 1000;
  let idleTimeout, hiddenSince = null;

  const resetTimer = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => autoLogout("⚠️ Session expired due to inactivity."), maxIdleTime);
  };

  const autoLogout = (msg) => {
    if (!isSigningOut) {
      alert(msg);
      signOutUser(msg);
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenSince = Date.now();
    else if (hiddenSince && Date.now() - hiddenSince > maxIdleTime) {
      autoLogout("🕓 You were away too long. Logged out for your security.");
    }
    hiddenSince = null;
  });

  ["mousemove", "keydown", "touchstart", "scroll"].forEach(evt =>
    document.addEventListener(evt, resetTimer)
  );

  resetTimer();
}

// Sign-out
async function signOutUser(message) {
  if (unsubscribe) unsubscribe();

  try {
    await signOut(auth);
    sessionStorage.clear();

    if (message) {
      localStorage.setItem("postLogoutToast", JSON.stringify({ message, type: "success" }));
    }

    window.location.href = "/staff-portal/";
  } catch (error) {
    console.error("Sign-out error:", error);
    isSigningOut = false;
    alert("Failed to sign out. Please try again.");
  }
}

// DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  if (signOutBtn && signOutModalElem) {
    signOutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (isSigningOut) return;
      isSigningOut = true;

      new bootstrap.Modal(signOutModalElem).show();

      setTimeout(() => {
        signOutUser("👋 Session ended. You’ve been signed out!");
      }, 2000);
    });
  }

  if (userIcon && userMenu) {
    userIcon.addEventListener("click", (e) => {
      e.preventDefault();
      if (!isSigningOut) {
        userMenu.classList.toggle("d-none");
        document.body.classList.toggle("showing-user-menu");
      }
    });

    document.addEventListener("click", (e) => {
      if (!isSigningOut && !userMenu.contains(e.target) && !userIcon.contains(e.target)) {
        userMenu.classList.add("d-none");
        document.body.classList.remove("showing-user-menu");
      }
    });
  }
});
