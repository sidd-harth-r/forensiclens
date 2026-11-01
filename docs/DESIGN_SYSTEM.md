# ForensicLens Design System

**Product:** ForensicLens\
**Purpose:** Privacy-preserving, verifiable digital forensics
investigation\
**Visual direction:** Clean, precise, Linear-inspired forensic
workspace\
**Version:** 1.0\
**Theme:** Light + dark\
**Accent:** One accent colour only --- Indigo

------------------------------------------------------------------------

## 1. Design Direction

ForensicLens is an investigation tool, not a consumer dashboard. The
interface should feel:

-   **Precise** --- evidence, timestamps, hashes, predicates and
    provenance must be visually unambiguous.
-   **Calm** --- avoid decorative gradients, excessive colour and visual
    noise.
-   **Dense when useful** --- investigators need to inspect many events
    without excessive scrolling.
-   **Trustworthy** --- verified facts and model-generated suggestions
    must look fundamentally different.
-   **Local-first** --- privacy and offline status should always be
    visible.
-   **Traceable** --- every material finding should lead back to
    evidence.
-   **Human-controlled** --- the product assists investigators; it does
    not make legal or guilt determinations.

These principles follow the PRD's product principles: evidence is the
source of truth, local-first privacy, minimal exposure, provenance by
design, verify rather than trust, retrieval before generation,
contextual legal mapping, untrusted evidence input, reproducibility and
human control.

------------------------------------------------------------------------

# 2. Brand / Visual Language

## 2.1 Overall aesthetic

Use a restrained interface similar in spirit to Linear:

-   Neutral canvas
-   Thin borders
-   Small radii
-   Subtle shadows
-   Strong typographic hierarchy
-   Compact controls
-   High information density
-   Keyboard-friendly interactions
-   Minimal ornamentation

Avoid:

-   Glassmorphism
-   Large gradients
-   Neon cyber-security styling
-   Excessive glowing effects
-   Multiple brand colours
-   Decorative illustrations inside investigation workflows
-   Colour-only meaning

The application should look like a professional forensic workstation
rather than a generic "AI cybersecurity" product.

------------------------------------------------------------------------

# 3. Colour Tokens

## 3.1 Design rule

**Indigo is the only brand/accent colour.**

Semantic colours are allowed only where they communicate system state or
forensic meaning. They are not additional brand colours.

Use semantic colours sparingly and always pair them with text, icons,
labels or patterns.

------------------------------------------------------------------------

## 3.2 Light theme

### Surfaces

  Token                 Hex         Use
  --------------------- ----------- ------------------------------
  `--background`        `#F8FAFC`   Application background
  `--surface`           `#FFFFFF`   Cards, panels, dialogs
  `--surface-subtle`    `#F1F5F9`   Secondary panels
  `--surface-muted`     `#E2E8F0`   Disabled / inactive surfaces
  `--surface-inverse`   `#0F172A`   Inverse surfaces

### Text

  Token                Hex         Use
  -------------------- ----------- ------------------------------------
  `--text-primary`     `#0F172A`   Main headings and important values
  `--text-secondary`   `#334155`   Normal body text
  `--text-muted`       `#64748B`   Supporting information
  `--text-disabled`    `#94A3B8`   Disabled text
  `--text-inverse`     `#F8FAFC`   Text on dark surfaces

### Borders

  Token               Hex         Use
  ------------------- ----------- ------------------------------
  `--border`          `#CBD5E1`   Default borders
  `--border-subtle`   `#E2E8F0`   Low-emphasis separators
  `--border-strong`   `#94A3B8`   Focused/important boundaries

### Accent

  Token               Hex         Use
  ------------------- ----------- -----------------------------------------
  `--accent`          `#4F46E5`   Primary actions, links, selected states
  `--accent-hover`    `#4338CA`   Hover state
  `--accent-active`   `#3730A3`   Pressed state
  `--accent-subtle`   `#EEF2FF`   Accent backgrounds
  `--accent-text`     `#3730A3`   Text on accent-subtle

Use accent for:

-   Primary buttons
-   Active navigation
-   Selected filters
-   Focus indicators
-   Links
-   Interactive chart/timeline selections
-   Current investigation context

Do not use accent to mean "verified."

------------------------------------------------------------------------

## 3.3 Semantic status colours

### Verified / supported

  Token                   Hex         Use
  ----------------------- ----------- ---------------------
  `--status-success`      `#15803D`   VERIFIED, SUPPORTED
  `--status-success-bg`   `#F0FDF4`   Success backgrounds

### Warning / partial

  Token                   Hex         Use
  ----------------------- ----------- ---------------------
  `--status-warning`      `#A16207`   PARTIAL, warnings
  `--status-warning-bg`   `#FEFCE8`   Warning backgrounds

