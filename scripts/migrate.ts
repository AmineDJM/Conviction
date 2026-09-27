import { openDb, databasePath } from "../src/db/client";
openDb();
console.log(`Migrated ${databasePath()}`);
