#!/usr/bin/env node
import readline from "readline";
import Database from "better-sqlite3";

const db = new Database("plugins.db");

// ---------------- REPL Setup ----------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "plugins> "
});

console.log("🎛️  Plugin REPL - type 'help' for commands");
rl.prompt();

// ---------------- REPL Loop ----------------
rl.on("line", (line) => {
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
  search <text>        Search plugins by name
  list                 List all plugins
  exit                 Quit the REPL
      `);
      break;

    case "search":
      if (!args.length) {
        console.log("Usage: search <text>");
        break;
      }
      const query = `%${args.join(" ")}%`;
      const results = db.prepare("SELECT id, name, path FROM plugins WHERE name LIKE ?").all(query);
      if (!results.length) {
        console.log("No plugins found");
      } else {
        results.forEach(p => console.log(`- [${p.id}] ${p.name} (${p.path})`));
      }
      break;

    case "list":
      const allPlugins = db.prepare("SELECT id, name, path FROM plugins").all();
      allPlugins.forEach(p => console.log(`- [${p.id}] ${p.name} (${p.path})`));
      break;

    case "show":
      if (!args.length) {
        console.log("Usage: show <id>");
        break;
      }
      const id = parseInt(args[0], 10);
      if (isNaN(id)) {
        console.log("Invalid plugin ID");
        break;
      }

      const plugin = db.prepare("SELECT * FROM plugins WHERE id = ?").get(id);
      if (!plugin) {
        console.log(`No plugin found with ID ${id}`);
        break;
      }

      console.log(`🎚️  Plugin: ${plugin.name} (${plugin.path})`);
      const params = db.prepare(`
        SELECT * FROM parameters
        WHERE plugin_id = ?
          AND "values" IS NOT NULL
          AND TRIM("values") != ''
          AND TRIM("values") != 'to'
      `).all(id);

      if (!params.length) {
        console.log("No usable parameters found.");
      } else {
        params.forEach(p => {
          console.log(`- [${p.param_index}] ${p.name} (default: ${p.default_value}, values: ${p.values})`);
        });
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