### Contradicted / destructive

  Token                  Hex         Use
  ---------------------- ----------- -----------------------------------
  `--status-danger`      `#B91C1C`   CONTRADICTED, destructive actions
  `--status-danger-bg`   `#FEF2F2`   Error backgrounds

### Unverified / neutral

  Token                   Hex         Use
  ----------------------- ----------- ---------------------
  `--status-neutral`      `#475569`   UNVERIFIED, unknown
  `--status-neutral-bg`   `#F1F5F9`   Neutral backgrounds

### Human judgment

  Token                 Hex         Use
  --------------------- ----------- --------------------------
  `--status-human`      `#7C3AED`   REQUIRES HUMAN JUDGMENT
  `--status-human-bg`   `#F5F3FF`   Human-review backgrounds

Semantic status colours must always be accompanied by a textual status.

Example:

**✓ VERIFIED**

not simply a green dot.

------------------------------------------------------------------------

# 4. Dark Theme

Dark mode should not be pure black. It should use slate surfaces to
preserve hierarchy.

  Token                 Hex         Use
  --------------------- ----------- ----------------------------
  `--background`        `#0B1120`   Application background
  `--surface`           `#111827`   Cards and panels
  `--surface-subtle`    `#172033`   Secondary panels
  `--surface-muted`     `#1E293B`   Muted surfaces
  `--surface-inverse`   `#F8FAFC`   Inverse surfaces
  `--text-primary`      `#F8FAFC`   Main text
  `--text-secondary`    `#CBD5E1`   Body text
  `--text-muted`        `#94A3B8`   Supporting text
  `--text-disabled`     `#64748B`   Disabled text
  `--text-inverse`      `#0F172A`   Text on light surfaces
  `--border`            `#334155`   Default borders
  `--border-subtle`     `#1E293B`   Separators
  `--border-strong`     `#475569`   Strong boundaries
  `--accent`            `#818CF8`   Primary interactive accent
  `--accent-hover`      `#A5B4FC`   Hover
  `--accent-active`     `#6366F1`   Active
  `--accent-subtle`     `#1E1B4B`   Accent background
  `--accent-text`       `#C7D2FE`   Accent text

Semantic colours in dark mode:

  Meaning             Foreground   Background
  ------------------- ------------ ------------
  Verified            `#4ADE80`    `#052E16`
  Warning / Partial   `#FACC15`    `#422006`
  Contradicted        `#F87171`    `#450A0A`
  Unverified          `#CBD5E1`    `#1E293B`
  Human judgment     `#C4B5FD`    `#2E1065`

------------------------------------------------------------------------

# 5. Typography

## 5.1 Font stack

Primary:

``` css
font-family:
  Inter,
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

Monospace:

``` css
font-family:
  "JetBrains Mono",
  "SFMono-Regular",
  Consolas,
  "Liberation Mono",
  monospace;
```

Use monospace for:

-   Event IDs
-   Evidence hashes
-   IP addresses where precision matters
-   Timestamps in evidence views
-   Predicates
-   JSON
-   File paths
-   Commands
-   Technical identifiers

------------------------------------------------------------------------

## 5.2 Type scale

  Token             Size   Line height   Weight Use
  --------------- ------ ------------- -------- --------------------------
  `display`         32px          40px      600 Major page title
  `h1`              24px          32px      600 Page heading
  `h2`              20px          28px      600 Section heading
  `h3`              16px          24px      600 Card/section title
  `body-lg`         16px          24px      400 Important body copy
  `body`            14px          20px      400 Default UI text
  `body-medium`     14px          20px      500 Labels / emphasized text
  `small`           13px          18px      400 Supporting text
  `caption`         12px          16px      400 Metadata
  `overline`        12px          16px      600 Small section labels
  `code`            13px          20px      400 Technical content

Default application text: **14px**.

------------------------------------------------------------------------

# 6. Spacing

Use a 4px base unit.

  Token          Value Typical use
  ------------ ------- -------------------------
  `space-1`        4px Icon/text gap
  `space-2`        8px Compact control padding
  `space-3`       12px Small component gap
  `space-4`       16px Standard gap
  `space-5`       20px Card internal spacing
  `space-6`       24px Section spacing
  `space-8`       32px Large section gap
  `space-10`      40px Page section
  `space-12`      48px Major separation
  `space-16`      64px Page-level spacing

Preferred gaps:

-   Icon → text: 8px
-   Form label → input: 6--8px
-   Input → help/error: 6px
-   Card sections: 16--24px
-   Page sections: 24--32px
-   Sidebar navigation items: 4px
-   Table cell padding: 10--12px

------------------------------------------------------------------------

# 7. Radius

ForensicLens should feel structured rather than playful.

  Token              Value Use
  --------------- -------- ---------------------------
  `radius-sm`          4px Badges, compact controls
  `radius-md`          6px Inputs, buttons
  `radius-lg`          8px Cards, panels
  `radius-xl`         12px Dialogs, major containers
  `radius-full`     9999px Pills / status badges

Default radius: **6px**.

Avoid excessive rounded containers.

------------------------------------------------------------------------

# 8. Shadows

Use shadows sparingly.

  ----------------------------------------------------------------------------------
  Token                   Value                              Use
  ----------------------- ---------------------------------- -----------------------
  `shadow-xs`             `0 1px 2px rgba(15,23,42,.04)`     Inputs / subtle
                                                             elevation

  `shadow-sm`             `0 1px 3px rgba(15,23,42,.08)`     Cards

  `shadow-md`             `0 4px 12px rgba(15,23,42,.10)`    Popovers

  `shadow-lg`             `0 12px 32px rgba(15,23,42,.14)`   Dialogs
  ----------------------------------------------------------------------------------

Prefer borders over shadows for normal cards.

------------------------------------------------------------------------

# 9. Layout

## Application shell

Desktop:

``` text
┌──────────────────────────────────────────────────────────────┐
│ Top bar                                                      │
├──────────────┬───────────────────────────────────────────────┤
│              │                                               │
│ Sidebar      │ Main content                                  │
│ 240px        │                                               │
│              │                                               │
│              │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

