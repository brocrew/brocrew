export const WORK_BRIEF_CHARS = 2000
export const SAVED_METHOD_CHARS = 200
export const WORK_FIELD_WORDS = {
  brief:
    'A short, self-contained brief. Anything over 2,000 characters arrives as a file the reader is pointed to.',
  condition:
    'What must be true when this is done, and how to check it. Required. Anything over 2,000 characters arrives as a file the reader is pointed to.',
  required: 'definition_of_done is required: say what done means and how to check it.',
  blank: 'definition_of_done must not be blank.',
} as const
