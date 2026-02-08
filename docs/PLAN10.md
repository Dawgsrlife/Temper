# PLAN10 - Frontend Route Alignment TDD

## Goal
One frontend path, one backend truth source.

## TDD Case 1 (Upload route)
Input: `F07_alias_contract.csv` via UI upload page.
Expected outputs:
1. request hits configured backend route (`/jobs` or `/api/upload` alias)
2. response contains `job_id`
3. UI enters polling state

## TDD Case 2 (Analyze route data source)
Input: completed job from above.
Expected outputs:
1. analyze page calls backend endpoints only
2. no local `Math.random`-based scoring in demo path
3. summary/moments/trade inspector reflect backend values exactly

## TDD Case 3 (Unmount stability)
Input: navigate away during polling.
Expected outputs:
1. timers cleaned up
2. no state update warning/errors

## TDD Case 4 (Optional manual trade form path)
Input: submit 3 manual trades from UI form using canonical schema fields.
Expected outputs:
1. backend receives normalized rows equivalent to CSV ingestion
2. resulting summary/moments payload shape is identical to upload path
3. UI clearly labels this as `sample/manual session`
