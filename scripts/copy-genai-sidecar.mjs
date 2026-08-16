import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve("src/server/services/genai/inference_sidecar.py");
const target = resolve("dist/inference_sidecar.py");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
