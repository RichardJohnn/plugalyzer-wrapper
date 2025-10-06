#!/usr/bin/env node
import readline from "readline";
import Database from "better-sqlite3";
import { execa } from "execa";
import path from "path";

const db = new Database("plugins.db");
const PLUGALYZER = "Plugalyzer";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "plugins> "
});

console.log("🎛️  Plugin REPL - type 'help' for commands");

let pipeline = []; // stores plugin objects

rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  const [command, ...args] = input.split(" ");

  switch (command) {
    case "help":
      console.log(`
Available commands:
  search <text>           Search plugins by name
  list                    List all plugins
  show <id>               Show parameters for a plugin
  add <id>                Add a plugin to the current pipeline
  list_pipeline           List plugins in the pipeline
  run_pipeline <in> <out> Run the pipeline on input file
  exit                    Quit the REPL
      `);
      break;

    case "search":
      if (!args.length) { console.log("Usage: search <text>"); break; }
      const query = `%${args.join(" ")}%`;
      const results = db.prepare("SELECT id, name, path FROM plugins WHERE name LIKE ?").all(query);
      if (!results.length) console.log("No plugins found");
      else results.forEach(p => console.log(`- [${p.id}] ${p.name} (${p.path})`));
      break;

    case "list":
      const allPlugins = db.prepare("SELECT id, name, path FROM plugins").all();
      allPlugins.forEach(p => console.log(`- [${p.id}] ${p.name} (${p.path})`));
      break;

    case "show":
      if (!args.length) { console.log("Usage: show <id>"); break; }
      const id = parseInt(args[0], 10);
      if (isNaN(id)) { console.log("Invalid plugin ID"); break; }
      const plugin = db.prepare("SELECT * FROM plugins WHERE id = ?").get(id);
      if (!plugin) { console.log(`No plugin found with ID ${id}`); break; }
      console.log(`🎚️  Plugin: ${plugin.name} (${plugin.path})`);
      const params = db.prepare(`
        SELECT * FROM parameters
        WHERE plugin_id = ?
          AND "values" IS NOT NULL
          AND TRIM("values") != ''
          AND TRIM("values") != 'to'
      `).all(id);
      if (!params.length) console.log("No usable parameters found.");
      else params.forEach(p => console.log(`- [${p.param_index}] ${p.name} (default: ${p.default_value}, values: ${p.values})`));
      break;

    case "add":
      if (!args.length) { console.log("Usage: add <id> [--param name:value ...]"); break; }
      const addId = parseInt(args[0], 10);
      if (isNaN(addId)) { console.log("Invalid plugin ID"); break; }
      const addPlugin = db.prepare("SELECT * FROM plugins WHERE id = ?").get(addId);
      if (!addPlugin) { console.log(`No plugin found with ID ${addId}`); break; }

      // Parse optional parameters
      const pluginParams = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--param" && args[i + 1]) {
          pluginParams.push(args[i + 1]); // e.g., "Output:16dB"
          i++;
        }
      }

      pipeline.push({ ...addPlugin, params: pluginParams });
      console.log(`✅ Added to pipeline: ${addPlugin.name} ${pluginParams.length ? `(with params: ${pluginParams.join(", ")})` : ""}`);
      break;

    case "ls":
    case "list_pipeline":
      if (!pipeline.length) console.log("Pipeline is empty");
      else pipeline.forEach((p, i) => console.log(`${i + 1}. [${p.id}] ${p.name}`));
      break;

    case "reset":
      pipeline = [];
      break;

    case "r":
    case "run":
    case "run_pipeline":
      if (args.length < 2) { console.log("Usage: run_pipeline <input.wav> <output.wav>"); break; }
      if (!pipeline.length) { console.log("Pipeline is empty"); break; }

      let currentInput = path.resolve(args[0]);
      const finalOutput = path.resolve(args[1]);

      for (let i = 0; i < pipeline.length; i++) {
        const plug = pipeline[i];
        const outputFile = i === pipeline.length - 1 ? finalOutput : `${currentInput.replace(/(\.wav)$/i, "")}_step${i + 1}.wav`;

        console.log(`🔹 Step ${i + 1}: ${plug.name} -> ${path.basename(outputFile)}`);

        const cmdArgs = [
          "process",
          `--plugin=${plug.path}`,
          `--input=${currentInput}`,
          `--output=${outputFile}`,
          "--overwrite",
          ...plug.params.map(p => `--param=${p}`)
        ];

        try {
          await execa(PLUGALYZER, cmdArgs, { stdio: "inherit" });
        } catch (err) {
          console.error(`❌ Failed at step ${i + 1}:`, err.shortMessage || err.message);
          break;
        }

        currentInput = outputFile;
      }
      console.log(`🎉 Pipeline finished: ${finalOutput}`);
      break;

    case "exit":
      rl.close();
      return;

    default:
      console.log(`Unknown command: ${command}`);
  }

  rl.prompt();
});

rl.on("close", () => {
  console.log("Goodbye! 👋");
  process.exit(0);
});
