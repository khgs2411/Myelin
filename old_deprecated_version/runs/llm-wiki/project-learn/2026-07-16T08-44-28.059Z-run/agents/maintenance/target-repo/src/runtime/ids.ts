import { randomBytes } from "node:crypto";

export function timestampForFilename(now: Date): string {
  return now.toISOString().replace(/:/g, "-").replace(".000Z", "Z");
}

export function createId(now: Date = new Date()): string {
  return `${timestampForFilename(now)}_${randomBytes(3).toString("hex")}`;
}
