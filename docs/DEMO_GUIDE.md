# A five-minute PocketLedger demo

Use fictional information for screenshots, interviews and public demos. This application stores entries in its own database; it does not connect to a bank.

1. Choose **Explore a private demo**. Point out that this creates a separate visitor workspace, with sample entries explicitly marked fictional.
2. Explain the all-time balance versus selected-month income and spending. Change the month to demonstrate that totals, trend, transactions and budgets refer to the selected period.
3. Add an expense for **12.50**, category **Food**, with a fictional note. Show the new transaction and the updated Food spending.
4. Open **Budgets**, set a Food limit, and explain that a budget changes the comparison while leaving recorded transactions intact.
5. Edit or delete your new entry. Show that totals and budget progress update together.
6. Filter transactions by Food and export CSV. Explain that the export includes all matching rows even when the screen's 500-entry limit is reached.
7. Sign out. Open a second private demo to show that it has its own records.

## Explain the engineering

- **Money:** decimal strings are validated and converted to integer cents at the API boundary. For example, `0.10` plus `0.20` becomes exactly 30 cents.
- **Privacy:** parameterized queries scope reads and mutations to the session's user ID. Editing another user's transaction returns 404.
- **Authentication:** passwords use salted scrypt; sessions use HttpOnly cookies and only token hashes are stored server-side. Mutations require CSRF validation.
- **Exports:** potentially executable spreadsheet cells are neutralized before quoting. CSV applies the same owner, month and category filters as the API.
- **Evidence:** run `npm test` for behavioral integration tests, and `npm run build` for TypeScript and production compilation. A successful local run does not imply a hosted deployment.

## Discuss the next step honestly

This is a single-process portfolio MVP with USD only. Explain a practical next step, such as account deletion, automated backups, demo retention limits or a migration to PostgreSQL for multiple instances. Do not claim real users, financial outcomes or production scale without evidence.
