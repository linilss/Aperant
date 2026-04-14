import type { TestStatus } from '../../../shared/types/tests';

/**
 * Maps a TRX outcome string to our TestStatus type.
 */
function mapOutcome(outcome: string): TestStatus {
  switch (outcome.toLowerCase()) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'notexecuted':
    case 'skipped':
    case 'ignored':
      return 'skipped';
    default:
      return 'unknown';
  }
}

/**
 * Converts a TRX duration string (hh:mm:ss.fffffff) to milliseconds.
 * Returns undefined when the input is missing or unparseable.
 */
function parseDuration(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  // Format: hh:mm:ss.fffffff  (or h:mm:ss.fffffff etc.)
  const match = duration.match(/^(\d+):(\d+):(\d+)(?:\.(\d+))?$/);
  if (!match) return undefined;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  // Fractional seconds – pad / truncate to 3 digits for ms
  const fracPart = match[4] ?? '0';
  const ms = Math.round(parseInt(fracPart.padEnd(3, '0').slice(0, 3), 10));

  return (hours * 3600 + minutes * 60 + seconds) * 1000 + ms;
}

/**
 * Extracts the value of a named XML attribute from an element open-tag string.
 * Returns empty string when the attribute is absent.
 */
function getAttribute(tag: string, attrName: string): string {
  // Match both single- and double-quoted attribute values
  const re = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = tag.match(re);
  if (!m) return '';
  return m[1] ?? m[2] ?? '';
}

/**
 * Extracts text content of the first occurrence of <tagName>...</tagName> in the
 * provided XML fragment. Returns undefined when the element is absent.
 */
function getElementText(xml: string, tagName: string): string | undefined {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : undefined;
}

export interface TrxTestRecord {
  fullName: string;
  status: TestStatus;
  durationMs?: number;
  errorMessage?: string;
  stackTrace?: string;
}

/**
 * Parses TRX XML content produced by `dotnet test --logger "trx"`.
 *
 * Extracts every <UnitTestResult> element and returns a flat array of
 * lightweight records that the caller can match to TestResult objects.
 */
export function parseTrxFile(trxContent: string): TrxTestRecord[] {
  const results: TrxTestRecord[] = [];

  // Split on every <UnitTestResult opening tag so we get one chunk per test
  const unitTestResultRegex = /<UnitTestResult\s([\s\S]*?)(?:<\/UnitTestResult>|(?=<UnitTestResult\s))/gi;

  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = unitTestResultRegex.exec(trxContent)) !== null) {
    const chunk = match[0];

    // The first line / opening tag contains the attributes
    const openingTagMatch = chunk.match(/<UnitTestResult\s([^>]*)/i);
    if (!openingTagMatch) continue;
    const openingTag = openingTagMatch[1];

    const testName = getAttribute(openingTag, 'testName');
    const outcome = getAttribute(openingTag, 'outcome');
    const durationStr = getAttribute(openingTag, 'duration');

    // fullName in TRX: typically "Namespace.ClassName.MethodName" lives in testName
    // Some runners also surface it in the testName attribute directly.
    const fullName = testName;

    const status = mapOutcome(outcome);
    const durationMs = parseDuration(durationStr) || undefined;

    // Error information lives inside <Output><ErrorInfo>...</ErrorInfo></Output>
    let errorMessage: string | undefined;
    let stackTrace: string | undefined;

    const outputMatch = chunk.match(/<Output>([\s\S]*?)<\/Output>/i);
    if (outputMatch) {
      const outputContent = outputMatch[1];
      const errorInfoMatch = outputContent.match(/<ErrorInfo>([\s\S]*?)<\/ErrorInfo>/i);
      if (errorInfoMatch) {
        errorMessage = getElementText(errorInfoMatch[1], 'Message');
        stackTrace = getElementText(errorInfoMatch[1], 'StackTrace');
      }
    }

    results.push({
      fullName,
      status,
      durationMs,
      errorMessage,
      stackTrace,
    });
  }

  return results;
}
