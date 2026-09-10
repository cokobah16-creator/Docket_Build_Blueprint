// The SHA-256 of a file, as lower-case hex.
//
// document_versions.checksum is what makes a served process proof of service:
// process_service snapshots the checksum of the exact version served, so the
// firm that was served can show that the document it holds is the document it
// was sent, and the firm that served it cannot quietly swap the file afterwards.
// A column nobody writes would make that claim untrue, which is why the hash is
// computed here at upload and never derived later from a file that has already
// had the chance to change.
//
// crypto.subtle is available in every browser Docket supports and in the Edge
// runtime, but only over HTTPS (and localhost). Uploads are capped well below
// the point where reading the file into memory to hash it becomes a problem.

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/**
 * Returns the hex SHA-256 of the blob, or null when the platform cannot hash it
 * (an insecure origin, an ancient browser). Null means "not recorded" — never a
 * wrong or partial hash, because a checksum that might be wrong is worse than
 * none at all.
 */
export async function sha256Hex(file: Blob): Promise<string | null> {
  const subtle = typeof globalThis.crypto !== "undefined" ? globalThis.crypto.subtle : undefined;
  if (!subtle) return null;
  try {
    const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
    const bytes = new Uint8Array(digest);
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) out += HEX[bytes[i]];
    return out;
  } catch {
    return null;
  }
}
