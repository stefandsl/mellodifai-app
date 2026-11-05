import { createHash, randomBytes } from "node:crypto";

export function newPat(): { token: string; hash: string; hint: string } {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let value = BigInt(`0x${randomBytes(32).toString("hex")}`);
  let encoded = "";
  while (value > BigInt(0)) {
    encoded = alphabet[Number(value % BigInt(62))] + encoded;
    value /= BigInt(62);
  }
  const token = `mdf_pat_${encoded.padStart(43, "0")}`;
  return {
    token,
    hash: createHash("sha256").update(token).digest("hex"),
    hint: `mdf_pat_...${token.slice(-4)}`,
  };
}
