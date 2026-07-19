# Conformance corpus

Fixtures cover the four independently observed framework families plus adversarial repair and drift cases. They are compatibility contracts, not claims that every framework release emits only these shapes. Adapter changes require a fixture, source/version note, and regression test.

The corpus specifically preserves the research proof cases: valid input, exact numeric-string repair, missing-required rejection, and wrong-type rejection. It adds ambiguity, privacy, policy, nested values, closed schemas, and structural drift.

Run the deterministic report locally:

```bash
npm run conformance
```

Run the release regression gate against the reviewed baseline:

```bash
npm run conformance:check
```

The report is stable and machine-readable: it contains protocol/engine/ruleset versions, a corpus hash, case outcomes, repair and rejection identifiers, and adapter normalization probes. It contains no tool argument values. Baseline changes must be reviewed as compatibility-contract changes, not regenerated automatically to make a failure disappear.
