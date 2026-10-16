import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "dist-e2e/**", "node_modules/**", "supabase/functions/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.browser }, rules: { "@typescript-eslint/no-explicit-any": "off" } },
);
