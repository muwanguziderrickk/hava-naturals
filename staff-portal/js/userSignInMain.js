import { db, doc, getDoc, updateDoc, serverTimestamp } from "./firebase-config.js";
import { getAuth, signInWithEmailAndPassword } from "./firebase-config.js";

const auth = getAuth();

const loginForm = document.getElementById("loginForm");
const emailField = document.getElementById("emailInp");
const passwordField = document.getElementById("passwordInp");
const loginButton = document.getElementById("loginBtn");
const togglePassword = document.getElementById("togglePassword");

// Handle form submission
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailField.value.trim();
  const password = passwordField.value;

  // Basic validation
  if (!email || !password) {
    showToast("⚠️ Please fill in both email and password.");
    return;
  }

  loginButton.disabled = true;
  loginButton.innerHTML = `
    <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
    Signing in...
  `;

  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    const userDoc = await getDoc(doc(db, "workers", user.uid));

    if (!userDoc.exists()) throw new Error("No worker record found.");
    
    const worker = userDoc.data();
    if (worker.disabled) throw new Error("Account suspended. Contact admin.");

    // Save session info
    sessionStorage.setItem("user-information", JSON.stringify(worker));
    sessionStorage.setItem("user-credentials", JSON.stringify({ email: user.email, uid: user.uid }));

    // Redirect based on role
    const routes = {
      "Top Level Manager": "/staff-portal/superadmin/",
      "Branch Manager": "/staff-portal/branch-manager/",
      "Nutritionist": "/staff-portal/nutritionist/",
      "Front Desk": "/staff-portal/front-desk/"
    };

    const redirectPath = routes[worker.accessLevel];
    if (!redirectPath) throw new Error("Access level not recognized.");

    // ✅ Update last login timestamp
    await updateDoc(doc(db, "workers", user.uid), {
      lastLoginAt: serverTimestamp()
    });

    // Optional post-login toast
    localStorage.setItem("postLoginToast", JSON.stringify({
      message: "✅ Login successful!",
      type: "success"
    }));

    window.location.href = redirectPath;

  } catch (err) {
    showToast(err.message.includes("suspend") ? "⛔ Account suspended. Contact admin." : "❌ Invalid credentials.");
  } finally {
    loginButton.disabled = false;
    loginButton.innerHTML = "Login";
  }
});

// Toggle password visibility
togglePassword.addEventListener("click", () => {
  const isPassword = passwordField.type === "password";
  passwordField.type = isPassword ? "text" : "password";
  togglePassword.classList.toggle("fa-eye", !isPassword);
  togglePassword.classList.toggle("fa-eye-slash", isPassword);
});

// Simple toast feedback
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast align-items-center text-bg-danger border-0 position-fixed top-0 end-0 m-3";
  toast.role = "alert";
  toast.ariaLive = "assertive";
  toast.ariaAtomic = "true";
  toast.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
  `;
  document.body.appendChild(toast);
  const bsToast = new bootstrap.Toast(toast);
  bsToast.show();
  toast.addEventListener("hidden.bs.toast", () => toast.remove());
}