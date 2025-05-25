import {
  db,
  storage,
  collection,
  onSnapshot,
  query,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  orderBy,
  serverTimestamp,
  ref,
  uploadBytes,
  getDownloadURL,
} from "../../js/firebase-config.js";

// 🔢 Generate sequential item code like HAV001
async function generateItemCode() {
  const snapshot = await getDocs(collection(db, "companyProducts"));
  const count = snapshot.size + 1;
  return `HAV${count.toString().padStart(3, "0")}`;
}

// 🧽 Reset form
function resetProductForm() {
  document.getElementById("productForm").reset();
  document.getElementById("editProductId").value = "";
}
window.resetProductForm = resetProductForm;

// ✅ Submit or Edit product
async function submitProduct() {
  const itemParticulars = document
    .getElementById("itemParticulars")
    .value.trim();
  const sellingPrice = document.getElementById("sellingPrice").value.trim();
  const description = document.getElementById("description").value.trim();
  const imageFile = document.getElementById("productImage").files[0];
  const editId = document.getElementById("editProductId").value;

  const saveBtn = document.getElementById("saveProductBtn");
  const spinner = document.getElementById("saveProductSpinner");
  const text = document.getElementById("saveProductText");

  if (!itemParticulars || !sellingPrice || !description) {
    Swal.fire(
      "Validation Error",
      "Please fill in all required fields.",
      "warning"
    );
    return;
  }

  try {
    // Show loading state
    saveBtn.disabled = true;
    spinner.classList.remove("d-none");
    text.textContent = "Saving...";

    let imageUrl = "";
    if (imageFile) {
      const storageRef = ref(
        storage,
        `companyProducts/${Date.now()}_${imageFile.name}`
      );
      await uploadBytes(storageRef, imageFile);
      imageUrl = await getDownloadURL(storageRef);
    }

    if (editId) {
      await updateDoc(doc(db, "companyProducts", editId), {
        itemParticulars,
        sellingPrice,
        description,
        ...(imageUrl && { imageUrl }),
      });
      Swal.fire("Updated!", "Product updated successfully.", "success");
    } else {
      const itemCode = await generateItemCode();
      await setDoc(doc(db, "companyProducts", itemCode), {
        itemCode,
        itemParticulars,
        sellingPrice,
        description,
        imageUrl,
        createdAt: serverTimestamp()
      });
      Swal.fire("Added!", "Product added successfully.", "success");
    }

    bootstrap.Modal.getInstance(
      document.getElementById("addProductModal")
    ).hide();
    resetProductForm();
  } catch (error) {
    Swal.fire("Error!", error.message, "error");
  } finally {
    // Reset button
    saveBtn.disabled = false;
    spinner.classList.add("d-none");
    text.textContent = "Save Product";
  }
}
window.submitProduct = submitProduct;

// 📡 Load products in real-time
function loadProducts() {
  const tbody = document.getElementById("productTableBody");
  const productsRef = collection(db, "companyProducts");
  const q = query(productsRef, orderBy("itemCode"));

  onSnapshot(q, (snapshot) => {
    tbody.innerHTML = "";
    snapshot.forEach((docSnap) => {
      const p = docSnap.data();
      const shortDesc =
        p.description.length > 30
          ? `${p.description.substring(
              0,
              30
            )}... <a href='#' onclick='window.showFullDescription("${
              docSnap.id
            }")'>Read more</a>`
          : p.description;

      tbody.innerHTML += `
        <tr>
          <td><img src="${
            p.imageUrl || ""
          }" alt="" style="width: 60px; height: auto;"></td>
          <td>${p.itemCode}</td>
          <td>${p.itemParticulars}</td>
          <td>UGX ${p.sellingPrice}</td>
          <td id="desc-${docSnap.id}">${shortDesc}</td>
          <td>
            <button class="btn btn-sm btn-warning" onclick="window.editProduct('${
              docSnap.id
            }')"><i class="fas fa-edit"></i> Edit</button>
            <button class="btn btn-sm btn-danger" onclick="window.deleteProduct('${
              docSnap.id
            }')"><i class="fas fa-trash-alt"></i> Delete</button>
          </td>
        </tr>`;
    });
  });
}
window.loadProducts = loadProducts;

// 📖 Read more
async function showFullDescription(productId) {
  const docSnap = await getDoc(doc(db, "companyProducts", productId));
  const p = docSnap.data();

  document.getElementById("modalProductImage").src = p.imageUrl || "";
  document.getElementById("modalItemParticulars").textContent =
    p.itemParticulars;
  document.getElementById("modalFullDescription").textContent = p.description;

  new bootstrap.Modal(document.getElementById("productDetailsModal")).show();
}
window.showFullDescription = showFullDescription;

// ✏️ Edit
async function editProduct(productId) {
  const docSnap = await getDoc(doc(db, "companyProducts", productId));
  const p = docSnap.data();
  document.getElementById("editProductId").value = productId;
  document.getElementById("itemParticulars").value = p.itemParticulars;
  document.getElementById("sellingPrice").value = p.sellingPrice;
  document.getElementById("description").value = p.description;
  new bootstrap.Modal(document.getElementById("addProductModal")).show();
}
window.editProduct = editProduct;

// 🗑️ Delete
async function deleteProduct(productId) {
  const docSnap = await getDoc(doc(db, "companyProducts", productId));
  const p = docSnap.data();
  const confirm = await Swal.fire({
    title: `Delete ${p.itemParticulars}?`,
    text: "This cannot be undone!",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Yes, delete it!",
  });

  if (confirm.isConfirmed) {
    try {
      await deleteDoc(doc(db, "companyProducts", productId));
      Swal.fire("Deleted!", "Product deleted successfully.", "success");
    } catch (error) {
      Swal.fire("Error!", error.message, "error");
    }
  }
}
window.deleteProduct = deleteProduct;

// ⏬ Start listening
loadProducts();
