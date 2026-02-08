# Gate Suite

This suite defines demo-critical invariants for Temper. Run it before merge:

```bash
pytest backend/tests/gates -q
```

Rules:
- Add/modify tests first to encode preconditions.
- Run tests and confirm failure for the expected reason.
- Make the minimal implementation change.
- Re-run tests and require green before merge.

Current gate coverage:
- Counterfactual mechanics consistency (`EXPOSURE_SCALING` math invariant).
- Overtrading semantics remain conservative skip/cooldown behavior.
- Data anomaly handling is deterministic and surfaced in summary flags.
- API contract stability for `/counterfactual/series`, `/moments`, and `/trade/{trade_id}`.
- Golden replay fixtures that pin exact per-trade decisions/mechanics and anomaly counts.
