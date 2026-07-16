export function isAIAnalysisEnabled(value: string): boolean {
  return value.trim().toLowerCase() !== 'false';
}
