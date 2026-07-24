const fs = require("fs");
const path = require("path");

const ENV_PATH = path.resolve(".env");
const CONFIG_PATH = path.resolve("src/constants/config.ts");

if (!fs.existsSync(ENV_PATH)) {
  console.error(".env file not found.");
  process.exit(1);
}

const envContent = fs.readFileSync(ENV_PATH, "utf8");

// Extract KEY=value lines
const envKeys = envContent
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(
    (line) =>
      line &&
      !line.startsWith("#") &&
      line.includes("=")
  )
  .map((line) => line.split("=")[0].trim());

// Remove duplicates
const uniqueKeys = [...new Set(envKeys)].sort();

const configContent = `export const ENV_KEYS = {
${uniqueKeys
  .map((key) => `  ${key}: "${key}",`)
  .join("\n")}
} as const;
`;

fs.writeFileSync(CONFIG_PATH, configContent);

console.log(
  `✅ Synced ${uniqueKeys.length} environment keys to ${CONFIG_PATH}`
);