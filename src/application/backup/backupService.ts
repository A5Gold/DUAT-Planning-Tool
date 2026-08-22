import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface EventDatabaseBackup {
  readonly databasePath: string;
  readonly manifestPath: string;
  readonly checksum: string;
}

interface BackupManifest {
  kind: "manpower-planner-event-database";
  version: 1;
  filename: string;
  checksum: string;
  createdAt: string;
}

function checksum(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

export function backupEventDatabase(sourcePath: string, backupDirectory: string): EventDatabaseBackup {
  if (!existsSync(sourcePath)) throw new Error(`Event database not found: ${sourcePath}`);
  mkdirSync(resolve(backupDirectory), { recursive: true });
  const filename = basename(sourcePath);
  const destination = join(resolve(backupDirectory), filename);
  copyFileSync(sourcePath, destination);
  const manifest: BackupManifest = { kind: "manpower-planner-event-database", version: 1, filename, checksum: checksum(destination), createdAt: new Date().toISOString() };
  const manifestPath = join(resolve(backupDirectory), "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return { databasePath: destination, manifestPath, checksum: manifest.checksum };
}

export function restoreEventDatabase(backup: EventDatabaseBackup, targetDirectory: string): { databasePath: string; checksum: string } {
  const manifest = JSON.parse(readFileSync(backup.manifestPath, "utf8")) as BackupManifest;
  if (manifest.kind !== "manpower-planner-event-database" || manifest.version !== 1) throw new Error("Unsupported event database backup manifest.");
  const actual = checksum(backup.databasePath);
  if (actual !== manifest.checksum) throw new Error("Event database backup checksum mismatch.");
  const directory = resolve(targetDirectory);
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, manifest.filename);
  if (resolve(destination) === resolve(backup.databasePath)) throw new Error("Restore target must be a new data directory.");
  copyFileSync(backup.databasePath, destination);
  return { databasePath: destination, checksum: actual };
}
