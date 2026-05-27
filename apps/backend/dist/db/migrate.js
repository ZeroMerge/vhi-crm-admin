"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = __importDefault(require("../config/db"));
async function migrate() {
    const migrationsDir = path_1.default.join(__dirname, 'migrations');
    const files = fs_1.default.readdirSync(migrationsDir).sort();
    for (const file of files) {
        if (file.endsWith('.sql')) {
            const sql = fs_1.default.readFileSync(path_1.default.join(migrationsDir, file), 'utf-8');
            await db_1.default.query(sql);
            console.log(`Migrated: ${file}`);
        }
    }
    console.log('All migrations applied');
    await db_1.default.end();
}
migrate().catch(console.error);
//# sourceMappingURL=migrate.js.map