// Suppress convex-test warnings about direct function calls
// These are expected in test environments and don't affect test correctness
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  const message = args[0];
  if (
    typeof message === "string" &&
    message.includes(
      "Convex functions should not directly call other Convex functions",
    )
  ) {
    return;
  }
  originalWarn.apply(console, args);
};
