# Running the mock WebKit gate on macOS

On macOS 26.6.2 with Playwright 1.65.1 (WebKit revision 2388), a sleeping
display can cause headless WebKit to deliver mouse events outside the page
viewport. A sign-in failure with `<html lang="en">…</html> intercepts pointer
events` can occur before the browser sends the sign-in request. The same
coordinate error can affect other mouse-driven tests.

Wake the display and keep it awake for the run. From the repository root,
set `VELA_E2E_STATIC_ROOT` to the local `/vela` web export and
`VELA_E2E_BUN` to the pinned Bun executable, as in
[`tools/e2e-gate.sh`](../../tools/e2e-gate.sh).

```sh
caffeinate -u -t 5
caffeinate -d npx --no-install e2e run --strict-cache \
  --config e2e.mock.config.ts --target mock-webkit --workers 1 --retries 0
```

Use `--headed` to run the same gate with a visible browser. To check the
shared sign-in helper in a shorter run, select `tests/e2e/mock/film.e2e.ts`.
That suite requires a saved session, so the runner executes its sign-in
setup in `auth.e2e.ts` first.
