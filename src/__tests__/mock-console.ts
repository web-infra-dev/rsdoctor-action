import { rstest } from "@rstest/core";

// Save original console methods
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};

// Mock console methods
export function mockConsole() {
  console.log = rstest.fn();
  console.warn = rstest.fn();
  console.error = rstest.fn();
}

// Restore original console methods
export function restoreConsole() {
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}
