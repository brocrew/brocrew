export const WORK_BRIEF_CHARS = 2000
export const DONE_CONDITION_CHARS = 512
export const SAVED_METHOD_CHARS = 200
export const WORK_FIELD_WORDS = {
  brief:
    'A short, self-contained brief, at most 2000 characters. Put longer detail in an input file.',
  condition:
    'What must be true when this is done, and how to check it. Required, at most 512 characters.',
  required: 'definition_of_done is required: say what done means and how to check it.',
  blank: 'definition_of_done must not be blank.',
  conditionLimit:
    'definition_of_done is limited to 512 characters. Put the detail in an input file.',
  briefLimit: 'The brief is limited to 2000 characters. Put the rest in an input file.',
} as const