Sidebar:

-   Width: 240px
-   Collapsed: 64px
-   Border-right: 1px
-   Fixed on desktop

Top bar:

-   Height: 56px
-   Case selector
-   Investigation status
-   Privacy/offline indicator
-   User/session controls

Main content:

-   Standard content max-width: 1440px
-   Investigation workspace max-width: 1600px at 1536px+
-   Horizontal padding: 24px desktop
-   16px tablet
-   12--16px mobile

------------------------------------------------------------------------

# 10. Breakpoints

  Name       Width Behaviour
  ------- -------- ------------------------------
  `sm`       640px Small mobile
  `md`       768px Tablet
  `lg`      1024px Small desktop
  `xl`      1280px Desktop
  `2xl`     1536px Wide investigation workspace

Rules:

### `< 768px`

-   Sidebar becomes drawer
-   Tables become horizontally scrollable
-   Multi-column evidence views stack
-   Timeline controls collapse
-   Entity graph controls move to bottom sheet
-   Secondary metadata can collapse

### `768–1023px`

-   Collapsible sidebar
-   Two-column layouts where useful
-   Dense tables remain available

### `1024px+`

-   Full sidebar
-   Multi-panel investigation workspace
-   Evidence + claim + provenance views can coexist

### `1280px+`

-   Use wider evidence inspection panels
-   Allow timeline and detail panel side-by-side

------------------------------------------------------------------------

# 11. shadcn/ui Component Inventory

Use shadcn/ui as the component foundation.
Current shadcn component guidance: use **Sonner** for transient toast notifications in this design system. The current shadcn documentation marks the older Radix Toast component as deprecated in favor of Sonner; the current component catalog also exposes Toast in the Base UI family, so the project should standardize on Sonner rather than mixing notification systems. citeturn833937search1turn833937search0turn833937search8


## Navigation

Required:

-   Sidebar
-   Breadcrumb
-   Navigation Menu
-   Tabs
-   Command
-   Dropdown Menu
-   Menubar

States:

-   Default
-   Hover
-   Focus-visible
-   Active
-   Selected
-   Disabled

------------------------------------------------------------------------

## Buttons

Variants:

-   `default` --- primary action
-   `secondary` --- secondary action
-   `outline` --- bordered action
-   `ghost` --- low emphasis
-   `destructive` --- irreversible/destructive action
-   `link` --- inline navigation

Sizes:

-   `sm`: 32px
-   `default`: 36px
-   `lg`: 40px
-   `icon`: 36px

Required states:

-   Default
-   Hover
-   Active
-   Focus-visible
-   Disabled
-   Loading

Loading buttons must retain their width.

Example:

`Verify claims`

while loading:

`[spinner] Verifying…`

------------------------------------------------------------------------

# 12. Forms

Required:

-   Input
-   Textarea
-   Label
-   Select
-   Checkbox
-   Radio Group
-   Switch
-   Slider
-   Form
-   Input OTP where required
-   Calendar / Date Picker

All fields require:

-   Label
-   Focus state
-   Error state where applicable
-   Disabled state
-   Helper text where useful

Never rely on placeholder text as the only label.

------------------------------------------------------------------------

# 13. Investigation Components

## Query composer

Primary component for natural-language investigation.

Example:

