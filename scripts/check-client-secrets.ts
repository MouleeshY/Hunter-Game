import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const secretNames = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "SUPABASE_JWT_SECRET",
  "TICK_SECRET",
] as const;
const assetDirectory = join(process.cwd(), "dist", "assets");

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

const files = await listFiles(assetDirectory);
const needles = secretNames.flatMap((name) => {
  const value = process.env[name];
  return value ? [{ name, value }, { name, value: name }] : [{ name, value: name }];
});
const violations: string[] = [];

for (const file of files) {
  const contents = await readFile(file, "utf8");
  for (const needle of needles) {
    if (contents.includes(needle.value)) {
      violations.push(`${file} contains ${needle.name}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Server-only configuration was found in the client bundle:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Client bundle secret scan passed (${files.length} assets checked).`);
}
