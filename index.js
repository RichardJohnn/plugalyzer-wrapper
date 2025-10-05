import { execa } from "execa";
import Database from "better-sqlite3";
import readline from "readline";
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

export async function listParameters(pluginPath) {
  const { stdout } = await execa(PLUGALYZER, ["listParameters", `--plugin`, pluginPath]);
  return stdout;
}

export async function scanPlugins(dir = "/Library/Audio/Plug-Ins/VST3") {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".vst3"));
  for (const f of files) {
    const pluginPath = `${dir}/${f}`;
    db.prepare("INSERT OR IGNORE INTO plugins (path, name) VALUES (?, ?)").run(pluginPath, f);
  }
}

export function getRandomPlugin() {
  return db.prepare("SELECT * FROM plugins ORDER BY RANDOM() LIMIT 1").get();
}

export function getParameters(plugin_id) {
  return db
    .prepare(
      `SELECT * FROM parameters
       WHERE plugin_id = ?
         AND "values" IS NOT NULL
         AND TRIM("values") != ''
         AND TRIM("values") != 'to'`
    )
    .all(plugin_id);
}

function randomValue(valuesStr) {
  const m = valuesStr.match(/(-?\d+\.?\d*)\s*to\s*(-?\d+\.?\d*)/);
  if (m) {
    const min = parseFloat(m[1]);
    const max = parseFloat(m[2]);
    return (Math.random() * (max - min) + min).toFixed(2) + (valuesStr.includes("%") ? "%" : "");
  }
  const options = valuesStr.split(" to ");
  return options[Math.floor(Math.random() * options.length)];
}

// ---------------- CLI ENTRY ----------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf("--input");
  const overwriteIdx = args.indexOf("--overwrite");
  const outputIdx = args.indexOf("--output");
  const pluginIdx = args.indexOf("--plugin");
  const recurseIdx = args.indexOf("--recurse");
  const randomFlag = args.includes("--random");

  // Parse fixed --param values
  const paramIndices = [];
  args.forEach((arg, idx) => { if (arg === "--param") paramIndices.push(idx); });
  const fixedParams = paramIndices.map(idx => {
    const kv = args[idx + 1];
    if (!kv.includes(":")) {
      console.error(`❌ Invalid --param value: ${kv}. Must be key:value`);
      process.exit(1);
    }
    return `--param=${kv}`;
  });

  let recurseCount = 1;
  if (recurseIdx !== -1) {
    recurseCount = parseInt(args[recurseIdx + 1], 10) || 1;
  }

  (async () => {
    let plugin;

    if (randomFlag || pluginIdx === -1) {
      plugin = getRandomPlugin();
    } else {
      const pluginPath = args[pluginIdx + 1];
      plugin = db.prepare("SELECT * FROM plugins WHERE path = ?").get(pluginPath);
    }

    if (!plugin) {
      console.error("No plugin found!");
      process.exit(1);
    }

    console.log(`🎲 Using plugin: ${plugin.name}`);

    const params = getParameters(plugin.id);
    const paramArgs = fixedParams.length ? fixedParams : params.map(p => `--param=${p.name}:${randomValue(p.values)}`);

    let currentInput = inputIdx !== -1 ? args[inputIdx + 1] : null;
    if (!currentInput) {
      console.error("No input file specified!");
      process.exit(1);
    }

    const outputBase = outputIdx !== -1 ? args[outputIdx + 1] : "out.wav";

    for (let i = 0; i < recurseCount; i++) {
      const outputFile = path.join(
        path.dirname(outputBase),
        `${path.basename(outputBase, path.extname(outputBase))}_${i}${path.extname(outputBase)}`
      );


      let overwrite = overwriteIdx !== -1;
      // Check if output exists and ask user
      if (!overwrite && fs.existsSync(outputFile)) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise(resolve => rl.question(`⚠️ Output file "${outputFile}" exists. Overwrite? (y/n): `, resolve));
        rl.close();
        if (!answer.toLowerCase().startsWith("y")) {
          console.log("❌ Aborted by user");
          process.exit(0);
        }
        overwrite = true;
      }

      const cmdArgs = [
        "process",
        `--plugin=${plugin.path}`,
        `--input=${currentInput}`,
        `--output=${outputFile}`,
        ...(overwrite ? ["--overwrite"] : []),
        ...paramArgs
      ];

      console.log(`🔹 Recursion step ${i + 1}: execa command:`);
      console.log(PLUGALYZER, cmdArgs.map(a => `"${a}"`).join(" "));

      try {
        await execa(PLUGALYZER, cmdArgs, { stdio: "inherit" });
      } catch (err) {
        console.error(`❌ Failed at recursion step ${i + 1}:`, err.shortMessage || err.message);
        process.exit(1);
      }

      currentInput = outputFile; // next input
    }

    console.log("🎉 Recursive processing finished!");
  })();
}
