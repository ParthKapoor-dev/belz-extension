// The AD input model: the data types an input can declare, what the extractor
// reads for each input, and conversion of page values back to JSON.

/** Every data type an AD input can declare, normalised. */
export type DataType =
  | 'Text'
  | 'Json'
  | 'Boolean'
  | 'Number'
  | 'Integer'
  | 'Array'
  | 'Date'
  | 'DateTime'
  | 'File'
  | 'Map'
  | 'Url'
  | 'StructuredData';

/** One input of the method, as read off the Inputs step. */
export interface ExtractedInput {
  /** The field code: what the JSON uses as the key. */
  key: string;
  /** Human name, or the key when the input has none. */
  name: string;
  type: DataType;
  /**
   * The element the test value is written to: the `exp-*` host for custom
   * widgets (boolean select, date picker), otherwise the plain field.
   */
  testValueElement: HTMLElement;
  mandatory: boolean;
  /** The test value currently on the page, as text. */
  currentValue: string;
  /** The input's grid row. */
  container: HTMLElement;
}

/** Page labels (lowercased, whitespace collapsed) -> the type they mean. */
const TYPE_BY_LABEL: Record<string, DataType> = {
  'text': 'Text',
  'json': 'Json',
  'boolean': 'Boolean',
  'number': 'Number',
  'integer': 'Integer',
  'interger': 'Integer', // Handle typo
  'array': 'Array',
  'date': 'Date',
  'datetime': 'DateTime',
  'date time': 'DateTime',
  'file': 'File',
  'map': 'Map',
  'url': 'Url',
  'structured data': 'StructuredData'
};

export function normalizeDataType(typeString: string | null | undefined): DataType {
  if (!typeString) return 'Text';

  // Normalize all whitespace (including non-breaking spaces from innerHTML)
  // so values like "Structured&nbsp;Data" map correctly.
  const normalized = typeString
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return TYPE_BY_LABEL[normalized] || 'Text';
}

/** A page value converted back to what the JSON should hold for its type. */
function toJsonValue(input: Pick<ExtractedInput, 'key' | 'type' | 'currentValue'>): unknown {
  const value = input.currentValue;
  switch (input.type) {
    case 'Json':
    case 'Array':
    case 'Map':
    case 'StructuredData':
      try {
        return JSON.parse(value);
      } catch (e) {
        console.error(`Error parsing value for ${input.key}:`, e);
        return value;
      }

    case 'Boolean':
      return value === 'true' || value === '1' || value === 'Yes';

    case 'Number':
    case 'Integer': {
      const n = parseFloat(value);
      return Number.isNaN(n) ? null : n;
    }

    default:
      // Date, DateTime, Url, Text, File: kept as the string.
      return value;
  }
}

/** The JSON object the editor shows for the inputs currently on the page. */
export function generateInputJSON(
  inputs: ReadonlyArray<Pick<ExtractedInput, 'key' | 'type' | 'currentValue'>>
): Record<string, unknown> {
  const json: Record<string, unknown> = {};
  for (const input of inputs) {
    json[input.key] = !input.currentValue || input.currentValue.trim() === ''
      ? null
      : toJsonValue(input);
  }
  return json;
}
