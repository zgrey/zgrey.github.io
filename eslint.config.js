import js from "@eslint/js";
import globals from "globals";

// ESLint 10 flat config, replacing .eslintrc.json + eslint-config-standard.
// eslint-config-standard was never ported to flat config (it still peer-deps
// eslint ^8), and its entire stylistic ruleset was switched off in the old
// .eslintrc.json anyway, so `js.configs.recommended` is the honest baseline.
export default [
  {
    // Build output: generated copies of src/assets/js, previously linted twice.
    ignores: ["_site/**"],
  },
  js.configs.recommended,
  {
    // Browser-side widgets and page scripts. A mix of classic scripts
    // (theme.js, router.js) and ESM (player.js, the sst/widgets/* it imports);
    // eslint-config-standard parsed everything as ESM, so keep doing that —
    // classic scripts parse cleanly under sourceType: module.
    files: ["src/assets/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: globals.browser,
    },
    rules: {
      // Carried over from .eslintrc.json: this is long-lived visualization
      // code that leans on implicit globals and keeps unused scratch vars.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    // Eleventy config runs in Node as ESM ("type": "module").
    files: ["eleventy.config.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: globals.node,
    },
  },
];
