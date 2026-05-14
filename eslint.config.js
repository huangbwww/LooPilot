import globals from "globals";
import react from "eslint-plugin-react";

export default [
  {
    ignores: ["build/**", "dist/**", "node_modules/**", ".loopilot/**", ".tmp/**", "android/app/src/main/assets/**"]
  },
  {
    files: ["**/*.{js,jsx,mjs}"],
    plugins: {
      react
    },
    settings: {
      react: {
        version: "detect"
      }
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "error",
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-undef": "error"
    }
  }
];
