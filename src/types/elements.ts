/**
 * Element model — what the crawler produces and what the selector engine
 * consumes. Modelled after Playwright's internal element representation
 * (role + accessible name + DOM attrs) but framework-agnostic.
 */

/** ARIA roles that UAIP cares about for codegen. Subset of the full spec — we
 *  focus on roles that have stable user-facing semantics. Unknown roles fall
 *  back to `generic`. */
export type AriaRole =
  | "button"
  | "link"
  | "textbox"
  | "searchbox"
  | "combobox"
  | "checkbox"
  | "radio"
  | "switch"
  | "slider"
  | "spinbutton"
  | "tab"
  | "menuitem"
  | "option"
  | "listbox"
  | "list"
  | "listitem"
  | "heading"
  | "img"
  | "dialog"
  | "alert"
  | "navigation"
  | "main"
  | "region"
  | "form"
  | "table"
  | "cell"
  | "row"
  | "columnheader"
  | "rowheader"
  | "status"
  | "generic";

/** DOM attributes we capture verbatim. `dataTestAttributes` is a map because
 *  `data-test`, `data-testid`, `data-qa`, `data-cy` all coexist in the wild. */
export interface ElementAttributes {
  id?: string;
  name?: string;
  className?: string;
  type?: string;
  placeholder?: string;
  value?: string;
  href?: string;
  alt?: string;
  title?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  /** All data-* attributes keyed by their full name (including the `data-` prefix). */
  dataAttributes: Record<string, string>;
}

/** Viewport-relative bounding box from `element.boundingBox()`. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A single UI element discovered by the crawler. Every field is optional
 * except the stable identity triple: `tag`, `role`, `uaipId`.
 *
 * `uaipId` is a content hash generated at crawl time — stable across runs as
 * long as the element's role + name + structural position don't change. It is
 * how downstream packages reference the element without needing the full
 * selector list re-materialised.
 */
export interface UiElement {
  /** Deterministic ID for cross-run referencing. SHA256(role|name|path|index) truncated. */
  uaipId: string;

  /** HTML tag in lowercase (e.g. "button", "input", "a"). */
  tag: string;

  /** Computed accessibility role. Always present; defaults to "generic". */
  role: AriaRole;

  /** Accessible name (computed via ARIA + text content). Used for `role=... name=...`. */
  accessibleName?: string;

  /** Visible text content, trimmed. May differ from accessibleName. */
  text?: string;

  /** Captured attributes. */
  attrs: ElementAttributes;

  /** DOM path from the document root (not a selector — used for uaipId hashing
   *  and for computing structural stability scores). */
  domPath: string;

  /** XPath, unique within the document at crawl time. Used as last-resort selector. */
  xpath: string;

  /** Viewport bounding box at crawl time. Optional because hidden elements skip layout. */
  box?: BoundingBox;

  /** True if the element was actually interactable (visible, enabled, has pointer events). */
  interactable: boolean;

  /** Ordinal position among siblings with the same tag — used for tie-breaking selectors. */
  siblingIndex: number;
}
