import { defineConfig } from 'tsup';

export default defineConfig({
  // Three entries: the library, the back fill module (importable, and what the
  // tests drive), and the executable `bin` points at. `format` is global, so each
  // one is emitted as both ESM and CJS; the CLI's CJS build is unreferenced but
  // harmless, and tsup preserves the shebang on the ESM one that `bin` names.
  entry: ['src/index.ts', 'src/backfill.ts', 'src/backfill-cli.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
});
