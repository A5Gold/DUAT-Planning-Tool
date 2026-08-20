import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const database = new Database(":memory:");

try {
  database.exec("CREATE TABLE smoke (id INTEGER PRIMARY KEY)");
  const table = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'smoke'")
    .get();
  if (!table) throw new Error("SQLite smoke table was not created");
  console.log(
    "electron-native-sqlite-ok",
    process.versions.electron,
    process.versions.modules,
  );
} finally {
  database.close();
}