``` text
Ask an investigation question…

Did a successful SSH login occur before privileged commands?

[Privacy: L2] [Search] 
```

States:

-   Empty
-   Focused
-   Query entered
-   Running
-   Completed
-   Error

Support:

-   `Enter` to submit
-   `Shift + Enter` for newline
-   `Esc` to clear transient state

------------------------------------------------------------------------

## Retrieval method badge

Allowed values:

-   STRUCTURED
-   KEYWORD
-   SEMANTIC
-   HYBRID
-   RERANKED

Use neutral styling. Do not assign a different brand colour to each
method.

------------------------------------------------------------------------

# 14. Verification Components

Claim verification is a primary product concept.

## Verification badge

### VERIFIED

Icon: Check

Text:

`VERIFIED`

Meaning:

The claim passed the machine verification predicate against the evidence
store.

### UNVERIFIED

Icon: Question / Minus

Text:

`UNVERIFIED`

Meaning:

The system could not establish the claim mechanically.

### CONTRADICTED

Icon: X

Text:

`CONTRADICTED`

Meaning:

The evidence store contains information that conflicts with the claim.

Never display a generated claim as verified based only on an LLM
citation.

------------------------------------------------------------------------

# 15. Claim Verification Trace

Use a four-stage visual chain:

``` text
CLAIM
  ↓
PREDICATE
  ↓
MATCHED EVENTS
  ↓
RAW EVIDENCE
```

Example:

``` text
VERIFIED

Claim
"User root logged in successfully."

Predicate
EXISTS(event_type = AUTH_SUCCESS AND user = root)

Matched events
EV-00123
EV-00129

Source
auth.log : line 1834

SHA-256
9a8d...f21c
```

Each stage must be clickable.

------------------------------------------------------------------------

# 16. Evidence Table

Recommended columns:

-   Evidence ID
-   Timestamp
-   Source
-   Event type
-   User
-   Host
-   IP
-   Severity
-   Parse status
-   Integrity
-   Source location

Technical values use monospace.

Rows support:

-   Hover
-   Selection
-   Keyboard focus
-   Expand
-   Open evidence
-   Copy ID
-   Open provenance

------------------------------------------------------------------------

# 17. Evidence Viewer

Two-pane layout:

``` text
┌─────────────────────────┬────────────────────────────────────┐
│ Normalized Event        │ Original Evidence                 │
│                         │                                    │
│ Event ID                │ auth.log                           │
│ Timestamp UTC           │                                    │
│ Source                  │ 1832 ...                           │
│ Event Type              │ 1833 ...                           │
│ User                    │ 1834 Failed password...            │
│ IP                      │ 1835 Accepted password...           │
│ Parse Status             │                                    │
└─────────────────────────┴────────────────────────────────────┘
```

Highlight:

-   Matching line
-   Matching field
-   Relevant timestamp

Do not rewrite original evidence in the evidence viewer.

Original evidence must remain visually distinct from
normalized/AI-derived content.

------------------------------------------------------------------------

## 17.1 Canonical example data

Use one example consistently throughout the styleguide and implementation:

- `EV-00123` — `AUTH_FAILURE`, `auth.log`, line `1829`
- `EV-00129` — `AUTH_SUCCESS`, `auth.log`, line `1835`
- Claim ID: `C1`

Example claim:

```text
C1 — A successful SSH authentication followed failed login attempts.
```

Do not use `C1`, `EV-00129`, or line 1834 in the canonical design examples unless the underlying fixture is changed everywhere.

# 18. Timeline

Timeline should emphasize temporal ordering.

Visual hierarchy:

1.  Timestamp
2.  Event type
3.  Entity
4.  Source
5.  Verification/integrity state

Use the accent colour for the selected event only.

Use semantic indicators for:

-   Integrity issue
-   Timestamp reversal
-   Clock skew
-   Log gap
-   Unparsed event

Never imply causality merely through proximity.

------------------------------------------------------------------------

# 19. Entity Graph

Entities:

-   User
-   IP
-   Host
-   Process
-   File
-   Command
-   Resource

Relationships must show confidence.

Example:

``` text
root ──0.96──> server01
  │
  └─0.91──> 203.0.113.45
```

Do not use many colours for node categories.

Use neutral nodes and accent selection/highlight.

------------------------------------------------------------------------

## 19.1 Graph and timeline accessibility

Interactive visualization cannot depend on dragging, panning or brushing alone.

### Timeline

Provide:

- Keyboard focusable events
- Previous/next event controls
- A sortable event table
- A date/time range form as an alternative to brushing
- Zoom in/out buttons
- Accessible text describing the current selected event

### Entity graph

Provide:

