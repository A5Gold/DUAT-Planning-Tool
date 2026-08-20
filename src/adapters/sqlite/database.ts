/// <reference types="node" />

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { migrateSqliteDatabase } from "./migrations";

export interface OpenSqliteDatabaseOptions {
  readonly readonly?: boolean;
  readonly fileMustExist?: boolean;
  readonly migrate?: boolean;
  readonly timeoutMs?: number;
}

function isMemoryDatabase(filename: string): boolean {
  return filename === ":memory:" || filename.startsWith("file::memory:");
}

export function openSqliteDatabase(
  filename: string,
  options: OpenSqliteDatabaseOptions = {},
): Database.Database {
  const readonly = options.readonly ?? false;
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 0x7fffffff) {
    throw new TypeError("timeoutMs must be an integer between 0 and 2147483647");
  }
  const memory = isMemoryDatabase(filename);
  if (!memory && !readonly && !options.fileMustExist) {
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  }

  const databaseOptions: Database.Options = {
    readonly,
    timeout: timeoutMs,
  };
  if (options.fileMustExist !== undefined) {
    databaseOptions.fileMustExist = options.fileMustExist;
  }
  const database = new Database(filename, databaseOptions);

  try {
    database.pragma("foreign_keys = ON");
    database.pragma(`busy_timeout = ${timeoutMs}`);
    if (!readonly && !memory) {
      database.pragma("journal_mode = WAL");
      database.pragma("synchronous = NORMAL");
    }
    if ((options.migrate ?? !readonly) && !readonly) {
      migrateSqliteDatabase(database);
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function createSqliteDatabase(filename = ":memory:"): Database.Database {
  return openSqliteDatabase(filename, { migrate: true });
}
