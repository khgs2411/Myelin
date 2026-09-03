import { Application } from "../../src/application.ts";

const [databasePath, workingDirectory] = Bun.argv.slice(2);

if (!databasePath || !workingDirectory) {
  process.stderr.write(
    "Application probe requires a database path and working directory.\n",
  );
  process.exitCode = 2;
} else {
  try {
    const application = await Application.create({
      sqlite: { databasePath },
      workingDirectory,
    });
    await application.close();
    process.stdout.write("opened-and-closed\n");
  } catch (error) {
    const diagnostic =
      error instanceof Error ? error.message : "Application probe failed.";
    process.stderr.write(`${diagnostic}\n`);
    process.exitCode = 1;
  }
}
