// @ts-check
import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/.turbo/**", "spike/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // NestJS: типы в конструкторах нужны как значения для emitDecoratorMetadata (DI),
    // поэтому автоматическое `import type` здесь ломает инъекцию.
    files: ["apps/api/**/*.ts", "apps/worker/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/vitest.config.ts"],
    rules: {
      "no-console": "off",
    },
  },
  eslintConfigPrettier,
);
