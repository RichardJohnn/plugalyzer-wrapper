#!/usr/bin/env node
import { execa } from "execa";
import path from "path";
import { globSync } from "glob";

// ------------------ CLI parsing ------------------
const args = process.argv.slice(2);

if (!args.length) {
  console.error("Usage: node truncate_silence.js [options] <file(s)>");
  console.error("Options:");
  console.error("  --threshold <dB>   Silence threshold, default -40dB");
  console.error("  --duration <sec>   Minimum silence duration, default 0.001");
  process.exit(1);
}

let threshold = "-40dB";
let duration = "0.001";

const patterns = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--threshold" && args[i + 1]) {
    threshold = args[i + 1];
    i++;
  } else if (args[i] === "--duration" && args[i + 1]) {
    duration = args[i + 1];
    i++;
  } else {
    patterns.push(args[i]);
  }
}

if (!patterns.length) {
  console.error("No files provided.");
  process.exit(1);
}

// ------------------ Resolve files ------------------
const files = patterns.flatMap(pat => globSync(pat)).sort();

if (!files.length) {
  console.error("No files matched the patterns");
  process.exit(1);
}

const trimmedFiles = [];

// ------------------ Trim silence ------------------
for (const f of files) {
  const absPath = path.resolve(f);
  const trimmedPath = absPath.replace(/(\.wav)$/i, "_trimmed.wav");
  trimmedFiles.push(trimmedPath);

  console.log(`🔹 Trimming silence: ${path.basename(absPath)} -> ${path.basename(trimmedPath)}`);

  await execa("sox", [
    absPath,        // input
    trimmedPath,    // output
    "silence", "1", duration, threshold,
    "reverse",
    "silence", "1", duration, threshold,
    "reverse"
  ], { stdio: "inherit" });
}

// ------------------ Concatenate ------------------
if (trimmedFiles.length > 1) {
  const finalOutput = "final.wav";
  console.log(`🔹 Concatenating into ${finalOutput}`);
  await execa("sox", [...trimmedFiles, finalOutput], { stdio: "inherit" });
  console.log(`🎉 Finished: ${finalOutput}`);
} else {
  console.log("Only one file trimmed, no concatenation needed.");
}
