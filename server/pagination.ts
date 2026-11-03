import { AppError, validDate } from "./domain.js";

export function pageLimit(value: unknown) {
  // Preserve the legacy first-page size for existing API consumers.
  if (value === undefined) return 500;
  if (
    typeof value !== "string" ||
    !/^[1-9]\d{0,2}$/.test(value) ||
    Number(value) > 500
  ) {
    throw new AppError(400, "Page size must be between 1 and 500.");
  }
  return Number(value);
}
export function readCursor(
  value: unknown,
  owner: number,
  month: string,
  category: string,
) {
  if (value === undefined) return undefined;
  const invalid = () =>
    new AppError(
      400,
      "This page cursor is invalid for the selected month and category. Refresh the list.",
    );
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw invalid();
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw invalid();
    const cursor = JSON.parse(bytes.toString("utf8"));
    if (
      !cursor ||
      Array.isArray(cursor) ||
      Object.keys(cursor).sort().join(",") !==
        "category,date,id,month,owner,v" ||
      cursor.v !== 1 ||
      cursor.owner !== owner ||
      cursor.month !== month ||
      cursor.category !== category ||
      typeof cursor.date !== "string" ||
      !validDate(cursor.date) ||
      !cursor.date.startsWith(month + "-") ||
      !Number.isSafeInteger(cursor.id) ||
      cursor.id < 1
    )
      throw invalid();
    return { date: cursor.date as string, id: cursor.id as number };
  } catch {
    throw invalid();
  }
}
export function nextCursor(
  owner: number,
  month: string,
  category: string,
  last: { date: string; id: number },
) {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      owner,
      month,
      category,
      date: last.date,
      id: last.id,
    }),
    "utf8",
  ).toString("base64url");
}
export function previousMonth(value: string) {
  if (value === "2000-01")
    throw new AppError(400, "January 2000 is the first supported month.");
  const date = new Date(value + "-01T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}
