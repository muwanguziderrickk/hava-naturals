// // worker-management.js
import {
  db,
  storage,
  auth,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  ref,
  uploadBytes,
  getDownloadURL,
  createUserWithEmailAndPassword,
  signOut,
} from "../../js/firebase-config.js";

/* ----------  DOM refs ---------- */
const workerForm = document.getElementById("workerForm");
const workerList = document.getElementById("workerList");
const workerModal = new bootstrap.Modal(document.getElementById("workerModal"));
const photoInput = document.getElementById("workerPhoto");
const qualInput = document.getElementById("workerQualifications");
const branchSelect = document.getElementById("branchAssign");
const saveBtn = document.getElementById("saveWorkerBtn");
const addBtn = document.getElementById("addWorkerBtn");

/* ----------  Session user ---------- */
const currentUser = JSON.parse(
  sessionStorage.getItem("user-information") || "{}"
);
const isTopManager = currentUser.accessLevel === "Top Level Manager";
const isProtectedTM = isTopManager && currentUser.protected === true;

/* ----------  State ---------- */
let editingId = null;
let existingPhotoURL = "";
let existingQualURL = "";

/* ----------  Helpers ---------- */
const resetForm = () => {
  workerForm.reset();
  editingId = null;
  existingPhotoURL = existingQualURL = "";
  document.getElementById("password").parentElement.style.display = "block";
  document.getElementById("password").required = true;
  saveBtn.disabled = false;
  saveBtn.textContent = "Save Worker";
};

const uploadIfAny = async (file, folder) => {
  if (!file) return "";
  const fileRef = ref(storage, `${folder}/${Date.now()}_${file.name}`);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
};

const swalToast = (msg, icon = "success") =>
  Swal.fire({
    toast: true,
    position: "top-end",
    timer: 2500,
    showConfirmButton: false,
    icon,
    title: msg,
  });

/* ----------  Load branches ---------- */
onSnapshot(collection(db, "companyBranches"), (snap) => {
  branchSelect.innerHTML = "<option value=''>-- Select --</option>";
  snap.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.data().name;
    opt.dataset.name = d.data().name;
    branchSelect.appendChild(opt);
  });
});

/* ----------  Form submit ---------- */
workerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const branchOption = branchSelect.options[branchSelect.selectedIndex];
  const password = workerForm.password.value.trim();
  const data = {
    workerId: workerForm.workerId.value.trim(),
    fullName: workerForm.fullName.value.trim(),
    position: workerForm.position.value,
    contact: workerForm.contact.value.trim(),
    email: workerForm.email.value.trim(),
    schedule: workerForm.schedule.value.trim(),
    branchId: branchOption.value,                 // UID for queries
    branchName: branchOption.dataset.name,        // Name for display
    accessLevel: workerForm.accessLevel.value,
    disabled: false,
    protected: false,
    createdAt: serverTimestamp(),
    lastLoginAt: null
  };

  try {
    saveBtn.disabled = true;
    saveBtn.innerHTML =
      "<span class='spinner-border spinner-border-sm'></span> Saving…";

    const photoURL =
      (await uploadIfAny(photoInput.files[0], "worker_photos")) ||
      existingPhotoURL;
    const qualURL =
      (await uploadIfAny(qualInput.files[0], "worker_qualifications")) ||
      existingQualURL;

    if (editingId) {
      await updateDoc(doc(db, "workers", editingId), {
        ...data,
        photoURL,
        qualificationsURL: qualURL,
        updatedAt: serverTimestamp(),
      });
      swalToast("Worker updated");
    } else {
      const cred = await createUserWithEmailAndPassword(
        auth,
        data.email,
        password
      );
      await setDoc(doc(db, "workers", cred.user.uid), {
        ...data,
        uid: cred.user.uid,
        photoURL,
        qualificationsURL: qualURL,
      });
      Swal.fire({
        title: "Worker Account Created Successfully!",
        text: "For security reasons, you will now be signed out because creating a new user automatically logged you into that account.",
        icon: "success",
        confirmButtonText: "OK, Sign me out",
      }).then(async () => {
        localStorage.setItem(
          "postLogoutToast",
          JSON.stringify({
            message:
              "You were signed out because a new user session started. Please log in again!",
            type: "info",
          })
        );
        sessionStorage.clear();
        await signOut(auth);
      });
    }

    workerModal.hide();
    resetForm();
  } catch (err) {
    console.error(err);
    Swal.fire("Error", err.message, "error");
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Worker";
  }
});

