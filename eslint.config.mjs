import { defineConfig } from "eslint/config";
// Next 16 ships native flat configs — no FlatCompat shim needed.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
]);