- Keyboard focusable nodes
- Keyboard navigation between connected nodes
- Zoom controls
- Fit-to-view control
- An accessible relationship table containing source entity, relationship, target entity, confidence and evidence IDs

The graph is a visual aid; the relationship table is the non-visual source of truth.

# 20. Privacy Controls

Privacy level selector:

``` text
L0  Raw
L1  Users / emails / hostnames
L2  L1 + IPs
L3  L2 + paths / arguments / free-text PII
```

Default: **L2 — Recommended working level**.

L0 is an evaluation baseline, not the normal working mode. Selecting L0 requires an explicit confirmation step explaining that raw identifiers will be available to local model inference. The confirmation must not imply that L0 sends data externally; it changes the local model's exposure to raw evidence.

Each level needs:

-   Description
-   What is transformed
-   What remains visible
-   Utility warning where applicable

Example:

``` text
Privacy level: L2

Identifiers sent to local model:
Users, hostnames and IP addresses are pseudonymized.

Correlation:
Stable tokens are preserved within this case.
```

Do not imply that stronger pseudonymization has zero utility cost.

------------------------------------------------------------------------

# 21. Egress Verification Status

The PRD requires egress testing but does not specify a continuous network monitor. Therefore the design must not imply live network surveillance.

Use a persistent **last verification result** instead:

```text
Egress verification
PASS · Last verified 2026-11-01 20:14 UTC
```

Possible states:

- `PASS` — last egress verification found no prohibited external transmission
- `FAIL` — verification detected prohibited external transmission
- `CHECKING` — an egress verification is currently running
- `NOT VERIFIED` — no verification result exists

Actions:

- `Run egress verification`
- `View verification details`

Do not display `NETWORK DETECTED` unless a separate runtime network-monitoring requirement is explicitly added to the PRD.

The interface must distinguish **application capability** from **verified runtime state**.

------------------------------------------------------------------------

# 22. Legal Panel

Legal retrieval must be contextual rather than judgmental.

Structure:

``` text
Potentially Relevant Provision

Information Technology Act, 2000
Section 66C

Status
IN FORCE

Potential relevance
Identity/credential misuse may be relevant.

Elements

✓ Supported
Authentication events indicate use of a credential; ownership of that credential is not established by logs alone.

◐ Partial
Technical evidence provides limited support.

— Not supported
No corresponding evidence found.

! Human judgment required
Intent cannot be established from these logs alone.
```

Never use:

-   "The suspect is guilty"
-   "The offence has been proven"
-   "This evidence establishes liability"

Prefer:

-   "Potentially relevant provision"
-   "Evidence supports"
-   "Evidence does not establish"
-   "Requires human judgment"

------------------------------------------------------------------------

# 23. Legal Status

Legal records should visibly distinguish:

-   IN FORCE
-   REPEALED
-   STRUCK DOWN
-   SUPERSEDED

Only operative provisions should appear as current law by default.

Historical provisions may be displayed when relevant to the
investigation period.

Always show:

-   Act
-   Section
-   Status
-   Effective date
-   Source
-   Verification date

------------------------------------------------------------------------

# 24. Alerts

Use alerts for:

-   Integrity warnings
-   Parser coverage problems
-   Evidence-isolation / injection-protection control status
-   Verification failures
-   Egress verification results
-   Legal corpus status issues

Types:

-   `info`
-   `warning`
-   `error`
-   `success`

Do not use alerts for normal status.

Do not label an alert "Prompt injection detected" unless a concrete detection mechanism exists. The MVP should instead expose the state of evidence isolation, output schema validation, verifier backstop and adversarial test results.


------------------------------------------------------------------------

# 25. Loading States

Prefer skeletons for content-heavy views.

Use spinners for short actions.

Example:

``` text
Retrieving evidence…
████████████░░░░
```

For multi-stage investigation:

``` text
✓ Query parsed
✓ Structured + semantic retrieval
✓ Candidate fusion + reranking
✓ Session / timeline correlation
✓ Behaviour mapping
✓ Legal mapping
✓ Pseudonymization
● Local generation
○ Claim verification
```

Never show a fake percentage when progress cannot actually be measured.

------------------------------------------------------------------------

# 26. Empty States

Empty states should explain what happened and what the user can do.

Bad:

`No data`

Good:

``` text
No evidence uploaded

Upload CSV, JSON, TXT or supported Linux/SSH/Apache-style logs
to begin an investigation.

[Upload evidence]
```

------------------------------------------------------------------------

# 27. Error States

Errors must explain:

1.  What failed
2.  Whether evidence was affected
3.  What the investigator can do next

Example:

``` text
Verification unavailable

The claim predicate could not be executed.
No finding has been marked VERIFIED.

[Retry verification] [View predicate]
```

Never silently downgrade a verification failure to success.

------------------------------------------------------------------------

