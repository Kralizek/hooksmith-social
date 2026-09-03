for await (const entry of Deno.readDir("examples")) {
  if (!entry.isDirectory) continue;

  const directory = `examples/${entry.name}`;
  const config = `${directory}/deno.json`;
  const hooksmithConfig = `${directory}/hooksmith.config.ts`;

  try {
    await Deno.stat(config);
    await Deno.stat(hooksmithConfig);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) continue;
    throw error;
  }

  const command = new Deno.Command(Deno.execPath(), {
    args: ["check", "--config", config, hooksmithConfig],
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.output();
  if (!status.success) Deno.exit(status.code);
}
