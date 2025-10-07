#!/usr/bin/env node
import readline from "readline";
import Database from "better-sqlite3";
import { execa } from "execa";
import path from "path";
import fs from "fs";

const db = new Database("plugins.db");
const PLUGALYZER = "Plugalyzer";
const AUTOSAVE_FILE = "autosave.json";

let pipeline = [];
let inputFile = null;
let lastOutput = null;

const saveState = (name = "state") => {
  const file = `${name}.json`;
  const data = { pipeline, inputFile, lastOutput };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  if (name !== "autosave") {
    console.log(`💾 Saved state to ${file}`);
  }
};

const loadState = (name = "state") => {
  const file = `${name}.json`;
  if (!fs.existsSync(file)) return console.log(`No saved state found: ${file}`);
  try {
    const { pipeline: pl, inputFile: inf, lastOutput: out } = JSON.parse(fs.readFileSync(file, "utf-8"));
    pipeline = pl || [];
    inputFile = inf || null;
    lastOutput = out || null;
    console.log(`📂 Loaded state from ${file}`);
    if (inputFile) console.log(`🎧 Input: ${inputFile}`);
    if (!pipeline.length) console.log("Pipeline empty");
    else pipeline.forEach((p, i) =>
      console.log(`${i + 1}. [${p.id}] ${p.name} ${p.params?.length ? `(params: ${p.params.join(", ")})` : ""}`)
    );
  } catch (err) {
    console.error("⚠️ Failed to load state:", err.message);
  }
};

const autosave = () => saveState("autosave");

// --- Load autosaved session if available ---
if (fs.existsSync(AUTOSAVE_FILE)) {
  console.log("🧠 Restoring previous session...");
  loadState("autosave");
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "plugins> "
});

console.log("🎛️  Plugin REPL - type 'help' for commands");
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
  add <id> [name:value ...]         Add a plugin to the pipeline
  ls, list_pipeline                 List plugins in the pipeline
  mod <index> name:value ...        Modify params for pipeline item
  rm, remove <index>                Remove plugin by 1-based index
  reset                             Reset the entire pipeline
  in <file>                         Set default input file
  r, run, run_pipeline [in] [out]   Run pipeline on input (default: in)
  play_last, play, p                Play the last generated output
  save [name]                       Save pipeline + settings (default: state)
  load [name]                       Load pipeline + settings (default: state)
  exit                              Quit the REPL
      `);
      break;

    case "in":
      if (!args.length) return console.log("Usage: in <file>");
      inputFile = args[0];
      autosave();
      console.log(`🎧 Input set to: ${inputFile}`);
      break;

    case "in_last":
      if (!lastOutput) return console.log("No last output available.");
      inputFile = lastOutput;
      autosave();
      console.log(`🎧 Input set to last output: ${inputFile}`);
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
            AND "name" NOT LIKE 'MIDI CC%'
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

      const pluginParams = args.slice(1);
      pipeline.push({ ...plug, params: pluginParams });
      autosave();
      console.log(`✅ Added to pipeline: ${plug.name} ${pluginParams.length ? `(params: ${pluginParams.join(", ")})` : ""}`);
      break;
    }

    case "ls":
    case "list_pipeline":
      if (inputFile) console.log(`🎧 Input: ${inputFile}`);
      if (!pipeline.length) console.log("Pipeline is empty");
      else pipeline.forEach((p, i) =>
        console.log(`${i + 1}. [${p.id}] ${p.name} ${p.params?.length ? `(params: ${p.params.join(", ")})` : ""}`)
      );
      break;

    case "mod": {
      if (args.length < 2) return console.log("Usage: mod <index> name:value ...");
      const parsedIdx = parseInt(args[0], 10);
      if (isNaN(parsedIdx)) return console.log("Invalid index");
      const modIndex = parsedIdx - 1;
      if (modIndex < 0 || modIndex >= pipeline.length) return console.log("Index out of range");

      // Join everything after the index into a single param string
      const newParams = [args.slice(1).join(" ")];

      const prev = pipeline[modIndex].params || [];
      pipeline[modIndex].params = newParams;
      autosave();

      console.log(`✅ Modified pipeline[${parsedIdx}] params`);
      console.log(`   before: ${prev.length ? prev.join(", ") : "(none)"}`);
      console.log(`   after:  ${newParams.join(", ")}`);
      break;
    }

    case "rm":
    case "remove": {
      if (!args.length) return console.log("Usage: remove <index>");
      const parsedRemove = parseInt(args[0], 10);
      if (isNaN(parsedRemove)) return console.log("Invalid index");
      const rmIndex = parsedRemove - 1;
      if (rmIndex < 0 || rmIndex >= pipeline.length) return console.log("Index out of range");
      const removed = pipeline.splice(rmIndex, 1)[0];
      autosave();
      console.log(`🗑️  Removed: ${removed.name}`);
      break;
    }

    case "reset":
      pipeline = [];
      autosave();
      console.log("🔄 Pipeline cleared");
      break;

    case "r":
    case "run":
    case "run_pipeline": {
      if (!pipeline.length) return console.log("Pipeline is empty");

      // Extract --recurse=N and remove it from args
      let recurse = 1;
      const filteredArgs = [];
      for (const a of args) {
        if (a.startsWith("--recurse")) {
          const parts = a.split("=");
          if (parts[1]) recurse = parseInt(parts[1], 10) || 1;
        } else {
          filteredArgs.push(a);
        }
      }

      // Determine input/output
      if (!inputFile && !filteredArgs[0]) return console.log("No input file set (use 'in <file>' or specify in run)");
      let initialInput = path.resolve(filteredArgs[0] || inputFile);
      const finalOutput = filteredArgs[1]
      ? path.resolve(filteredArgs[1])
      : path.resolve(`out_${Date.now()}.wav`);

      for (let r = 0; r < recurse; r++) {
        console.log(`🔁 Recursive pass ${r + 1} of ${recurse}`);
        let currentInput = r === 0 ? initialInput : lastOutput; // use lastOutput as input for next recursion
        for (let i = 0; i < pipeline.length; i++) {
          const plug = pipeline[i];
          const stepOutput = `${currentInput.replace(/(\.wav)$/i, "")}_r${r + 1}_step${i + 1}.wav`;
          const outputFile = i === pipeline.length - 1 ? finalOutput : stepOutput;

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

          currentInput = outputFile; // next step uses this output
        }

        lastOutput = finalOutput; // after each recursion, update lastOutput
        console.log(`✅ Completed recursive pass ${r + 1}`);
      }

      autosave();
      console.log(`🎉 Pipeline finished: ${finalOutput}`);
      break;
    }

    case "s":
    case "save":
      saveState(args[0] || "state");
      break;

    case "l":
    case "load":
      loadState(args[0] || "state");
      break;

    case "play_last":
    case "play":
    case "p":
      if (!lastOutput) return console.log("No output file generated yet.");
      console.log(`▶️ Playing ${lastOutput}`);
      try {
        await execa("afplay", [lastOutput], { stdio: "inherit" });
      } catch (err) {
        console.error("❌ Failed to play:", err.shortMessage || err.message);
      }
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
