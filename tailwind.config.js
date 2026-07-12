/**
 * Tailwind config for the committed CSS build (styles.css).
 * app.js is scanned because it builds row/results markup from template
 * strings — its class names must survive the content scan.
 *
 * Rebuild with: npm run build:css  (requires Tailwind >= 3.4 — the nisab
 * radio cards use the has-[:checked] variant).
 */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./app.js"],
  theme: { extend: {} },
  plugins: [],
};
