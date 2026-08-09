# Design QA — AL-AMIN Civic Precision Home Preview

## Evidence

- Source visual truth: Figma `7QQ5yJSr8m7cYt9FIoHR0X`, desktop Hero `208:291`, desktop trust section `209:142`, mobile Hero `208:323`, mobile trust section `211:188`.
- Source captures: `outputs/figma-desktop-hero.png` (1440×620), `outputs/figma-desktop-why.png` (1440×430), `outputs/figma-mobile-hero.png` (390×854), `outputs/figma-mobile-why.png` (390×710).
- Browser implementation: `http://localhost:3000/design-preview`.
- Implementation captures: `outputs/design-preview-desktop-1440.png` (browser output 1425×990 for CSS viewport 1440×1000) and `outputs/design-preview-mobile-390.png` (browser output 375×962 for CSS viewport 390×1000).
- Normalized comparison: `outputs/design-qa-desktop-comparison.png` (source 1440×620 beside implementation Hero cropped below the 80 px header and normalized to 1440×620) and `outputs/design-qa-mobile-comparison.png` (source 390×854 beside implementation Hero cropped below the 64 px header and normalized to 390×854).
- Density: browser CSS pixel capture, normalized 1:1 for comparison.
- State: unauthenticated public Preview, first published real profile with a usable avatar centered; local preview profiles fill the remaining carousel positions.

## Required fidelity surfaces

- Fonts and typography: Onest is used for display/headings and Manrope for UI/body; weights, 48/54 desktop title, 40/46 mobile title, small trust typography, wrapping, and hierarchy match the approved frames. The fallback stack is present.
- Spacing and layout rhythm: desktop 1280 px content width, 80 px header, 620 px Hero, 52 px CTAs, 44 px controls, 16 px card radii, responsive mobile stack, and section transition were checked at 1440, 1024, 390, and 375 px. No horizontal overflow was detected.
- Colors and visual tokens: white canvas, mineral `#f6f9f7`, graphite text, deep green `#15513c`, pale trust green, and neutral borders follow Civic Precision tokens. Contrast remains readable in primary, secondary, and trust states.
- Image quality and asset fidelity: Figma portrait assets are used for preview-only fallback profiles. Real published profiles use the protected same-origin `/api/media/view` route. Circular crop, object-fit, opacity, and card masks were checked in-browser.
- Copy and content: Hero and trust-section copy matches the approved Figma frames. Mobile intentionally shortens the supporting assurance line exactly as the responsive reference does.

## Full-view and focused comparison

- Desktop full Hero: compared in `outputs/design-qa-desktop-comparison.png`; composition, title hierarchy, CTA group, three-card cover flow, trust mark, and arrow placement are aligned.
- Mobile full Hero: compared in `outputs/design-qa-mobile-comparison.png`; title wrapping, stacked CTAs, one-line assurance, center card, visible neighbor edges, and 44 px arrows are aligned.
- Focused regions were covered inside the normalized comparisons because the Hero controls and card text remain readable at those dimensions. The trust section was separately inspected against `outputs/figma-desktop-why.png` and `outputs/figma-mobile-why.png`.

## Comparison history

1. Initial pass found P2 drift: mobile login was hidden by a legacy global selector; near-card content could clip; portrait scale and circular arrow shape differed; the next section used exploratory copy/icons; mobile assurance wrapped and pushed the carousel down.
2. Fixes applied: scoped the mobile login display, reduced portrait scale, made arrows 44×44 with 12 px radius, replaced trust-section copy with the approved content and removed exploratory icons, matched mobile spacing, and used the approved shorter mobile assurance line.
3. Post-fix evidence: final normalized comparisons above show no remaining actionable P0/P1/P2 mismatch.

## Findings

- No actionable P0, P1, or P2 findings remain.
- [P3] Carousel content differs from the static Figma names and portraits when real AL-AMIN data is available. This is intentional: the live Preview prioritizes the published profile and fills only missing slots with local preview data.
- [P3] Far-card fragments present in an older/static Figma composition are not rendered. This is intentional and follows the implementation requirement to show only Left Near, Center, and Right Near.

## Browser QA

- Previous/next arrows, keyboard Left/Right, mouse drag, mobile-width horizontal gesture, side-card centering, and center-card navigation passed.
- `/specialists`, `/apply` (guest redirect to `/login?next=/apply`), `/login`, `/cabinet` (guest redirect), `/admin` (guest redirect), and a real public profile route passed.
- Touch targets are 44 px or larger. Neighbor edges remain visible at 390 and 375 px. `touch-action: pan-y` preserves vertical page scrolling.
- Reduced-motion media rules are present; autoplay is absent.
- Browser console: no warnings or errors during final Preview QA.
- Existing `/` still renders its original header/footer and does not contain `.design-preview-root`.

## Implementation checklist

- [x] Match final desktop and mobile Hero structure.
- [x] Use live public data with safe local fallback only.
- [x] Preserve existing routes and infrastructure.
- [x] Verify responsive layout and interactions.
- [x] Verify TypeScript, tests, and production build.

final result: passed
