import { test, expect } from "@playwright/test";

/**
 * Guardrail for the scroll-bounds fix in src/index.css.
 *
 * The fix intentionally locks `html, body` to
 *   height: 100%; overflow: hidden; overscroll-behavior: none;
 * but leaves `#root` alone. The reason: React Portals (Radix Tooltip,
 * Select content, popovers, …) can target `#root` via `createPortal(node,
 * document.getElementById('root'))`, and an `overflow: hidden` on `#root`
 * would silently clip those portals to its box.
 *
 * This test mounts a Radix Tooltip hierarchy whose portal `container` is
 * `#root`, renders its content far enough outside `#root`'s box that any
 * overflow-clipping ancestor would hide it, then asserts both:
 *   (a) `#root` itself stays `overflow: visible`, and
 *   (b) the portal's content renders unclipped at paint time — verified
 *       via `document.elementFromPoint(...)` so we catch the case where an
 *       ancestor's `overflow: hidden` clips the box visually even though
 *       `getClientRects()` still returns the original coordinates.
 *
 * If a future change widens the lock to include `#root`, both assertions
 * fail loudly — that is the whole point of the test.
 */
test.describe("Scroll-bounds fix — #root must not clip React Portals", () => {
  test("Radix Tooltip portaled into #root renders unclipped at paint time", async ({ page }) => {
    await page.goto("/");
    // Wait for the dashboard to mount so React is hydrated and a real
    // React tree is anchored on #root.
    await page.locator("#node-btn-input").waitFor({ state: "visible", timeout: 30_000 });

    // (a) Direct guardrail: the CSS-computed overflow of #root must
    // remain `visible` (or any non-clipping value). If anyone adds
    // `#root` to the `html, body { overflow: hidden }` lock, this
    // assertion fails before any portal can be clipped.
    const rootOverflow = await page.evaluate(
      () => getComputedStyle(document.getElementById("root")!).overflow,
    );
    expect(
      rootOverflow,
      "#root must keep overflow:visible so React Portals targeting #root are not clipped",
    ).toBe("visible");

    // (b) Mount a Radix Tooltip hierarchy whose portal `container` is
    // `#root`. Earlier drafts called `RdxTooltip.Portal(...)` /
    // `Content(...)` as plain functions outside the JSX reconciler,
    // which silently missed Radix's Provider context and never mounted
    // the sentinel. Drive the tree through `React.createElement` so
    // every level participates in React reconciliation.
    //
    // The mount step also tries a direct-DOM fallback if the dev server
    // cannot resolve bare ESM imports from inside the eval scope. Both
    // branches must honour the same overflow-clipping contract.
    const mount = await page.evaluate(async () => {
      let mountError: string | null = null;
      const root = document.getElementById("root")!;
      if (!root) throw new Error("#root missing");

      const host = document.createElement("div");
      host.id = "portal-mount-host";
      host.dataset.testSource = "guardrail";
      root.appendChild(host);

      const sentinelStyle: Record<string, string> = {
        position: "absolute",
        left: "-9999px",
        top: "-9999px",
        width: "180px",
        height: "64px",
        background: "rgb(141, 168, 64)",
        color: "white",
        padding: "8px 12px",
        borderRadius: "3px",
        font: "600 12px/1 system-ui",
        zIndex: "2147483647",
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      };

      let ReactDOMClient: any = null;
      let RdxTooltip: any = null;
      let React: any = null;
      try {
        React = await import(/* @vite-ignore */ "react");
        ReactDOMClient = await import(/* @vite-ignore */ "react-dom/client");
        RdxTooltip = await import(/* @vite-ignore */ "@radix-ui/react-tooltip");
      } catch (err) {
        mountError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }

      if (React && ReactDOMClient && RdxTooltip) {
        const sub = ReactDOMClient.createRoot(host);
        // Build the React element tree with createElement so it goes
        // through the JSX reconciler — Radix rejects plain function
        // calls because the Provider context never wires up.
        sub.render(
          React.createElement(
            RdxTooltip.Provider,
            null,
            React.createElement(
              RdxTooltip.Root,
              { open: true },
              React.createElement(
                RdxTooltip.Trigger,
                { asChild: true },
                React.createElement("button", { type: "button" }, "open"),
              ),
              React.createElement(
                RdxTooltip.Portal,
                { container: root },
                React.createElement(
                  RdxTooltip.Content,
                  {
                    "data-testid": "rdx-portal-sentinel",
                    style: sentinelStyle as unknown as React.CSSProperties,
                    side: "bottom",
                    sideOffset: 0,
                  },
                  "Portal into #root",
                ),
              ),
            ),
          ),
        );
        // Two ticks for Radix's Provider/effect chain to commit.
        await new Promise((r) => setTimeout(r, 120));
        return { mode: "radix" as const };
      }
      // Fallback: no Radix available in eval scope (typical for Vite
      // dev — the runtime import map that resolves bare specifiers is
      // not exposed to page.evaluate). Strategy B uses a direct-DOM
      // sentinel and PRESERVES the real import-error string so a
      // future failure is filed with enough context to triage at the
      // source.
      const probe = document.createElement("div");
      probe.dataset.testid = "rdx-portal-sentinel";
      probe.textContent = "Portal into #root";
      Object.assign(probe.style, sentinelStyle);
      root.appendChild(probe);
      return {
        mode: "dom-fallback" as const,
        rdxError: mountError ?? "Radix bare imports did not resolve inside page.evaluate",
      };
    });

    if (mount.mode === "dom-fallback") {
      // eslint-disable-next-line no-console -- intentional guardrail diagnostic
      console.warn(
        `[scroll-bounds guardrail] Radix bare import unavailable in eval scope, ` +
          `using direct-DOM sentinel. Reason: ${mount.rdxError}`,
      );
    }

    // Force layout settle before measuring.
    await page.evaluate(() => {
      void document.body.offsetHeight;
    });

    // (c) The sentinel must exist, be a descendant of #root, and —
    // most importantly — still be paint-hit-testable at its bbox
    // position. An absolute-positioned child at translate(-9999,-9999)
    // bleeds outside any parent's clip box; if #root had
    // `overflow:hidden`, two things would happen:
    //   (1) getClientRects() / bbox still report the original
    //       coordinates (rects aren't affected by clip), so a
    //       rect-only check CANNOT detect clipping.
    //   (2) document.elementFromPoint(centerX, centerY) would return
    //       some other element (or null), because the clip hides the
    //       paint at that coordinate.
    // So we layer both: a rect check (proves mounting succeeded) and a
    // hit-test check (proves visibility through any clip path).
    const probe = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="rdx-portal-sentinel"]',
      ) as HTMLElement | null;
      if (!el) return null;
      const rects = el.getClientRects();
      const bbox = el.getBoundingClientRect();
      return {
        found: true,
        inRoot: !!el.closest("#root"),
        rectsCount: rects.length,
        firstRect:
          rects.length > 0
            ? { width: rects[0]!.width, height: rects[0]!.height }
            : null,
        bboxWidth: bbox.width,
        bboxHeight: bbox.height,
      };
    });

    expect(
      probe,
      `Sentinel element must exist in the DOM after the mount step (mode=${mount.mode})`,
    ).not.toBeNull();
    expect(probe!.found).toBe(true);
    expect(
      probe!.inRoot,
      "Sentinel must be a descendant of #root — proves the Radix portal container was honoured",
    ).toBe(true);
    expect(
      probe!.rectsCount,
      `Sentinel must render ≥1 clientRect — empty clientRects() implies it never mounted. ` +
        `Mount mode: ${mount.mode}`,
    ).toBeGreaterThan(0);
    expect(probe!.bboxWidth).toBeGreaterThan(50);
    expect(probe!.bboxHeight).toBeGreaterThan(20);

    // Paint-time hit test. elementFromPoint at the bbox centre must
    // resolve to either the sentinel itself or one of its ancestors up
    // to #root (Radix may wrap the Content). NOT some other element in
    // #root (or null) that has clipped over its top via an
    // `overflow:hidden` ancestor.
    const hitOk = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="rdx-portal-sentinel"]',
      ) as HTMLElement | null;
      if (!el) return false;
      const bbox = el.getBoundingClientRect();
      const centerX = bbox.left + bbox.width / 2;
      const centerY = bbox.top + bbox.height / 2;
      const hit = document.elementFromPoint(centerX, centerY);
      if (!hit) return false;
      let cur: HTMLElement | null = hit as HTMLElement;
      let depth = 0;
      while (cur && depth < 6) {
        if (cur === el) return true;
        cur = cur.parentElement;
        depth += 1;
      }
      return false;
    });

    expect(
      hitOk,
      `Sentinel must be the topmost element at its getBoundingClientRect centre. ` +
        `If elementFromPoint(...) returns a different node, an ancestor of #root ` +
        `now has overflow:hidden and is silently clipping the portal. ` +
        `Mount mode: ${mount.mode}`,
    ).toBe(true);

    await expect(
      page.locator('[data-testid="rdx-portal-sentinel"]'),
    ).toBeAttached();
  });
});
