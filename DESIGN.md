---
name: taskbase
description: The agency's own task manager, calm and exact, with one blue signal where action is needed.
colors:
  bg: "oklch(0.982 0.002 250)"
  surface: "oklch(0.995 0.001 250)"
  surface-2: "oklch(0.967 0.003 250)"
  surface-3: "oklch(0.94 0.005 250)"
  border: "oklch(0.915 0.004 250)"
  border-strong: "oklch(0.86 0.006 250)"
  text: "oklch(0.22 0.012 260)"
  text-muted: "oklch(0.46 0.013 260)"
  text-subtle: "oklch(0.52 0.012 260)"
  accent: "oklch(0.56 0.19 258)"
  accent-hover: "oklch(0.51 0.19 258)"
  accent-fg: "oklch(0.99 0.004 258)"
  accent-soft: "oklch(0.955 0.025 258)"
  accent-text: "oklch(0.48 0.18 258)"
  success: "oklch(0.56 0.13 152)"
  success-soft: "oklch(0.96 0.03 152)"
  warning: "oklch(0.64 0.14 65)"
  warning-text: "oklch(0.52 0.13 60)"
  warning-soft: "oklch(0.965 0.035 80)"
  danger: "oklch(0.56 0.2 27)"
  danger-text: "oklch(0.5 0.19 27)"
  danger-soft: "oklch(0.96 0.025 27)"
  overlay: "oklch(0.2 0.01 260 / 0.28)"
  workspace-slate: "oklch(0.55 0.02 260)"
  workspace-red: "oklch(0.6 0.19 25)"
  workspace-orange: "oklch(0.68 0.16 50)"
  workspace-amber: "oklch(0.76 0.15 80)"
  workspace-green: "oklch(0.62 0.14 150)"
  workspace-teal: "oklch(0.62 0.1 195)"
  workspace-blue: "oklch(0.58 0.16 250)"
  workspace-violet: "oklch(0.56 0.17 295)"
  workspace-pink: "oklch(0.64 0.18 350)"
typography:
  display:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.375
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  control:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  meta:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.45
  number:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "4px"
  segment: "5px"
  md: "6px"
  card: "8px"
  surface: "10px"
  dialog: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
  button-ghost:
    textColor: "{colors.text-muted}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  nav-item:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
  segmented-control:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
    padding: "2px"
    height: "32px"
  segmented-control-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.segment}"
  status-pill-in-progress:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "20px"
  status-pill-on-hold:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "20px"
  status-pill-resolved:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "20px"
  status-pill-rejected:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "20px"
  tag-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 6px"
    height: "20px"
  menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.surface}"
    padding: "4px"
  menu-item-highlighted:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
    height: "32px"
  tooltip:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  dialog:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.dialog}"
    padding: "20px"
  task-check:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.full}"
    size: "17px"
  task-check-done:
    backgroundColor: "{colors.success}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.full}"
    size: "17px"
  avatar:
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.full}"
    size: "24px"
---

# Design System: taskbase

## Overview

**Creative North Star: "The Well-Kept Ledger"**

taskbase is a ledger the whole agency keeps together: every job accounted for, written in calm ink on clean paper, with a single blue mark wherever something needs a person. The page itself stays quiet so that the few things that matter (an overdue date, a task waiting on another, a new assignment) read at a glance. Density is that of a working tool rather than a showcase: rows are compact, the type is small and exact, and nothing decorates for its own sake.

The mood is warm, friendly and light, but the warmth comes from tone, not hue. The neutrals stay a cool, faintly blue paper; friendliness lives in plain British copy that talks to people ("Nothing assigned to you"), generous breathing room around content, softened corners, kind empty states that say what will appear and how, and small acknowledgements like an Undo after every destructive action. Controls are quiet until touched: hairline borders and ghost buttons at rest, revealing a surface on hover, with shadows reserved for things that genuinely float.

Light and dark themes carry the same roles. Dark mode is a deep blue-graphite page with the same single blue signal, tuned so white text on blue still reads at 4.6:1.

**Key Characteristics:**
- One accent, Signal Blue, for primary actions, focus, selection and the active state; everything else is Paper and Ink.
- Status speaks through small icons and soft-tinted pills, never through loud fills.
- Flat surfaces separated by hairlines; real shadows only on menus, popovers, dialogs and the side panel.
- Compact, exact type (14px base, 13px controls, 12.5px meta) in Geist, with tabular numerals for counts and dates.
- Two radii doing almost all the work: 6px for controls, 10px for surfaces; circles for people and task completion.
- Short, eased entrances that switch off entirely for people who prefer reduced motion.

## Colors

