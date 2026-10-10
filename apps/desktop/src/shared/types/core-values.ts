/** The project's core values (`.malvy/core-values.md`) */
export interface CoreValues {
  /** Free markdown text; '' when not set */
  text: string;
  /** When the values were last saved (ISO); null when not set */
  updatedAt: string | null;
}

export interface SaveCoreValuesResult {
  values: CoreValues;
  /** The text materially changed and existing competitor directions were flagged stale */
  directionsMarkedStale: boolean;
}