# 28. Accessibility

Target **WCAG 2.2 AA**.

## Keyboard

All interactive elements must be keyboard accessible.

Required:

-   Visible focus
-   Logical tab order
-   Escape closes dialogs/popovers
-   Enter/Space activates controls
-   Arrow keys for menus/tabs where appropriate

Focus ring:

``` text
2px solid accent
2px offset
```

Never remove focus indicators.

Recommended:

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

html {
  scroll-padding-top: 72px;
}
```

------------------------------------------------------------------------

## Pointer and gesture alternatives

Any drag, pan, brush, pinch or hover interaction must have a non-drag equivalent.

Examples:

- Timeline brushing → start/end time inputs
- Graph panning → arrow-key navigation and fit-to-view
- Graph zoom → zoom buttons
- Resizable panels → keyboard-operable resize handles
- Hover-only evidence detail → focus/click equivalent

The entity graph must provide an accessible relationship table.

## Colour

Never communicate information using colour alone.

Examples:

Bad:

`green = verified`

Good:

`✓ VERIFIED`

with green used as reinforcement.

Contrast targets:

-   Normal text: at least 4.5:1
-   Large text: at least 3:1
-   UI boundaries and focus indicators: sufficient visible contrast

------------------------------------------------------------------------

## Screen readers

Use semantic HTML.

Provide accessible names for:

-   Icon-only buttons
-   Graph controls
-   Timeline controls
-   Copy buttons
-   Expand/collapse buttons

Dynamic investigation status should use appropriate live regions.

------------------------------------------------------------------------

## Motion

Respect:

``` css
prefers-reduced-motion: reduce
```

Avoid unnecessary animation.

No pulsing/glowing security effects.

------------------------------------------------------------------------

## 28.1 Sticky header and focus

The 56px top bar is sticky. Add:

```css
html {
  scroll-padding-top: 72px;
}
```

Focusable content must never be hidden beneath the sticky header.

# 29. Copy Tone

The tone is:

**Professional + precise + neutral + evidence-led.**

Avoid marketing language inside the investigation UI.

## Preferred vocabulary

Use:

-   Evidence
-   Finding
-   Claim
-   Predicate
-   Verified
-   Unverified
-   Contradicted
-   Potentially relevant
-   Supported
-   Partial
-   Requires human judgment
-   Provenance
-   Integrity
-   Parser coverage
-   Privacy level
-   Local inference

Avoid:

-   Magic
-   AI knows
-   Guaranteed
-   Proven culprit
-   Hacker detected
-   Criminal
-   Definitely guilty
-   100% accurate
-   Court-proof

------------------------------------------------------------------------

# 30. Button Copy

Prefer verbs.

Good:

-   Upload evidence
-   Start investigation
-   Run verification
-   View evidence
-   Open provenance
-   Re-run search
-   Export report
-   Re-verify integrity
-   Compare results

Avoid:

-   Click here
-   Submit
-   Do it
-   Magic search
-   Analyze everything

------------------------------------------------------------------------

# 31. Confirmation Copy

Destructive action:

``` text
Delete case?

This removes the case from the local investigation workspace.
Original evidence may remain outside this application.

[Cancel] [Delete case]
```

Integrity re-verification:

``` text
Re-verify evidence integrity?

ForensicLens will recompute the SHA-256 hash and compare it
with the recorded evidence hash.
```

------------------------------------------------------------------------

# 32. Data Presentation Rules

## Timestamps

Always distinguish:

-   Original timestamp
-   Normalized UTC timestamp
-   Assumed timezone
-   Timestamp confidence

Example:

``` text
Original
Sep 27 02:31:42

Normalized
2026-09-27 02:31:42 UTC

Confidence
INFERRED_YEAR
```

------------------------------------------------------------------------

## Hashes

Display shortened hashes by default:

``` text
9a8d4f21…f21c
```

Provide copy/full-value access.

Never alter the underlying value.

------------------------------------------------------------------------

## IDs

Use monospace:

``` text
EV-00123
CASE-00042
C1
```

------------------------------------------------------------------------

## 32.1 Timestamp and hash display component

Every evidence timestamp component should support:

```text
2026-09-27 02:31:42 UTC
Original: Sep 27 02:31:42
Assumed TZ: UTC
Confidence: INFERRED_YEAR
```

Hash component:

```text
SHA-256
9a8d4f21…f21c    [Copy]
```

The full value must be available on demand without modifying the stored hash.

# 33. Dashboard

Primary dashboard cards:

1.  Cases
2.  Evidence files
3.  Events
4.  Parser coverage
5.  Integrity status
6.  Local/egress status
7.  Active investigations
8.  Verification summary

Example:

``` text
┌───────────────┐
│ Parser        │
│ Coverage      │
│               │
│ 97.4%         │
│ 3,421 / 3,512 │
└───────────────┘
```

Avoid decorative charts unless they help answer an investigative
question.

------------------------------------------------------------------------

# 34. Investigation Page

Recommended structure:

``` text
Investigation
──────────────────────────────────────────────────────

