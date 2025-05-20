import {
  db,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, orderBy,
  query, where, onSnapshot, runTransaction, serverTimestamp
} from "../../js/firebase-config.js";

// DOM refs
const productSelect = document.getElementById("allocateProductSelect");
const batchSelect = document.getElementById("batchSelect");
const branchSelect = document.getElementById("branchSelect");
const allocationForm = document.getElementById("allocationForm");
const allocateBtn = document.getElementById("allocateStockBtn");
const allocateSpinner = document.getElementById("allocateSpinner");
const allocateBtnText = document.getElementById("allocateBtnText");
const branchStockTableBody = document.getElementById("branchStockTableBody");

const branchNames = {};

// Load products
onSnapshot(collection(db, "companyProducts"), snap => {
  productSelect.innerHTML = '<option value="">Select Product</option>';
  snap.forEach(doc => {
    const d = doc.data();
    productSelect.innerHTML += `<option value="${doc.id}">${d.itemParticulars}</option>`;
  });
});

// Load branches
onSnapshot(collection(db, "companyBranches"), snap => {
  branchSelect.innerHTML = '<option value="">Select Branch</option>';
  snap.forEach(doc => {
    const d = doc.data();
    branchSelect.innerHTML += `<option value="${doc.id}">${d.name}</option>`;
    branchNames[doc.id] = d.name;
  });
});

// Update batches for selected product
productSelect.addEventListener("change", async () => {
  const pid = productSelect.value;
  batchSelect.innerHTML = '<option value="">Select Batch</option>';
  if (!pid) return;

  const q = query(collection(db, "companyStock"), where("productId", "==", pid));
  const snap = await getDocs(q);
  snap.forEach(doc => {
    const data = doc.data();
    if (data.remainingCompanyStockQuantity > 0) {
      batchSelect.innerHTML += `<option value="${doc.id}" data-available="${data.remainingCompanyStockQuantity}">
        ${data.batchCode} (Available: ${data.remainingCompanyStockQuantity})</option>`;
    }
  });
});

// Submit allocation
allocationForm.addEventListener("submit", async e => {
  e.preventDefault();

  const productId = productSelect.value;
  const batchId = batchSelect.value;
  const branchId = branchSelect.value;
  const quantity = parseInt(document.getElementById("allocateQuantity").value, 10);
  const availableQty = parseInt(batchSelect.options[batchSelect.selectedIndex]?.dataset.available || 0, 10);

  if (!productId || !batchId || !branchId || !quantity || quantity <= 0)
    return Swal.fire("Invalid Input", "Please fill all fields properly.", "warning");
  if (quantity > availableQty)
    return Swal.fire("Insufficient Stock", "Cannot allocate more than available.", "error");

  const confirm = await Swal.fire({
    title: "Confirm Allocation?",
    text: `Allocate ${quantity} unit(s) to branch?`,
    icon: "question",
    showCancelButton: true,
    confirmButtonText: "Yes, allocate"
  });
  if (!confirm.isConfirmed) return;

  allocateBtn.disabled = true;
  allocateSpinner.classList.remove("d-none");
  allocateBtnText.textContent = "Allocating...";

  try {
    const allocationId = `ASTB${Date.now()}`;

    await runTransaction(db, async (t) => {
      const batchRef = doc(db, "companyStock", batchId);
      const prodRef = doc(db, "companyProducts", productId);
      const branchStockRef = doc(db, "companyBranches", branchId, "branchStock", productId);
      const allocRef = doc(db, "allocatedStockToBranches", allocationId);

      // READS
      const [batchSnap, prodSnap, branchStockSnap] = await Promise.all([
        t.get(batchRef),
        t.get(prodRef),
        t.get(branchStockRef)
      ]);

      if (!batchSnap.exists()) throw new Error("Batch not found.");
      const currentQty = batchSnap.data().remainingCompanyStockQuantity;
      const newQty = currentQty - quantity;
      if (newQty < 0) throw new Error("Stock race condition – not enough remaining.");

      const particulars = prodSnap.exists() ? prodSnap.data().itemParticulars : "N/A";
      const currentBranchQty = branchStockSnap.exists() ? branchStockSnap.data().quantity : 0;

      // WRITES
      t.update(batchRef, { remainingCompanyStockQuantity: newQty });

      t.set(allocRef, {
        productId, batchId, branchId,
        quantityAllocated: quantity,
        itemParticulars: particulars,
        allocatedAt: serverTimestamp()
      });

      t.set(branchStockRef, {
        productId,
        quantity: currentBranchQty + quantity,
        updatedAt: serverTimestamp()
      }, { merge: true });
    });

    Swal.fire("Allocated!", "Stock successfully allocated.", "success");
    allocationForm.reset();
    batchSelect.innerHTML = '<option value="">Select Batch</option>';
  } catch (err) {
    Swal.fire("Error!", err.message, "error");
  } finally {
    allocateBtn.disabled = false;
    allocateSpinner.classList.add("d-none");
    allocateBtnText.textContent = "Allocate Stock";
  }
});

// Delete Allocation
branchStockTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".delete-btn");
  if (!btn) return;

  const { id: allocationId, batchId, qty, branchId, productId } = btn.dataset;
  const quantity = parseInt(qty);

  const confirm = await Swal.fire({
    title: "Delete Allocation?",
    text: "This will restore stock to the batch and remove branch quantity.",
    icon: "warning",
    showCancelButton: true
  });

  if (!confirm.isConfirmed) return;

  try {
    await runTransaction(db, async (t) => {
      const allocRef = doc(db, "allocatedStockToBranches", allocationId);
      const batchRef = doc(db, "companyStock", batchId);
      const branchStockRef = doc(db, "companyBranches", branchId, "branchStock", productId);

      const [batchSnap, branchSnap] = await Promise.all([
        t.get(batchRef),
        t.get(branchStockRef)
      ]);

      const restoredQty = (batchSnap.data()?.remainingCompanyStockQuantity || 0) + quantity;
      const updatedBranchQty = (branchSnap.data()?.quantity || 0) - quantity;

      t.delete(allocRef);
      t.update(batchRef, { remainingCompanyStockQuantity: restoredQty });

      if (updatedBranchQty <= 0) {
        t.delete(branchStockRef);
      } else {
        t.update(branchStockRef, { quantity: updatedBranchQty, updatedAt: serverTimestamp() });
      }
    });

    Swal.fire("Deleted!", "Allocation and branch stock adjusted.", "success");
  } catch (err) {
    Swal.fire("Error!", err.message, "error");
  }
});

// Live table
const allocQuery = query(
  collection(db, "allocatedStockToBranches"),
  where("allocatedAt", "!=", null),
  orderBy("allocatedAt", "desc")
);

onSnapshot(allocQuery, (snap) => {
  branchStockTableBody.innerHTML = "";
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    const branchName = branchNames[d.branchId] || d.branchId;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${d.productId}</td>
      <td>${d.itemParticulars}</td>
      <td>${branchName}</td>
      <td>${d.batchId}</td>
      <td>${d.quantityAllocated}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger delete-btn"
          data-id="${docSnap.id}" data-batch-id="${d.batchId}"
          data-qty="${d.quantityAllocated}" data-branch-id="${d.branchId}" data-product-id="${d.productId}">
          <i class="fas fa-trash-alt"></i> Delete
        </button>
      </td>`;
    branchStockTableBody.appendChild(row);
  });
});

