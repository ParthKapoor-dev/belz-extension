// Running code in the inspected page from a DevTools page or panel.

type ExceptionInfo = chrome.devtools.inspectedWindow.EvaluationExceptionInfo;

/**
 * Evaluate `expression` in the inspected page and resolve with its value.
 * Resolves null when the expression threw, the page refused the evaluation,
 * or DevTools is not available — callers treat all of those as "no answer".
 */
export function evalInPage(expression: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      chrome.devtools.inspectedWindow.eval(expression, (result: unknown, info?: ExceptionInfo) => {
        if (info && (info.isException || info.isError)) resolve(null);
        else resolve(result ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}