[ Natural-language investigation query                  ]

Privacy: [L2]                         [Investigate]

Retrieval
Hybrid + Reranker

Findings
──────────────────────────────────────────────────────
✓ VERIFIED
Claim...

Evidence
──────────────────────────────────────────────────────
EV-00123
EV-00129

Timeline
──────────────────────────────────────────────────────

Legal context
──────────────────────────────────────────────────────
Potentially relevant provisions...

Claim verification
──────────────────────────────────────────────────────
Claim → Predicate → Events → Raw evidence
```

------------------------------------------------------------------------

# 34.1 Case Integrity View

Every case needs a dedicated integrity summary showing:

- Source-file SHA-256 status
- Parser coverage
- Log gaps
- Timestamp reversals
- Inter-source clock skew
- Truncated files
- Rotated-log discontinuities
- Any source-recorded log-clearing/tampering indicators

Each issue must expose:

```text
Issue
Evidence/source
Observed range
Severity
Method
Related event IDs
```

Do not silently repair timestamps or evidence. Preserve the original values and show normalization separately.

---

# 34.2 Audit Chain View

Provide a read-only audit chain viewer.

Columns:

- Sequence
- Timestamp
- Action
- Actor/session
- Case
- Object
- Previous hash
- Record hash
- Verification status

Actions should include model/prompt versions and generated findings where applicable.

The view must support:

- Verify chain
- Copy hash
- Open related object
- Export audit records

---

# 34.3 Confidence Badge

Confidence is **derived by the verifier/evidence layer**, not selected by the LLM.

Use:

- `HIGH`
- `MEDIUM`
- `LOW`

Display the basis next to the badge.

### HIGH

All material claims are VERIFIED and supported by at least two independent events/sources, with no integrity flags on those events.

### MEDIUM

All material claims are VERIFIED but rely on one event/source, or integrity flags apply.

### LOW

Some material claims are UNVERIFIED or evidence is insufficient.

Example:

```text
HIGH
14 independent events · 100% material claims verified
```

Never present confidence without its basis.

---

# 34.4 BSA s.63 Certificate Draft

The report must include a clearly labelled:

**Draft electronic-record certificate summary — BSA s.63**

Fields:

- Case ID
- Evidence file
- SHA-256
- Tool / application version
- Processing process
- Processing timestamp
- Relevant output/report identifier
- Model and model-file hash where applicable

Display a persistent disclaimer:

```text
Draft for expert and legal review.
ForensicLens does not issue a legal certificate and does not determine
court admissibility.
```

This is a report artifact required by the PRD, not a legal certification feature.

# 35. Report Page

Reports should contain:

-   Case information
-   Investigation question
-   Findings
-   Verification status
-   Supporting evidence
-   Timeline
-   Integrity information
-   Legal context
-   Limitations
-   Model version
-   Prompt version
-   Privacy level
-   Reproducibility metadata

Include an explicit disclaimer:

``` text
ForensicLens provides investigative assistance and contextual legal
information. It does not determine guilt, liability, legal conclusions,
or court admissibility.
```

------------------------------------------------------------------------

# 36. Component State Matrix

Every interactive component should account for:

  State              Required
  ------------------ ------------------
  Default            Yes
  Hover              Yes
  Focus-visible      Yes
  Active / pressed   Yes
  Selected           Where applicable
  Disabled           Yes
  Loading            Where applicable
  Error              Where applicable
  Success            Where applicable
  Empty              Where applicable

For investigation-specific components also support:

-   VERIFIED
-   UNVERIFIED
-   CONTRADICTED
-   SUPPORTED
-   PARTIAL
-   NOT SUPPORTED
-   REQUIRES HUMAN JUDGMENT
-   INTEGRITY WARNING

------------------------------------------------------------------------

# 37. Styleguide Page

Create `/styleguide`.

The page must render every design token and major component so the
system can be visually inspected.

Sections:

1.  Brand
2.  Colour tokens
3.  Typography
4.  Spacing
5.  Radius
6.  Shadows
7.  Buttons
8.  Inputs
9.  Selects
10. Checkboxes
11. Switches
12. Tabs
13. Badges
14. Alerts
15. Tooltips
16. Dialogs
17. Dropdowns
18. Command menu
19. Tables
20. Evidence cards
21. Verification states
22. Privacy selector
23. Timeline
24. Claim verification trace
25. Legal element coverage
26. Loading states
27. Empty states
28. Error states
29. Dark mode

The styleguide should be accessible from:

``` text
/styleguide
```

It should use real components, not screenshots or static mockups.

------------------------------------------------------------------------

# 38. CSS Token Contract

The CSS contract must include every token defined in this document.

```css
:root {
  --background: #f8fafc;
  --surface: #ffffff;
  --surface-subtle: #f1f5f9;
  --surface-muted: #e2e8f0;
  --surface-inverse: #0f172a;

  --text-primary: #0f172a;
  --text-secondary: #334155;
  --text-muted: #5a687b;
  --text-disabled: #94a3b8;
  --text-inverse: #f8fafc;

  --border: #cbd5e1;
  --border-subtle: #e2e8f0;
  --border-strong: #64748b;
  --control-border: #64748b;

  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-active: #3730a3;
  --accent-subtle: #eef2ff;
  --accent-text: #3730a3;

  --status-success: #15803d;
  --status-success-bg: #f0fdf4;
  --status-warning: #a16207;
  --status-warning-bg: #fefce8;
  --status-danger: #b91c1c;
  --status-danger-bg: #fef2f2;
  --status-neutral: #475569;
  --status-neutral-bg: #f1f5f9;
  --status-human: #7c3aed;
  --status-human-bg: #f5f3ff;

  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-full: 9999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  --shadow-xs: 0 1px 2px rgba(15,23,42,.04);
  --shadow-sm: 0 1px 3px rgba(15,23,42,.08);
  --shadow-md: 0 4px 12px rgba(15,23,42,.10);
  --shadow-lg: 0 12px 32px rgba(15,23,42,.14);
}
```

Dark mode must override these variables rather than duplicating component styles:

```css
.dark {
  --background: #0b1120;
  --surface: #111827;
  --surface-subtle: #172033;
  --surface-muted: #1e293b;
  --surface-inverse: #f8fafc;

  --text-primary: #f8fafc;
  --text-secondary: #cbd5e1;
  --text-muted: #94a3b8;
  --text-disabled: #64748b;
  --text-inverse: #0f172a;

  --border: #64748b;
  --border-subtle: #334155;
  --border-strong: #64748b;
  --control-border: #64748b;

  --accent: #818cf8;
  --accent-hover: #a5b4fc;
  --accent-active: #6366f1;
  --accent-subtle: #1e1b4b;
  --accent-text: #c7d2fe;

  --status-success: #4ade80;
  --status-success-bg: #052e16;
  --status-warning: #facc15;
  --status-warning-bg: #422006;
  --status-danger: #f87171;
  --status-danger-bg: #450a0a;
  --status-neutral: #cbd5e1;
  --status-neutral-bg: #1e293b;
  --status-human: #c4b5fd;
  --status-human-bg: #2e1065;
}
```

Dark-mode primary buttons using `--accent` must use `--text-inverse` / `#0F172A` as their label colour, not white.

