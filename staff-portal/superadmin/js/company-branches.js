import {
  db,
  storage,
  collection,
  setDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
  ref,
  uploadBytes,
  getDownloadURL,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
} from "../../js/firebase-config.js";

// Elements
const form = document.getElementById("branchForm");
const branchList = document.getElementById("branchList");
const photoInput = document.getElementById("branchPhoto");

let editMode = false;
let editingBranchId = null; // To track the branch being edited
let existingPhotoURL = "";

// Get form data
const getFormData = () => {
  return {
    name: document.getElementById("branchName").value.trim(),
    location: document.getElementById("branchLocation").value.trim(),
    contact: document.getElementById("branchContact").value.trim(),
    email: document.getElementById("branchEmail").value.trim(),
    managerName: document.getElementById("managerName").value.trim(),
    managerEmail: document.getElementById("managerEmail").value.trim(),
    status: document.getElementById("branchStatus").value,
    services: [
      ...(document.getElementById("supplements").checked ? ["Supplements"] : []),
      ...(document.getElementById("consultation").checked
        ? ["Consultation"]
        : []),
      ...(document.getElementById("detoxification").checked ? ["Detoxification"] : []),
      ...(document.getElementById("nutritionalGuidance").checked
        ? ["Nutritional Guidance"]
        : []),
    ],
    openingTime: document.getElementById("openingTime").value,
    closingTime: document.getElementById("closingTime").value,
  };
};

// Add new branch or update existing branch
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = getFormData();

  // Basic validation
  if (!data.name || !data.location) {
    return alert("Branch Name and Location are required.");
  }
  // Disable button and show spinner
  const saveBtn = document.getElementById("saveBranchBtn");
  const saveSpinner = document.getElementById("saveSpinner");
  const saveBtnText = document.getElementById("saveBtnText");

  try {
    saveBtn.disabled = true;
    saveSpinner.classList.remove("d-none");
    saveBtnText.textContent = "Saving...";
    let photoURL = existingPhotoURL || ""; // Default to existing if no new photo is uploaded

    // Upload photo if available
    if (photoInput.files.length > 0) {
      const photoFile = photoInput.files[0];
      const photoRef = ref(
        storage,
        `branch_photos/${Date.now()}_${photoFile.name}`
      );
      await uploadBytes(photoRef, photoFile);
      photoURL = await getDownloadURL(photoRef);
    }

    const branchData = { ...data, photoURL, createdAt: serverTimestamp() };

    if (editMode) {
      // If we're in edit mode, update the branch in Firestore
      const docRef = doc(db, "companyBranches", editingBranchId);
      await updateDoc(docRef, branchData);
      Swal.fire("Updated!", "Branch updated successfully!", "success");
    } else {
      // Otherwise, create a new branch
      const branchesSnapshot = await getDocs(collection(db, "companyBranches"));
      let maxNumber = 0;

      branchesSnapshot.forEach((docSnap) => {
        const id = docSnap.id;
        const match = id.match(/^Branch(\d{3})$/);
        if (match) {
          const num = parseInt(match[1]);
          if (num > maxNumber) maxNumber = num;
        }
      });

      const nextNumber = (maxNumber + 1).toString().padStart(3, "0");
      const customBranchId = `Branch${nextNumber}`;
      // Save using custom ID
      await setDoc(doc(db, "companyBranches", customBranchId), branchData);
      Swal.fire(
        "Added!",
        `${customBranchId} added successfully!`,
        "success"
      );
    }

    // Reset form and modal
    form.reset();
    const modal = bootstrap.Modal.getInstance(
      document.getElementById("branchModal")
    );
    modal.hide();

    editMode = false;
    editingBranchId = null;
  } catch (error) {
    console.error("Error submitting form:", error);
    Swal.fire("Error!", "Failed to add or update branch.", "error");
  } finally {
    saveBtn.disabled = false;
    saveSpinner.classList.add("d-none");
    saveBtnText.textContent = "Save Branch";
  }
});

