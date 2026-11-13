// Windows stand-in for the fs-xattr package used by Supabase Storage's file
// backend. Extended attributes are kept in NTFS alternate data streams named
// after the attribute ("object:user.supabase.content-type").
//
// Why streams and not sidecar files: Storage writes an upload to a temporary
// file, sets the attributes on it and then renames it into place; it removes
// an object by unlinking that one file and deletes the folder once it is
// empty. A stream belongs to the file, so it follows the rename, disappears
// with the unlink and never shows up in a directory listing. A sidecar keyed
// by path would be orphaned by each of those steps, and this module only sees
// attribute calls, never the rename or the unlink.
//
// Limits, stated on purpose: the volume must be NTFS (or ReFS), a copy to a
// file system or archive without streams drops the attributes, and attribute
// names cannot be listed without a native call.
import fs from "node:fs";
import { resolve } from "node:path";

function fail(code, syscall, path) {
  const error = new Error(`${code}: ${syscall} '${path}'`);
  error.code = code;
  error.syscall = syscall;
  error.path = path;
  return error;
}

function target(path, attribute, syscall) {
  if (typeof path !== "string" || path === "" || path.includes("\0"))
    throw fail("EINVAL", syscall, String(path));
  if (
    typeof attribute !== "string" ||
    attribute === "" ||
    /[:\\/\0]/.test(attribute)
  )
    throw fail("EINVAL", syscall, path);
  // A bare relative name plus ":attribute" would read as a drive letter.
  const file = resolve(path);
  return { file, stream: `${file}:${attribute}` };
}

function missing(error, file, syscall) {
  if (error?.code !== "ENOENT") return error;
  // The stream is absent. ENOENT stays ENOENT only when the file is too.
  return fs.existsSync(file) ? fail("ENODATA", syscall, file) : error;
}

export function getAttributeSync(path, attribute) {
  const { file, stream } = target(path, attribute, "getxattr");
  try {
    return fs.readFileSync(stream);
  } catch (error) {
    throw missing(error, file, "getxattr");
  }
}

export function setAttributeSync(path, attribute, value) {
  const { file, stream } = target(path, attribute, "setxattr");
  // Opening a stream on a missing file would create the file; xattr must not.
  const before = fs.statSync(file);
  fs.writeFileSync(stream, Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
  // Writing a stream moves the file's modification time; xattr does not.
  fs.utimesSync(file, before.atime, before.mtime);
}

export function removeAttributeSync(path, attribute) {
  const { file, stream } = target(path, attribute, "removexattr");
  let before;
  try {
    before = fs.statSync(file);
    fs.unlinkSync(stream);
  } catch (error) {
    throw missing(error, file, "removexattr");
  }
  fs.utimesSync(file, before.atime, before.mtime);
}

export function listAttributesSync(path) {
  throw fail("ENOTSUP", "listxattr", String(path));
}

export async function getAttribute(path, attribute) {
  return getAttributeSync(path, attribute);
}

export async function setAttribute(path, attribute, value) {
  setAttributeSync(path, attribute, value);
}

export async function removeAttribute(path, attribute) {
  removeAttributeSync(path, attribute);
}

export async function listAttributes(path) {
  return listAttributesSync(path);
}