A cool Paper and Ink neutral ramp carries the interface, one Signal Blue marks where to act, three soft semantic tints report status, and a separate muted palette only identifies workspaces.

### Primary
- **Signal Blue** (`accent`): primary buttons, focus outlines, text selection, the unread badge, links and the active checkbox in pickers. Its darker step (`accent-hover`) is the pressed and hover state; `accent-text` is the readable-as-text variant for links and the "In progress" pill; `accent-soft` is the faint wash behind highlighted rows and the in-progress pill.

### Neutral
- **Page Paper** (`bg`): the app background behind everything, including the sidebar.
- **Sheet** (`surface`): cards, menus, inputs, dialogs, the task panel and secondary buttons sit one step lighter than the page.
- **Shaded Paper** (`surface-2`, `surface-3`): hover states, segmented-control tracks, the active nav item and the rejected pill. Two quiet steps, never more.
- **Ruled Line** (`border`, `border-strong`): hairline dividers between rows and around controls; the stronger step on hover and for empty checkboxes.
- **Ink** (`text`): titles and body text, a deep blue-black rather than pure black.
- **Faded Ink** (`text-muted`): secondary text, icons in nav and menus, meta lines.
- **Pencil** (`text-subtle`): placeholders, timestamps and completed task titles; still 5.5:1 on surface and 4.6:1 on the darkest surface.

### Status
- **Done Green** (`success`, `success-soft`): completed checkboxes and the Resolved pill.
- **Hold Amber** (`warning`, `warning-text`, `warning-soft`): On hold, due-today and "waiting for" signals. `warning` is for icons and fills only; text uses `warning-text`.
- **Overdue Red** (`danger`, `danger-text`, `danger-soft`): overdue dates, destructive buttons, form errors. Text and icons drawn in the text colour use `danger-text`; `danger` is for fills and borders.

### Workspace identity
- **Nine muted marks** (`workspace-slate` to `workspace-pink`), plus any custom hex a workspace owner picks: only ever the small square beside a workspace name, the dot on a tag chip, and board column accents.

### Named Rules
**The One Signal Rule.** Signal Blue is the only accent. If something needs to stand out and it is not an action, a focus or a selection, use weight, position or a soft status tint instead.

**The Identity-Not-Interface Rule.** Workspace colours identify; they never style state, buttons, text or backgrounds. A workspace colour larger than a 12px mark is a mistake.

**The Readable Warning Rule.** Amber text always uses `warning-text`, and red text always uses `danger-text`. Plain `warning` and `danger` fail contrast as text on tinted or dark surfaces: `warning` is kept for icons and fills, `danger` for fills and borders.

## Typography

**Body Font:** Geist (with ui-sans-serif, system-ui)
**Number Font:** Geist Mono (with ui-monospace, SF Mono)

**Character:** One neutral, precise sans for everything, set small and tight like a well-kept ledger, with a monospace reserved for task numbers so `#142` always reads as a reference, not prose.

### Hierarchy
- **Display** (600, 22px, -0.025em): sign-in, sign-up and not-found headings only.
- **Headline** (600, 20px, 1.375 line height, -0.025em): the task title in the task panel.
- **Title** (600, 15px, -0.025em): page titles in the header bar and empty-state headings.
- **Body** (400, 14px, 1.45): task titles in rows, descriptions, comments and inputs. Descriptions cap at about 70ch.
- **Control** (500, 13px): buttons, menu items, segmented tabs, labels. Nav items run at 13.5px.
- **Meta** (400, 12.5px and 12px): hints, timestamps, the meta line under titles, form help and errors.
- **Label** (500, 11.5px): status pills, tag chips, small counts.
- **Number** (Geist Mono, 11 to 11.5px): task numbers.

### Named Rules
**The Two Weights Rule.** Text is 400 or emphasised at 500 (controls) or 600 (titles). Bold (700) is not part of the system; the one exception is the taskbase wordmark, which is part of the logo.

**The Numbers Line Up Rule.** Counts, badges, dates and anything that changes in place use tabular numerals so columns and badges never jitter.

## Layout

The app is a three-zone workspace: a 248px sidebar on the page background, a main column, and a task panel that opens on the right at desktop widths and covers the list on smaller screens. Below 1024px the sidebar becomes a 264px drawer opened from a menu button in the page header.

Every page starts with a header bar at least 56px tall (title on the left, actions on the right, wrapping to a second row on narrow screens). Content uses a 16px side gutter on phones and 24px from 640px up. Long-form settings and lists of records sit in a centred column (672px for settings, 768px for the trash and similar lists); task lists and boards use the full width.

