export function showToast(message, type = "info") {
    const existing = document.getElementById("dynamicToast");
    if (existing) existing.remove();
  
    const toastContainer = document.createElement("div");
    toastContainer.innerHTML = `
      <div id="dynamicToast" class="toast text-bg-dark border-0 position-fixed top-0 end-0 m-3" role="alert" aria-live="assertive" aria-atomic="true" style="z-index: 9999; min-width: 300px;">
        <div class="d-flex flex-column">
          <div class="toast-body">
            ${message}
          </div>
          <div class="progress w-100" style="height: 5px;">
            <div class="progress-bar bg-${type}" role="progressbar" style="width: 100%; transition: width 5s linear;"></div>
          </div>
          <button type="button" class="btn-close btn-close-white position-absolute top-0 end-0 m-2" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    `;
    document.body.appendChild(toastContainer);
  
    const toastEl = document.getElementById("dynamicToast");
    const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
  
    toast.show();
  
    // Animate progress bar shrink
    setTimeout(() => {
      toastEl.querySelector(".progress-bar").style.width = "0%";
    }, 100);
  }