export const expenseCategories = [
  "Food",
  "Housing",
  "Transport",
  "Study",
  "Health",
  "Leisure",
  "Other",
] as const;
export const incomeCategories = ["Allowance", "Work", "Other income"] as const;
export const allCategories = [...expenseCategories, ...incomeCategories];
export const MAX_CENTS = 999999999;
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function moneyToCents(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value.trim())
  )
    throw new AppError(
      400,
      "Use a positive amount with up to two decimal places.",
    );
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents < 1 || cents > MAX_CENTS)
    throw new AppError(400, "Amount must be between $0.01 and $9,999,999.99.");
  return cents;
}
export function decimal(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return (
    sign +
    Math.floor(Math.abs(cents) / 100) +
    "." +
    String(Math.abs(cents) % 100).padStart(2, "0")
  );
}
export function validDate(value: string) {
  return (
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
  );
}
export function month(value: unknown): string {
  if (typeof value !== "string" || !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(value))
    throw new AppError(400, "Choose a valid month between 2000 and 2099.");
  return value;
}
export function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export interface Entry {
  id: number;
  type: "income" | "expense";
  category: string;
  amountCents: number;
  date: string;
  note: string;
}
