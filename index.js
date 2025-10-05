import { execa } from "execa";
import Database from "better-sqlite3";
import fs from "fs";

const db = new Database("plugins.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS plugins (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE,
    name TEXT
  );
  CREATE TABLE IF NOT EXISTS parameters (
    id INTEGER PRIMARY KEY,
    plugin_id INTEGER,
    param_index INTEGER,
    name TEXT,
    "values" TEXT,
    default_value TEXT,
    FOREIGN KEY(plugin_id) REFERENCES plugins(id)
  );
`);

const PLUGALYZER = "Plugalyzer";

export async function listParameters(pluginPath) {
  const { stdout } = await execa(PLUGALYZER, ["listParameters", `--plugin`, pluginPath]);
  return stdout;
}

export async function scanPlugins(dir = "/Library/Audio/Plug-Ins/VST3") {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".vst3"));
  for (const f of files) {
    const path = `${dir}/${f}`;
    db.prepare("INSERT OR IGNORE INTO plugins (path, name) VALUES (?, ?)").run(path, f);
  }
}

export function getRandomPlugin() {
  const row = db.prepare("SELECT * FROM plugins ORDER BY RANDOM() LIMIT 1").get();
  return row;
}
