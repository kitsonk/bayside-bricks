// Tailwind CSS v3 — parity with the legacy Fresh 1.7.3 app, which pinned
// tailwindcss@3.4.1 through its Tailwind plugin. The legacy content globs
// also scanned the dead islands/Counter.tsx + components/Button.tsx, whose
// unused utilities are correctly absent from the compiled output here
// (MIGRATION_INVENTORY.md §6: dead code dropped in the port).
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
