import nextVitals from "eslint-config-next/core-web-vitals";

const config = [{ ignores: ["**/*.d.mts"] }, ...nextVitals, {
  rules: {
    // These existing controlled editors intentionally synchronize their initial
    // values after a server refresh; React Compiler's advisory rule is not a
    // correctness failure for this form architecture.
    "react-hooks/set-state-in-effect": "off",
  },
}];
export default config;
