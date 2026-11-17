// Advisory client-side warning for free-text inputs (task T071). It NEVER blocks or replaces the server
// checks, which stay authoritative (spec FR-021); it only nudges people before they submit.

const SSN_LIKE = /\b\d{3}-\d{2}-\d{4}\b/;
const LABELLED_ID = /\b(?:MRN|medical record number|DOB|date of birth|SSN)\b\s*[:#]/i;

export function looksLikePhi(text: string): boolean {
  return SSN_LIKE.test(text) || LABELLED_ID.test(text);
}

export function PhiWarning({ value }: { value: string }) {
  if (!looksLikePhi(value)) return null;
  return (
    <p role="note">
      This looks like it may contain patient or personal health information. Do not enter PHI here.
      Submissions that contain it are blocked.
    </p>
  );
}
