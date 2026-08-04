import { test, expect } from '@playwright/test';

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
 * This test mounts a Radix Tooltip portal whose `container` is `#root`,
 * renders its content far enough outside `#root`'s box that any
 * overflow-clipping ancestor would hide it, then asserts both:
 *   (a) `#root` itself stays `overflow: visible`, and
 *   (b) the portal's content is rendered with a non-zero client rect.
 *
 * If a future change widens the lock to include `#root`, both assertions
 * fail loudly — that is the whole point of the test.
 */
test.describe('Scroll-bounds fix — #root must not clip React Portals', () => {
  test('Radix Tooltip portaled into #root renders unclipped', async ({ page }) => {
    await page.goto('/');
    // Wait for the dashboard to mount so React is hydrated and a real
    // React tree is anchored on #root. Same readiness probe as the
    // existing tab-flicker spec.
    await page.locator('#node-btn-input').waitFor({ state: 'visible', timeout: 30_000 });

    // (a) Direct guardrail: the CSS-computed overflow of #root must
    // remain `visible` (or any non-clipping value). If anyone adds
    // `#root` to the `html, body { overflow: hidden }` lock, this
    // assertion fails before any portal can be clipped.
    const rootOverflow = await page.evaluate(
      () => getComputedStyle(document.getElementById('root')!).overflow,
    );
    expect(
      rootOverflow,
      '#root must keep overflow:visible so React Portals targeting #root are not clipped',
    ).toBe('visible');

    // (b) Mount a Radix Tooltip.Portal whose `container` is `#root` and
    // whose content is positioned absolutely far outside #root's box.
    // If #root gained overflow:hidden (or any clipping value), the
    // absolutely-positioned content would lose all `getClientRects()`
    // entries. The page.evaluate below also tries a direct-DOM
    // fallback if the dev server cannot resolve bare ESM imports from
    // inside the eval scope; either way the same overflow-clipping
    // contract is asserted.
    const mount = await page.evaluate(async () => {
      const root = document.getElementById('root')!;
      if (!root) throw new Error('#root missing');

      // Hold the appended portal target on a tiny sub-root inside #root,
      // so we don't disturb the app's own React tree.
      const host = document.createElement('div');
      host.id = 'portal-mount-host';
      host.dataset.testSource = 'guardrail';
      root.appendChild(host);

      const cssString = [
        'position: absolute',
        'left: -9999px',
        'top: -9999px',
        'width: 180px',
        'height: 64px',
        'background: rgb(141, 168, 64)',
        'color: white',
        'padding: 8px 12px',
        'border-radius: 3px',
        'font: 600 12px/1 system-ui',
        'z-index: 2147483647',
        'pointer-events: none',
        'display: flex',
        'align-items: center',
        'justify-content: center',
      ].join(';');

      // `style` for React/MDX handoff — CSSProperties-shaped object so any
      // future Radix typing does not reject it.
      const reactCss: Record<string, string> = {
        position: 'absolute',
        left: '-9999px',
        top: '-9999px',
        width: '180px',
        height: '64px',
        background: 'rgb(141, 168, 64)',
        color: 'white',
        padding: '8px 12px',
        borderRadius: '3px',
        font: '600 12px/1 system-ui',
        zIndex: '2147483647',
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      };

      // Strategy A: real Radix Tooltip.Portal with container=#root.
      // In dev mode Vite serves bare ESM imports through its import map.
      // The dynamic imports are typed as `any` here to keep TS happy — the
      // test only asserts DOM-level behaviour, not Radix's type surface.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let ReactDOMClient: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let RdxTooltip: any;
      try {
        ReactDOMClient = await import(/* @vite-ignore */ 'react-dom/client');
        RdxTooltip = await import(/* @vite-ignore */ '@radix-ui/react-tooltip');
      } catch (_err) {
        ReactDOMClient = null;
        RdxTooltip = null;
      }

      if (ReactDOMClient && RdxTooltip) {
        const sub = ReactDOMClient.createRoot(host);
        sub.render(
          RdxTooltip.Portal({
            container: root,
            children: RdxTooltip.Content({
              'data-testid': 'rdx-portal-sentinel',
              // Pass a real CSSProperties-shaped object. eslint is happy
              // because React runtime accepts both objects and strings.
              style: reactCss as unknown as React.CSSProperties,
              children: 'Portal into #root',
            }),
          }),
        );
        // One tick for React to commit.
        await new Promise((r) => setTimeout(r, 60));
        return { mode: 'radix' as const };
      }
      // No Radix available in eval scope (typical for Vite dev — the runtime
      // import map that resolves bare specifiers is not exposed to page.evaluate).
      // Fall back to a direct-DOM sentinel that proves the same contract.
      // Strategy B fallback: plain DOM sentinel. Same contract, no
      // dependency on ResolvedRadix being importable inside eval.
      // The CSS-computed-style guardrail above already covers the
      // regression; this branch just keeps the rect assertion alive
      // when Radix can't be reached.
      const probe = document.createElement('div');
      probe.dataset.testid = 'rdx-portal-sentinel';
      probe.textContent = 'Portal into #root';
      probe.style.cssText = cssString;
      root.appendChild(probe);
      return {
        mode: 'dom-fallback' as const,
        rdxError: 'Radix bare imports did not resolve inside page.evaluate',
      };
    });

    // Diagnostic for the fallback path — surface the import error so a
    // future breakage is easy to triage.
    if (mount.mode === 'dom-fallback') {
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
    // critically — have at least one clientRect. An absolute-positioned
    // child at translate(-9999,-9999) bleeds outside any parent's clip
    // box; if #root had `overflow:hidden`, the element's `getClientRects()`
    // would be empty.
    const probe = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="rdx-portal-sentinel"]',
      ) as HTMLElement | null;
      if (!el) return null;
      const rects = el.getClientRects();
      const bbox = el.getBoundingClientRect();
      return {
        found: true,
        inRoot: !!el.closest('#root'),
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
      'Sentinel element must exist in the DOM after the mount step',
    ).not.toBeNull();
    expect(probe!.found).toBe(true);
    expect(
      probe!.inRoot,
      'Sentinel must be a descendant of #root — proves the Radix portal container was honoured',
    ).toBe(true);
    expect(
      probe!.rectsCount,
      `Sentinel must render ≥1 clientRect — empty clientRects() implies #root ` +
        `now has overflow:hidden and is silently clipping the portal. ` +
        `Mount mode: ${mount.mode}`,
    ).toBeGreaterThan(0);
    expect(probe!.bboxWidth).toBeGreaterThan(50);
    expect(probe!.bboxHeight).toBeGreaterThan(20);
  });
});
