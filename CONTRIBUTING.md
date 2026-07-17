# Contributing

Changes to enforcement behavior are safety-sensitive.

1. Add or update a conformance fixture that demonstrates the intended behavior and framework/source version where relevant.
2. For a repair rule, document why the transformation preserves declared type meaning, whether it is default-enabled, and how the original input makes it reversible.
3. Add deterministic unit, adversarial, regression, and property coverage. Repaired output must be revalidated.
4. Run `npm run check`, `npm run benchmark`, and `npm audit --audit-level=high`.
5. Update the decision log for contract, trust-boundary, dependency, or public/managed-boundary changes.

Never add generated/probabilistic enforcement, semantic-value invention, payload logging, or policy bypass. A feature that cannot reject safely is not ready for the core path.
