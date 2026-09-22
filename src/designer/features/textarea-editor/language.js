// Syntax-mode detection for the large text editor.
//
// The editor has no "auto" mode: detection always runs, and the header
// dropdown reports what it found. Picking from the dropdown overrides the
// detector until the editor is closed and reopened.
//
// Pure: no DOM, no CodeMirror. Kept apart from modal.js so it can be tested
// (and reasoned about) without loading the ~600 KB editor.

/** Every mode the editor can be in, in dropdown order. */
export const LANGUAGE_OPTIONS = [
  { value: 'sql', label: 'SQL' },
  { value: 'spel', label: 'SpEL' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'java', label: 'Java' },
  { value: 'python', label: 'Python' },
  { value: 'plain', label: 'Plain' }
];

// A SQL statement, judged by how it OPENS rather than by any keyword appearing
// somewhere in it — `from` and `where` turn up in prose and SpEL alike.
const SQL_STATEMENT_RE =
  /^\s*(?:with|select|insert\s+into|update|delete\s+from|merge|replace\s+into|create|alter|drop|truncate)\b/i;
// A SELECT ... FROM pair anywhere, for fragments that do not open cleanly —
// a leading comment, or a snippet pasted from the middle of a statement.
const SQL_SHAPE_RE = /\bselect\b[\s\S]*\bfrom\b/i;

// SpEL, identified only by constructs unique to it: an interpolation block or
// a T() type reference. An earlier detector also accepted the bare words
// and/or/not/eq/ne/lt/gt/le/ge, which match ordinary SQL and English — a plain
// `a = 1 and b = 2` was enough to be called SpEL.
const SPEL_RE = /#\{[\s\S]*?\}|\bT\(\s*[\w.$]+\s*\)/;

// Java, by constructs JavaScript cannot produce: a `package`/`import` line
// terminated with a semicolon (JS imports quote their source), an access
// modifier introducing a member, an annotation, or System.out.
const JAVA_RE = new RegExp([
  /^\s*package\s+[\w.]+\s*;/.source,
  /^\s*import\s+(?:static\s+)?[\w.]+(?:\.\*)?\s*;/.source,
  /^\s*@(?:Override|Test|Autowired|Component|Service|Entity|SpringBootApplication|FunctionalInterface)\b/.source,
  /\b(?:public|private|protected)\s+(?:static\s+|final\s+|abstract\s+|synchronized\s+)*(?:class|interface|enum|record|void|int|long|double|float|boolean|char|byte|short|String|List<|Map<|[A-Z][\w.]*(?:<[^>\n]*>)?(?:\[\])?)\s+\w+/.source,
  /\bSystem\.(?:out|err)\.print/.source
].join('|'), 'm');

// Python, by its block syntax and its own keywords. `def name(...):` and a
// dedicated `elif` have no JavaScript equivalent.
const PYTHON_RE = new RegExp([
  /^\s*(?:async\s+)?def\s+\w+\s*\([^\n]*\)\s*(?:->[^:\n]+)?:/.source,
  /^\s*class\s+\w+\s*(?:\([^\n]*\))?\s*:\s*$/.source,
  /^\s*from\s+[\w.]+\s+import\s+\w/.source,
  /^\s*(?:if|elif|for|while|with|try|except|finally|else)\b[^\n]*:\s*(?:#[^\n]*)?$/.source,
  /\belif\b/.source,
  /__name__|__init__|\bself\.\w/.source
].join('|'), 'm');

const JS_RE =
  /\b(?:const|let|var|function|return|class|import|export|async|await)\b|=>|console\./;

// JSON is bracket-delimited with a MATCHING closer — `{ ... ]` is neither a
// JSON object nor an array, so the pair is checked rather than "starts with one
// of {[ and ends with one of }]".
function looksLikeJson(sample) {
  const opener = sample[0];
  const closer = sample[sample.length - 1];
  const paired =
    (opener === '{' && closer === '}') || (opener === '[' && closer === ']');
  if (!paired) return false;

  try {
    JSON.parse(sample);
    return true;
  } catch {
    // A document being typed or repaired — a trailing comma, an unclosed
    // string, a single-quoted key — does not parse but is still JSON as far as
    // the person editing it is concerned, and highlighting it as anything else
    // is worse than useless. Require some structural evidence, so a random
    // `{...}` block of prose stays plain.
    return (
      /["']\s*:/.test(sample) // "key": ... (or a single-quoted key)
      || /^[[{]\s*[\]}]$/.test(sample) // {} / []
      || /^\[\s*[[{"]/.test(sample) // array of objects / arrays / strings
      || /^\[\s*-?\d/.test(sample) // array of numbers
    );
  }
}

/** The syntax mode for a piece of text. */
export function detectLanguage(text) {
  const sample = text.trim();
  if (!sample) return 'plain';

  if (looksLikeJson(sample)) return 'json';

  // SQL is tested BEFORE SpEL on purpose. Automation Designer SQL steps
  // routinely interpolate SpEL placeholders —
  //   select id from guardian where account_id = '#{userIdMetaDb}'
  // — and testing SpEL first meant every such statement was highlighted as
  // SpEL. A statement that opens as SQL is SQL, whatever it interpolates.
  if (SQL_STATEMENT_RE.test(sample) || SQL_SHAPE_RE.test(sample)) {
    return 'sql';
  }

  // Java before SpEL: SpEL's `T(java.lang.Math)` shares vocabulary with Java,
  // but a Java source file also carries package/modifier/annotation syntax that
  // a SpEL expression never does.
  if (JAVA_RE.test(sample)) return 'java';

  if (SPEL_RE.test(sample)) return 'spel';

  // Python before JavaScript: both use `class`, `import` and `return`, so the
  // Python patterns (which are colon-terminated blocks and Python-only
  // keywords) get first refusal.
  if (PYTHON_RE.test(sample)) return 'python';

  if (JS_RE.test(sample)) return 'javascript';

  return 'plain';
}
