// The "got it" cookie's value, pure so it's tested without a request:
// "~"-separated confirmation keys ("<recurringId>:<dueDate>"). A key whose
// due date is before today has done its job and is dropped.

const KEY_RE = /^[0-9a-f-]+:\d{4}-\d{2}-\d{2}$/i;

export function parseDismissed(value: string | undefined, today: string): string[] {
  if (!value) return [];
  return value
    .split("~")
    .filter((key) => KEY_RE.test(key))
    .filter((key) => key.slice(key.lastIndexOf(":") + 1) >= today);
}

export function serializeDismissed(keys: string[]): string {
  return keys.join("~");
}
