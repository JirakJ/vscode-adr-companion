import { runCli } from './cli';

runCli(process.argv.slice(2), {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t.endsWith('\n') ? t : `${t}\n`),
  cwd: process.cwd(),
  env: process.env,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`adr-companion: ${String(e)}\n`);
    process.exitCode = 2;
  },
);
