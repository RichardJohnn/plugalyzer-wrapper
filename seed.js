import { execa } from "execa";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

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

// Helper: recursively scan a directory for .vst3 files
function findPlugins(dir) {
  let plugins = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".vst3")) {
        plugins.push(fullPath); // ✅ bundle directory, not inner files
      } else {
        plugins.push(...findPlugins(fullPath)); // recurse
      }
    }
  }
  return plugins;
}

// Run Plugalyzer to list parameters
async function listParameters(pluginPath) {
  const { stdout } = await execa(PLUGALYZER, ["listParameters", "--plugin", pluginPath]);
  return stdout;
}

// Parse Plugalyzer output into structured array
function parseParameters(output) {
  const lines = output.split("\n").map(l => l.trim()).filter(Boolean);
  const params = [];
  let current = null;

  for (const line of lines) {
    if (/^\d+:/.test(line)) {
      // New parameter
      const [, index, name] = line.match(/^(\d+):\s*(.+)$/);
      current = { param_index: parseInt(index), name, values: "", default_value: "" };
      params.push(current);
    } else if (/^Values:/.test(line)) {
      current.values = line.replace(/^Values:\s*/, "");
    } else if (/^Default:/.test(line)) {
      current.default_value = line.replace(/^Default:\s*/, "");
    }
  }

  return params;
}

// Insert plugin and parameters into DB
function savePlugin(pluginPath, pluginName, parameters) {
  // Ensure plugin exists, and get its id
  const pluginRow = db.prepare(`
    INSERT INTO plugins (path, name) VALUES (?, ?)
    ON CONFLICT(path) DO UPDATE SET name=excluded.name
    RETURNING id
  `).get(pluginPath, pluginName);

  const plugin_id = pluginRow.id;

  const insertParam = db.prepare(`
    INSERT OR REPLACE INTO parameters (plugin_id, param_index, name, "values", default_value)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const p of parameters) {
    insertParam.run(plugin_id, p.param_index, p.name, p.values, p.default_value);
  }
}

async function seedPlugins(vstDir = "/Library/Audio/Plug-Ins/VST3") {
  const plugins = findPlugins(vstDir);
  console.log(`Found ${plugins.length} plugins...`);

  for (const pluginPath of plugins) {
    try {
      const pluginName = path.basename(pluginPath);
      console.log(`Seeding ${pluginName}...`);

      const paramOutput = await listParameters(pluginPath);
      const params = parseParameters(paramOutput);

      savePlugin(pluginPath, pluginName, params);
    } catch (err) {
      console.warn(`Failed to seed plugin ${pluginPath}:`, err.shortMessage || err.message);
    }
  }

  console.log("✅ All plugins seeded!");
}

// Run the seed
seedPlugins();
