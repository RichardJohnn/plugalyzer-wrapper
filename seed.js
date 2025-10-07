import { execa } from "execa";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const PLUGIN_DIRS = [
  "/Library/Audio/Plug-Ins/VST3",
  "/Library/Audio/Plug-Ins/Components",
];

const PLUGALYZER = "Plugalyzer";
const db = new Database("plugins.db");

db.exec(`
CREATE TABLE IF NOT EXISTS plugins (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE,
  name TEXT,
  last_scanned INTEGER
);
CREATE TABLE IF NOT EXISTS parameters (
  plugin_id INTEGER,
  param_index INTEGER,
  name TEXT,
  "values" TEXT,
  default_value TEXT,
  supports_text BOOLEAN DEFAULT 0,
  PRIMARY KEY(plugin_id, param_index),
  FOREIGN KEY(plugin_id) REFERENCES plugins(id)
);
`);

function findPlugins(dir) {
  let plugins = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".vst3") || entry.name.endsWith(".component")) {
        plugins.push(fullPath);
      } else {
        plugins.push(...findPlugins(fullPath));
      }
    }
  }
  return plugins;
}

async function listParameters(pluginPath) {
  try {
    const { stdout } = await execa(
      PLUGALYZER, 
      ["listParameters", `--plugin=${pluginPath}`],
      { timeout: 10000 } 
    );
    const lines = stdout.split("\n").map(l => l.trim()).filter(Boolean);
    const params = [];

    let current = null;
    for (const line of lines) {
      if (/^\d+:/.test(line)) {
        if (current) params.push(current);
        const [index, ...rest] = line.split(":");
        current = { param_index: parseInt(index, 10), name: rest.join(":").trim() };
      } else if (line.startsWith("Values:")) {
        current.values = line.replace("Values:", "").trim();
      } else if (line.startsWith("Default:")) {
        current.default_value = line.replace("Default:", "").trim();
      } else if (line.startsWith("Supports text values:")) {
        current.supports_text = /true/i.test(line);
      }
    }
    if (current) params.push(current);
    return params;
  } catch (err) {
    console.error(`❌ Failed to list parameters for ${pluginPath}:`, err.shortMessage || err.message);
    return [];
  }
}

function savePlugin(pluginPath, pluginName, parameters) {
  const stats = fs.statSync(pluginPath);
  const modifiedTime = Math.floor(stats.mtimeMs / 1000);

  // insert with last_scanned = 0 so it's always treated as new initially
  const pluginRow = db.prepare(`
    INSERT INTO plugins (path, name, last_scanned)
    VALUES (?, ?, 0)
    ON CONFLICT(path) DO UPDATE SET name=excluded.name
    RETURNING id, last_scanned
  `).get(pluginPath, pluginName);

  const plugin_id = pluginRow.id;

  // skip if already scanned and file hasn't changed
  if (pluginRow.last_scanned && pluginRow.last_scanned >= modifiedTime) {
    return false;
  }

  const insertParam = db.prepare(`
    INSERT OR REPLACE INTO parameters (
      plugin_id, param_index, name, "values", default_value, supports_text
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const p of parameters) {
    insertParam.run(
      plugin_id,
      p.param_index,
      p.name,
      p.values || "",
      p.default_value || "",
      p.supports_text ? 1 : 0
    );
  }

  // now update last_scanned after successful parameter save
  db.prepare(`UPDATE plugins SET last_scanned=? WHERE id=?`)
    .run(Math.floor(Date.now() / 1000), plugin_id);

  return true;
}

async function seed() {
  let allPlugins = [];
  for (const dir of PLUGIN_DIRS) {
    if (fs.existsSync(dir)) {
      allPlugins.push(...findPlugins(dir));
    }
  }

  console.log(`Found ${allPlugins.length} plugins...`);

  for (const pluginPath of allPlugins) {
    const pluginName = path.basename(pluginPath);
    console.log(`Seeding ${pluginName}...`);
    try {
      const params = await listParameters(pluginPath);
      if (params.length === 0) {
        console.warn(`⚠️  No parameters for ${pluginName}`);
        continue;
      }
      const updated = savePlugin(pluginPath, pluginName, params);
      if (updated) console.log(`✅ ${pluginName} seeded`);
      else console.log(`⏭ ${pluginName} unchanged, skipped`);
    } catch (err) {
      console.error(`❌ Failed to seed plugin ${pluginPath}:`, err.message);
    }
  }

  console.log("🎉 All plugins processed!");
}

seed();
