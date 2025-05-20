import { getAuth, sendPasswordResetEmail } from "./firebase-config.js";

document.getElementById("forgot-password-form").addEventListener("submit", function (event) {
  event.preventDefault();

  const email = document.getElementById("email").value;
  const messageDiv = document.getElementById("message");
  const auth = getAuth();
  const submitBtn = event.target.querySelector("button[type='submit']");

  // Disable button and show spinner
  submitBtn.disabled = true;
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Sending...`;

  // Send reset email
  sendPasswordResetEmail(auth, email)
    .then(() => {
      showToast("✅ Password reset email sent! Please check your inbox.", "success");
    //   messageDiv.innerHTML = "Password reset email sent! Please check your inbox.";

      setTimeout(() => {
        window.location.href = "/staff-portal/";
      }, 3500);
    })
    .catch((error) => {
      showToast(`❌ ${error.message}`, "error");
      // messageDiv.innerHTML = `Error: ${error.message}`;
    })
    .finally(() => {
      // Restore button state
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    });
});

// Dynamically create and show a Bootstrap toast
function showToast(message, type) {
  const toastContainerId = "toast-container";

  // Create toast container if it doesn't exist
  let toastContainer = document.getElementById(toastContainerId);
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = toastContainerId;
    toastContainer.className = "position-fixed top-0 end-0 p-3";
    toastContainer.style.zIndex = 1055;
    document.body.appendChild(toastContainer);
  }

  // Create unique toast element
  const toastId = `toast-${Date.now()}`;
  const bgClass = type === "success" ? "text-bg-success" : "text-bg-danger";
  const toastEl = document.createElement("div");
  toastEl.className = `toast align-items-center ${bgClass} border-0`;
  toastEl.id = toastId;
  toastEl.setAttribute("role", "alert");
  toastEl.setAttribute("aria-live", "assertive");
  toastEl.setAttribute("aria-atomic", "true");
  toastEl.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
  `;

  toastContainer.appendChild(toastEl);

  // Show the toast
  const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
  toast.show();

  // Auto-remove the toast from DOM after it's hidden
  toastEl.addEventListener("hidden.bs.toast", () => {
    toastEl.remove();
  });
}