Spacing follows a 4px base: 4, 6 and 8px inside controls, 12px between a row's parts, 16 and 24px between sections. Task rows are compact (8px vertical padding, 44px list headers) and separated by hairlines rather than gaps. Rows decide what to show by their own width with container queries, not the viewport: tags appear only when a row is at least 44rem wide, so a narrowed list never overlaps.

## Elevation & Depth

The system is flat by default and conveys structure through tone and hairlines: the page is `bg`, working surfaces are one step lighter, and borders separate rather than shadows. Depth appears only when something floats above the page.

### Shadow Vocabulary
- **Card** (`0 1px 2px hsl(var(--shadow-color) / 0.07)`): the faintest lift, on secondary buttons, the active segment of a segmented control and board cards, so they read as pressable or movable.
- **Pop** (`0 1px 2px hsl(var(--shadow-color) / 0.08), 0 8px 24px -4px hsl(var(--shadow-color) / 0.16)`): menus, popovers, tooltips, dialogs and the Cmd+K palette.
- **Panel** (`-12px 0 32px -12px hsl(var(--shadow-color) / 0.18)`): the left edge of the task panel as it slides over content.
- **Primary sheen** (`inset 0 1px 0 rgb(255 255 255 / 0.12)`): a one-pixel highlight along the top of primary buttons.

`--shadow-color` is a cool blue-grey in light mode and near-black in dark mode, so shadows stay tinted to the page rather than grey.

### Named Rules
**The Float Only Rule.** Rows and sections rest flat. A real shadow means "this is above the page and will go away": a menu, a dialog, the panel, the bulk-edit bar. The only resting lift is the one-pixel Card shadow: on things you can press or pick up, and on the main content sheet, which sits on the page like a sheet of paper on a desk at desktop widths.

## Shapes

Corners are softened but disciplined, and nearly everything uses one of two radii. Controls (buttons, inputs, menu items, nav items, segmented tracks) use 6px. Surfaces that contain things (menus, popovers, AI cards, the bulk-edit bar, empty-state icons) use 10px; board cards use 8px, a touch tighter because they tile in columns; dialogs and the Cmd+K palette go to 12px because they sit alone above an overlay. Segments inside a segmented control use 5px so they nest inside the 6px track.

Shape also carries meaning. People (avatars) and task completion (the task checkbox) are circles. Subtask checkboxes are small 4px squares, so a task and its subtasks never look alike. Status pills are 4px-cornered rectangles; tag chips are full pills with a coloured dot.

### Named Rules
**The Two Radii Rule.** Reach for 6px or 10px. A new radius needs a reason: nesting (the 5px segment), tiling (the 8px board card) or isolation (the 12px dialog).

## Components

### Buttons
Quiet, compact and honest about what they do.
- **Shape:** gently rounded (6px), 32px tall by default; 28px small and 40px large; square 32px and 28px icon buttons.
- **Primary:** Signal Blue with near-white text (13px, 500) and a one-pixel top sheen. One per view at most; it is the "act here" mark.
- **Secondary:** Sheet surface, hairline border and the Card shadow; hover shades to `surface-2` and strengthens the border.
- **Ghost:** no chrome at rest, Faded Ink text; hover reveals a `surface-2` fill and Ink text. Most toolbar and row actions are ghosts.
- **Danger / Danger-ghost:** red fill for the confirming button in a destructive dialog; red text with a soft red hover elsewhere.
- **Press:** every button nudges down 1px when pressed; colour transitions run 150ms. Disabled buttons drop to 50% opacity.

### Status pills and tag chips
- **Status pill:** a 20px, 4px-cornered label (11.5px, 500) in a soft tint: blue for In progress, amber for On hold, green for Resolved, grey for Rejected. "Open" shows no pill at all, so the default state stays quiet. Status always pairs an icon or label with its colour.
- **Tag chip:** a 20px full pill on Sheet with a hairline border, a 6px dot in the tag's colour and Faded Ink text, capped in width and truncated.

### Cards and containers
- **Corner style:** 10px for containers and AI cards; 8px for board cards.
- **Background:** Sheet (`surface`) on the Page Paper background; AI cards use a faint Signal Blue wash with a blue hairline.
- **Shadow strategy:** containers are flat; board cards carry the one-pixel Card shadow because they can be dragged (see the Float Only Rule).
- **Border:** one hairline (`border`).
- **Internal padding:** 12px for board cards, 14px for AI cards, 20px for dialogs.

### Inputs and fields
- **Style:** 36px tall, 6px corners, Sheet background, hairline border; 14px text with Pencil placeholders.
- **Focus:** the border turns Signal Blue with a soft 3px blue halo (15% opacity).
- **Hover:** the border strengthens to `border-strong`.
- **Error / disabled:** errors appear as 12.5px red text under the field with `role="alert"`; disabled fields fade to 60%.
- **Labels and hints:** 13px medium label above, 12.5px Faded Ink hint below.

