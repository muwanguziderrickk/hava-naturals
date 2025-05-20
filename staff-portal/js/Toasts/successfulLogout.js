import { showToast } from "./showProgressBarToast.js";

window.addEventListener("DOMContentLoaded", () => {
    const toastData = localStorage.getItem("postLogoutToast");
    if (toastData) {
      const { message, type } = JSON.parse(toastData);
      showToast(message, type);
      localStorage.removeItem("postLogoutToast");
    }
  });