// Single source of truth for the song prompt length limit across the public site composer,
// studio /create store, and create-song API schema. Zero runtime dependencies so browser
// islands can import it directly without pulling Zod.
export const PROMPT_MAX_LENGTH = 500;
