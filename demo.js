import { scanPlugins, getRandomPlugin, listParameters } from "./index.js";

await scanPlugins();

const plugin = getRandomPlugin();
console.log("🎲 Selected plugin:", plugin.name);

const params = await listParameters(plugin.path);
console.log(params);
