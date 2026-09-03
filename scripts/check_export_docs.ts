const roots = ["packages", "extensions"];
const declaration =
  /^\s*export\s+(?:interface|type|class|enum)\s+[A-Za-z_$][\w$]*/;
const missing: string[] = [];

for (const root of roots) {
  try {
    await scan(root);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

if (missing.length > 0) {
  console.error("Exported type declarations must have JSDoc documentation:");
  for (const item of missing) console.error(`- ${item}`);
  Deno.exit(1);
}

async function scan(directory: string): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) {
      await scan(path);
      continue;
    }
    if (
      !entry.isFile || !entry.name.endsWith(".ts") ||
      entry.name.endsWith("_test.ts")
    ) continue;

    const lines = (await Deno.readTextFile(path)).split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!declaration.test(lines[index])) continue;
      if (!hasJsDoc(lines, index)) {
        missing.push(`${path}:${index + 1} ${lines[index].trim()}`);
      }
    }
  }
}

function hasJsDoc(lines: string[], declarationIndex: number): boolean {
  let index = declarationIndex - 1;
  while (index >= 0 && lines[index].trim() === "") index--;
  if (index < 0 || !lines[index].trim().endsWith("*/")) return false;

  for (; index >= 0; index--) {
    const line = lines[index].trim();
    if (line.startsWith("/**")) return true;
    if (!line.startsWith("*") && !line.endsWith("*/")) return false;
  }
  return false;
}
