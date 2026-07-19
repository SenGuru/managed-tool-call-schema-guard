# Live agent-in-the-loop mutation prompt

This is an authorized local tool-call mutation test. Use the three available
MCP mutation-test tools exactly once for each case below, in
order. Pass every listed object literally: do not normalize, repair, omit, or
rename anything, even when it looks wrong. A rejected tool result is expected;
do not retry it. After all twelve calls, summarize the observed decisions.

Use `submit_guard_test_case` for cases 1–8:

1. `valid_call`: `{"recipient":"acct_b","amount":25,"confirmed":true}`
2. `repairable_strings`: `{"recipient":"acct_c","amount":"42","confirmed":"false"}`
3. `missing_required`: `{"amount":7,"confirmed":true}`
4. `ambiguous_numeric`: `{"recipient":"acct_d","amount":"42 dollars","confirmed":true}`
5. `unsafe_precision`: `{"recipient":"acct_e","amount":"9007199254740993","confirmed":true}`
6. `secret_extra_field`: `{"recipient":"acct_f","amount":8,"confirmed":true,"api_key":"DEMO_SECRET_MUST_NOT_APPEAR"}`
7. `allowlisted_singleton`: `{"recipient":"acct_g","amount":9,"confirmed":true,"tags":"priority"}`
8. `organization_policy_denial`: `{"recipient":"acct_h","amount":10,"confirmed":true}`

Use `submit_drift_test_case` for cases 9–10, passing the object as `current_schema`:

9. `minimum_tightened`: `{"type":"integer","minimum":10}`
10. `combinator_changed`: `{"oneOf":[{"type":"string"},{"type":"boolean"}]}`

Use `submit_adapter_test_case` for cases 11–12, passing the listed declaration
and raw arguments:

11. `google_nested_union`: declaration `{"name":"nested","parameters":{"type":"OBJECT","additionalProperties":false,"required":["value"],"properties":{"value":{"anyOf":[{"type":"INTEGER"},{"type":"NULL"}]}}}}`; raw arguments `{"value":7}`
12. `mcp_repairable`: declaration `{"name":"counter","inputSchema":{"type":"object","additionalProperties":false,"required":["count"],"properties":{"count":{"type":"integer"}}}}`; raw arguments `{"count":"3"}`

The MCP wrapper intentionally accepts a generic raw object. The Schema Guard
server applies the actual closed `fake_transfer` schema and policy before the
fake tool can execute. This models a guard/proxy between an agent framework and
a downstream tool.
