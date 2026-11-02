import tseslint from "typescript-eslint";

// Residual config: Oxlint covers everything else. This one rule has no Oxlint equivalent
// (a value referenced only in type positions, e.g. `const a = 1; type T = typeof a`).
export default [
  { ignores: ["**/*.d.ts"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^$", caughtErrorsIgnorePattern: "^$", destructuredArrayIgnorePattern: "^$" }],
    },
  },
];
