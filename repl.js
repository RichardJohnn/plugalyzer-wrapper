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
let inputFile = null;
let lastOutput = null;

rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) return rl.prompt();

  const [command, ...args] = input.split(" ");

  switch (command) {
    case "help":
      console.log(`
Available commands:
  search <text>                     Search plugins by name
  list                              List all plugins
  show <id>                         Show parameters for a plugin
  add <id> [--param name:value ...] Add a plugin to the pipeline
  ls, list_pipeline                 List plugins in the pipeline
  mod <index> --param name:value... Modify params for pipeline item at 1-based index
  remove <index>                    Remove plugin by 1-based pipeline index
  reset                             Reset the entire pipeline
  play_last, play, p      Play the last generated output
  r, run, run_pipeline <in> <out>   Run pipeline on input file
  in                                Set input file
  exit                              Quit the REPL
      `);
      break;

    case "in":
      if (!args.length) return console.log("Usage: in <file>");
      inputFile = args[0];
      break;

    case "search":
      if (!args.length) return console.log("Usage: search <text>");
      {
        const query = `%${args.join(" ")}%`;
        const results = db.prepare("SELECT id, name, path FROM plugins WHERE name LIKE ?").all(query);
        if (!results.length) console.log("No plugins found");
        else results.forEach(p => console.log(`- [${p.id}] ${p.name} (${p.path})`));
      }
      break;

    case "list":
      {
        const all = db.prepare("SELECT id, name, path FROM plugins").all();
        all.forEach(p => console.log(`- [${p.id}] ${p.name} (${p.path})`));
      }
      break;

    case "show":
      if (!args.length) return console.log("Usage: show <id>");
      {
        const id = parseInt(args[0], 10);
        if (isNaN(id)) return console.log("Invalid plugin ID");
        const plugin = db.prepare("SELECT * FROM plugins WHERE id = ?").get(id);
        if (!plugin) return console.log(`No plugin found with ID ${id}`);
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
      }
      break;

    case "add": {
      if (!args.length) return console.log("Usage: add <id> [name:value ...]");
      const addId = parseInt(args[0], 10);
      if (isNaN(addId)) return console.log("Invalid plugin ID");
      const plug = db.prepare("SELECT * FROM plugins WHERE id = ?").get(addId);
      if (!plug) return console.log(`No plugin found with ID ${addId}`);

      // Take everything after the first argument as params
      const pluginParams = args.slice(1);

      pipeline.push({ ...plug, params: pluginParams });
      console.log(`✅ Added to pipeline: ${plug.name} ${pluginParams.length ? `(with params: ${pluginParams.join(", ")})` : ""}`);
      break;
    }

    case "ls":
    case "list_pipeline":
      if (inputFile) console.log(`Input: ${inputFile}`);
      if (!pipeline.length) console.log("Pipeline is empty");
      else pipeline.forEach((p, i) => console.log(`${i + 1}. [${p.id}] ${p.name} ${p.params?.length ? `(params: ${p.params.join(", ")})` : ""}`));
      break;

    case "mod":
    case "modify": {
      if (args.length < 2) return console.log("Usage: mod <index> name:value ...");
      const parsedIdx = parseInt(args[0], 10);
      if (isNaN(parsedIdx)) return console.log("Invalid index");
      const modIndex = parsedIdx - 1;
      if (modIndex < 0 || modIndex >= pipeline.length) return console.log("Index out of range");

      const newParams = args.slice(1);
      if (!newParams.length) return console.log("Usage: mod <index> name:value ... (provide one or more entries)");

      const prev = pipeline[modIndex].params || [];
      pipeline[modIndex].params = newParams;

      console.log(`✅ Modified pipeline[${parsedIdx}] params`);
      console.log(`   before: ${prev.length ? prev.join(", ") : "(none)"}`);
      console.log(`   after:  ${newParams.join(", ")}`);
      break;
    }

    case "remove": {
      if (!args.length) return console.log("Usage: remove <index>");
      const parsedRemove = parseInt(args[0], 10);
      if (isNaN(parsedRemove)) return console.log("Invalid index");
      const rmIndex = parsedRemove - 1;
      if (rmIndex < 0 || rmIndex >= pipeline.length) return console.log("Index out of range");
      const removed = pipeline.splice(rmIndex, 1)[0];
      console.log(`🗑️  Removed: ${removed.name}`);
      break;
    }

    case "reset":
      pipeline = [];
      console.log("🔄 Pipeline cleared");
      break;

    case "r":
    case "run":
    case "run_pipeline": {
      if (args.length < 1) return console.log("Usage: run_pipeline <input.wav> [output.wav]");
      if (!pipeline.length) return console.log("Pipeline is empty");

      let currentInput = path.resolve(args[0]);
      const finalOutput = args[1]
      ? path.resolve(args[1])
      : path.resolve(`out_${Date.now()}.wav`);

      for (let i = 0; i < pipeline.length; i++) {
        const plug = pipeline[i];
        const outputFile = i === pipeline.length - 1 ? finalOutput
          : `${currentInput.replace(/(\.wav)$/i, "")}_step${i + 1}.wav`;

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

      lastOutput = finalOutput;
      console.log(`🎉 Pipeline finished: ${finalOutput}`);
      break;
    }

    case "play_last":
    case "play":
    case "p": {
      if (!lastOutput) return console.log("No output file generated yet.");
      console.log(`▶️ Playing ${lastOutput}`);
      try {
        await execa("afplay", [lastOutput], { stdio: "inherit" });
      } catch (err) {
        console.error("❌ Failed to play:", err.shortMessage || err.message);
      }
      break;
    }

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
