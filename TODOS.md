# TODOS

## Stock invariant reconciliation (deferred)

- **What:** A script (`scripts/reconcile-stock.js`) that recomputes
  `SUM(ProductLog.delta)` per product and reports any product whose stored
  `currentStock` disagrees with its own movement history.

- **Why:** The Product Stock feature rests on one invariant:
  `product.currentStock === SUM(ProductLog.delta for that product)`.
  Every in-app path that could break it is closed (the adjust route runs in a
  transaction, `updateProduct` whitelists `name`/`price`/`image` and can never
  write `currentStock`, and the idempotency key blocks double-apply). Nothing
  guards against a direct Atlas edit, a future migration, or a one-off script.
  Without this check, that kind of drift is silent: the number just looks wrong
  one day and there is no way to prove which side is correct.

- **Pros:** Turns a silent corruption into a one-command answer. Most of the
  logic is written anyway, because the vitest invariant test needs the identical
  aggregation.

- **Cons:** It is an operational script, and operational scripts get forgotten.
  The in-app protections already cover the likely causes.

- **Current state:** Not built. The invariant is asserted in
  `productController.test.js` against an in-memory database, so the *logic* is
  verified on every test run. There is no way to audit *production* data.

- **Where to start:** `ProductLog.aggregate([{ $group: { _id: '$product',
  sum: { $sum: '$delta' } } }])`, then `$lookup` into `products` and compare
  against `currentStock`. Extract that aggregation into one shared helper and
  call it from both the reconciliation script and the vitest invariant test, so
  the check and the test can never drift apart.

- **Depends on / blocked by:** Nothing, once the Product Stock feature lands
  (needs `ProductLog` and the vitest setup to exist first).

- **Source:** /plan-eng-review 2026-08-21, raised by the Codex outside voice.