# 39. Do / Don't

## Do

-   Show provenance.
-   Show verification status.
-   Preserve original evidence visually.
-   Make privacy level obvious.
-   Use monospace for forensic identifiers.
-   Use neutral layouts.
-   Keep actions predictable.
-   Explain uncertainty.
-   Make human judgment explicit.

## Don't

-   Make AI output visually authoritative by default.
-   Hide unverified claims.
-   Use colour as the only status indicator.
-   Call a legal provision a confirmed offence.
-   Modify original evidence for presentation.
-   Use decorative cyberpunk styling.
-   Create a rainbow of category colours.
-   Claim offline operation without verification.
-   Present hash integrity as proof of admissibility.

------------------------------------------------------------------------

# 39.1 Canonical terminology

Always use:

- `HUMAN JUDGMENT`
- `REQUIRES HUMAN JUDGMENT`

Do not use "judgement".

Use the PRD's claim status values exactly:

- `VERIFIED`
- `UNVERIFIED`
- `CONTRADICTED`

Use the PRD's legal coverage values exactly:

- `SUPPORTED`
- `PARTIAL`
- `NOT SUPPORTED`
- `REQUIRES HUMAN JUDGMENT`

Use claim IDs in the canonical `C1`, `C2`, … format and evidence IDs in the canonical `EV-00123` format.

# 40. Final Design Principle

ForensicLens should visually communicate one idea above everything else:

> **The system may assist with reasoning, but evidence remains the
> source of truth.**

The interface hierarchy should therefore be:

``` text
Original Evidence
      ↓
Normalized Evidence
      ↓
Retrieved Evidence
      ↓
Claim
      ↓
Predicate
      ↓
Machine Verification
      ↓
Finding
      ↓
Potential Legal Context
```

The UI must make this chain visible rather than hiding it behind an
AI-generated answer.