/* ----------  Render table ---------- */
const renderRow = (id, w) => {
  const tr = document.createElement("tr");
  const isMe = id === currentUser.uid;
  const isTargetProtected = w.protected === true;

  const actionItems = [];
  actionItems.push(`<a class="dropdown-item" data-view="${id}">View</a>`);

  if (!isTargetProtected || isProtectedTM) {
    if (!isMe)
      actionItems.push(`<a class="dropdown-item" data-edit="${id}">Edit</a>`);
    if (!isMe)
      actionItems.push(
        `<a class="dropdown-item" data-toggle="${id}">${
          w.disabled ? "Enable" : "Disable"
        }</a>`
      );
    if (!isMe)
      actionItems.push(
        `<a class="dropdown-item text-danger" data-delete="${id}">Delete</a>`
      );
  }

  // Only protected top‑manager can flag/unflag
  if (isProtectedTM && !isMe) {
    actionItems.push(
      `<a class="dropdown-item" data-flag="${id}">${
        isTargetProtected ? "Unflag" : "Flag as Protected"
      }</a>`
    );
  }

  tr.innerHTML = `
    <td><img src="${
      w.photoURL
    }" class="rounded-circle" style="width:40px;height:40px;object-fit:cover"></td>
    <td>${w.fullName}</td>
    <td>${w.position}</td>
    <td>${w.branchName}</td>
    <td><a href="${w.qualificationsURL}" target="_blank">View PDF</a></td>
    <td>${w.disabled ? "Disabled" : "Enabled"}</td>
    <td>${w.lastLoginAt?.toDate().toLocaleString() || "—"}</td>
    <td>
      <div class="dropdown">
        <button class="btn btn-light dropdown-toggle" data-bs-toggle="dropdown"><i class="fas fa-ellipsis-v"></i></button>
        <label><div class="dropdown-menu dropdown-menu-end">${actionItems.join(
          ""
        )}</div></label>
      </div>
    </td>`;
  workerList.appendChild(tr);
};

/* ----------  Real‑time table ---------- */
onSnapshot(collection(db, "workers"), (snap) => {
  workerList.innerHTML = "";
  snap.forEach((d) => renderRow(d.id, d.data()));
});

/* ----------  Table action handler ---------- */
workerList.addEventListener("click", async (e) => {
  const anchor = e.target.closest("a");
  if (!anchor) return;

  const id =
    anchor.dataset.edit ||
    anchor.dataset.delete ||
    anchor.dataset.view ||
    anchor.dataset.toggle ||
    anchor.dataset.flag;
  if (!id) return;

  const docRef = doc(db, "workers", id);
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) return;

  const data = docSnap.data();
  const isMe = id === currentUser.uid;

  /* -- View -- */
  if (anchor.dataset.view) {
    return Swal.fire({
      title: "Worker Details",
      html: `
        <strong>Name:</strong> ${data.fullName}<br>
        <strong>Email:</strong> ${data.email}<br>
        <strong>Contact:</strong> ${data.contact}<br>
        <strong>Position:</strong> ${data.position}<br>
        <strong>Branch:</strong> ${data.branchName}<br>
        <strong>Access:</strong> ${data.accessLevel}<br>
        <strong>Status:</strong> ${data.disabled ? "Disabled" : "Enabled"}<br>
        <a href='${
          data.qualificationsURL
        }' target='_blank'>View Qualifications</a>
      `,
      imageUrl: data.photoURL,
      imageWidth: 100,
      imageHeight: 100,
      imageAlt: "Worker Photo",
    });
  }

  /* -- Protected check (others cannot touch protected users) -- */
  if (data.protected && !isProtectedTM) {
    return Swal.fire(
      "Forbidden",
      "You cannot modify a protected account.",
      "error"
    );
  }

  /* -- Prevent self delete/disable -- */
  if (isMe && (anchor.dataset.delete || anchor.dataset.toggle)) {
    return Swal.fire(
      "Forbidden",
      "You cannot disable or delete your own account.",
      "error"
    );
  }

  /* -- Edit -- */
  if (anchor.dataset.edit) {
    editingId = id;
    existingPhotoURL = data.photoURL || "";
    existingQualURL = data.qualificationsURL || "";

    // populate form fields
    [
      "workerId",
      "fullName",
      "position",
      "contact",
      "email",
      "schedule",
      "accessLevel",
    ].forEach((f) => {
      workerForm[f].value = data[f] || "";
    });
    /* pick the correct branch option */
    branchSelect.value = data.branchId || "";
    workerForm.email.disabled = true;
    document.getElementById("password").parentElement.style.display = "none";
    document.getElementById("password").required = false; // Remove required status
    workerModal.show();
    return;
  }

  /* -- Delete -- */
  if (anchor.dataset.delete) {
    const conf = await Swal.fire({
      title: "Delete?",
      text: "This cannot be undone!",
      icon: "warning",
      showCancelButton: true,
    });
    if (conf.isConfirmed) {
      await deleteDoc(docRef);
      swalToast("Worker deleted", "success");
    }
    return;
  }

  /* -- Disable / Enable -- */
  if (anchor.dataset.toggle) {
    await updateDoc(docRef, { disabled: !data.disabled });
    swalToast(`Worker ${data.disabled ? "enabled" : "disabled"}`);
    return;
  }

  /* -- Flag / Unflag (only protected TM) -- */
  if (anchor.dataset.flag && isProtectedTM) {
    await updateDoc(docRef, { protected: !data.protected });
    swalToast(
      `Worker ${data.protected ? "unflagged" : "flagged as protected"}`
    );
  }
});

/* ----------  Add Worker button ---------- */
addBtn.addEventListener("click", () => {
  resetForm();
  workerForm.email.disabled = false;
  workerModal.show();
});
