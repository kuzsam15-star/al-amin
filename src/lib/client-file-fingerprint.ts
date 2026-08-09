async function fingerprint(file: File) {
  if (!globalThis.crypto?.subtle) return `${file.name}:${file.size}:${file.lastModified}`;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

export async function splitDuplicateFiles(incoming: File[], existing: File[] = []) {
  const known = new Set(await Promise.all(existing.map(fingerprint)));
  const unique: File[] = [];
  let duplicates = 0;
  for (const file of incoming) {
    const value = await fingerprint(file);
    if (known.has(value)) duplicates += 1;
    else {
      known.add(value);
      unique.push(file);
    }
  }
  return { unique, duplicates };
}

export async function hasDuplicateFiles(incoming: File[], existing: File[] = []) {
  const { duplicates } = await splitDuplicateFiles(incoming, existing);
  return duplicates > 0;
}