// Real-time listener for branches
const branchesQuery = query(
  collection(db, "companyBranches"),
  orderBy("createdAt", "desc")
);

onSnapshot(branchesQuery, (snapshot) => {
  branchList.innerHTML = "";
  snapshot.forEach((doc) => {
    const data = doc.data();
    const div = document.createElement("div");
    div.className = "col-md-3";

    div.innerHTML = `
      <div class="card branch-card shadow-sm">
        ${
          data.photoURL
            ? `<img src="${data.photoURL}" class="card-img-top object-fit-cover" style="height: 180px; object-fit: cover;" alt="${data.name} photo">`
            : ""
        }
        <div class="card-body">
          <h5 class="card-title">${data.name}</h5>
          <p class="card-text">${data.location}</p>
          <p class="small text-muted">${data.status || "Unknown Status"}</p>
          <button class="btn btn-sm btn-outline-primary me-2" data-id="${
            doc.id
          }"><i class="fas fa-edit"></i> Edit</button>
          <button class="btn btn-sm btn-outline-danger" data-id="${
            doc.id
          }"><i class="fas fa-trash-alt"></i> Delete</button>
        </div>
      </div>
    `;
    branchList.appendChild(div);
  });
});

// Edit Branch
branchList.addEventListener("click", async (e) => {
  const branchId = e.target.dataset.id;
  if (!branchId) return;

  if (e.target.textContent === " Edit") {
    const docRef = doc(db, "companyBranches", branchId);
    const docSnap = await getDoc(docRef);
    const data = docSnap.data();

    document.getElementById("branchName").value = data.name || "";
    document.getElementById("branchLocation").value = data.location || "";
    document.getElementById("branchContact").value = data.contact || "";
    document.getElementById("branchEmail").value = data.email || "";
    document.getElementById("managerName").value = data.managerName || "";
    document.getElementById("managerEmail").value = data.managerEmail || "";
    document.getElementById("branchStatus").value = data.status || "Active";
    document.getElementById("openingTime").value = data.openingTime || "";
    document.getElementById("closingTime").value = data.closingTime || "";

    // Set the services checkboxes
    document.getElementById("supplements").checked =
      data.services?.includes("Supplements") || false;
    document.getElementById("consultation").checked =
      data.services?.includes("Consultation") || false;
    document.getElementById("detoxification").checked =
      data.services?.includes("Detoxification") || false;
    document.getElementById("nutritionalGuidance").checked =
      data.services?.includes("Nutritional Guidance") || false;

    // Set edit mode
    editMode = true;
    editingBranchId = branchId;
    existingPhotoURL = data.photoURL || ""; // Save it for fallback
    const modal = new bootstrap.Modal(document.getElementById("branchModal"));
    modal.show();
  }

  if (e.target.textContent === " Delete") {
    Swal.fire({
      title: "Are you sure?",
      text: "This branch will be permanently deleted!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#d33",
      cancelButtonColor: "#3085d6",
      confirmButtonText: "Yes, delete it!",
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await deleteDoc(doc(db, "companyBranches", branchId));
          Swal.fire("Deleted!", "Branch has been deleted.", "success");
        } catch (error) {
          console.error("Error deleting branch:", error);
          Swal.fire("Error!", "Failed to delete branch.", "error");
        }
      }
    });
  }
});

document.getElementById("addBranchBtn").addEventListener("click", () => {
  form.reset();
  photoInput.value = "";
  editingBranchId = null;
  editMode = false;
  existingPhotoURL = "";

  // Uncheck all checkboxes (just in case)
  document.getElementById("supplements").checked = false;
  document.getElementById("consultation").checked = false;
  document.getElementById("detoxification").checked = false;
  document.getElementById("nutritionalGuidance").checked = false;

  const modal = new bootstrap.Modal(document.getElementById("branchModal"));
  modal.show(); // show the modal manually
});