### Navigation
- **Sidebar items:** 32px rows, 6px corners, 13.5px Faded Ink text with a muted icon. Hover shades to `surface-2`; the current page sits on `surface-3` in Ink at 500 weight with `aria-current`. Workspaces list below with their identity square.
- **Segmented control:** a `surface-2` track with a 2px inset; the active segment is a Sheet tile with the Card shadow. Used for List / Board / Gantt and for My tasks' To do / Completed / Updates.
- **Page tabs:** a page with sections that each have a count (Workspaces) uses underline tabs: 13px medium labels with a tabular count in Pencil, a 2px Signal Blue underline on the current one, scrolling sideways on phones rather than wrapping.
- **Mobile:** the sidebar becomes a drawer under an overlay, closed by Escape, the overlay or navigation.

### Menus, popovers and dialogs
- **Menus and popovers:** Sheet, 10px corners, hairline border, Pop shadow, 4px inner padding; 32px items with 6px corners highlighted in `surface-2`; icons in Faded Ink. Enter with a 140ms rise and fade.
- **Dialogs:** 12px corners over a soft overlay, 20px padding, a 15px title and an optional 13px description. Confirmations are in-app dialogs, never the browser's own.
- **Tooltips:** inverted (Ink background, Paper text), 12px, 6px corners.

### Loading
While a page loads, a skeleton in the page's own shape (header bar, then task rows with a ring for the checkbox) holds the layout so content arrives without a jump. Bars use `surface-2` and pulse only under `prefers-reduced-motion: no-preference`.

### Avatars
Circles at 20, 24, 28 or 36px with white initials on a muted, deterministic hue per person (or a Google photo). Several people stack with a small overlap and a "+N" for the rest, with every name in the tooltip.

### Task row (signature component)
The heart of the ledger. A round completion checkbox (17px circle, turning Done Green with a check, or grey with a cross when rejected), then the title in Body type, tags when the row has room, and a right-aligned meta line: status pill, subtask progress (an expander that reveals subtasks inline), comment and file counts, the due date (red when overdue, amber when due today) and the assignees. Rows separate with hairlines, highlight in `accent-soft` when their task is open in the panel, and underline only the title on keyboard focus. A drag handle appears on hover. An overdue date carries a small filled warning icon as well as Overdue Red, so overdue never depends on colour alone; due today is Hold Amber and reads "Today".

### Checkboxes
- **Task:** a 17px circle; done is Done Green with a check, rejected is grey with a cross.
- **Subtask:** a 16px square with 4px corners; done is Done Green, the same as tasks.
- **Selection** (bulk edit): a square in Signal Blue, because selecting is not completing.

## Do's and Don'ts

### Do:
- **Do** take colours from the tokens (`bg`, `surface`, `text`, `accent` and the rest) and pair every light value with its dark-theme counterpart through the same token.
- **Do** keep Signal Blue to actions, focus, selection and the active state.
- **Do** use 6px corners on controls and 10px on surfaces.
- **Do** write UI copy in plain British English that speaks to the person, and give every empty state a title plus one line on what will appear there.
- **Do** offer Undo (or a confirming in-app dialog) for anything destructive.
- **Do** use tabular numerals for counts, badges and dates.
- **Do** let rows adapt to their own width with container queries before hiding things by viewport.
- **Do** keep motion short and eased (140 to 220ms, ease-out-quint) and behind `prefers-reduced-motion: no-preference`.
- **Do** use Phosphor icons from `@phosphor-icons/react/ssr`, 13 to 18px, in Faded Ink unless they carry status.
- **Do** let browser surfaces carry the design: text selection, the caret, scrollbars and link underlines all take their colour and offset from the tokens in `globals.css`.

### Don't:
- **Don't** add a second accent colour or use a workspace colour for anything but its small identity mark.
- **Don't** use pure black or pure white; Ink and Sheet are deliberately off.
- **Don't** put shadows on resting rows, containers or sections; only pressable or draggable things get the one-pixel Card lift.
- **Don't** set amber text in `warning` or red text in `danger`; use `warning-text` and `danger-text`.
- **Don't** signal status with colour alone; pair it with an icon or a label.
- **Don't** use em dashes in UI copy.
- **Don't** use bold (700) outside the logo wordmark, or text below 11px (avatar initials and the avatar "+N" badge excepted).
- **Don't** use the browser's `confirm()`, `alert()` or `prompt()`; embedded browsers suppress them.
- **Don't** mix in icons from other libraries or hand-drawn SVG icons.
