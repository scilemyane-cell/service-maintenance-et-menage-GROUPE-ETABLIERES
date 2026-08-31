import { app } from "./firebase-init.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const storage = getStorage(app);

export async function uploadPhoto(dossierId, sectionIndex, file) {
  const path = `sites-dossiers/${dossierId}/${sectionIndex}/${Date.now()}-${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  return { url, path };
}

export async function deletePhoto(path) {
  try { await deleteObject(ref(storage, path)); } catch (e) { console.warn("deletePhoto:", e); }
}
