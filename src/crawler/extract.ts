/**
 * Element extraction — runs inside the browser context via `page.evaluate()`
 * so we can walk the DOM and computed accessibility tree without paying the
 * RPC cost of thousands of round-trips.
 *
 * Everything inside `page.evaluate(() => { ... })` executes in the page's
 * own context and must be self-contained (no Node imports, no closure refs).
 */

import type { Page } from "playwright";
import type { UiElement, AriaRole, BoundingBox } from "../types/index.js";

/**
 * Returns UiElement[] for every interactable-looking element on the page.
 * Hashes for `uaipId` are computed in Node after extraction.
 */
export async function extractElements(page: Page): Promise<UiElement[]> {
  // Step 1: harvest raw element data from the page.
  const raw = await page.evaluate(extractElementsBrowser);

  // Step 2: hash each to a stable uaipId and return.
  return raw.map((r, i) => ({
    ...r,
    uaipId: hashElement(r.tag, r.role, r.accessibleName, r.domPath, i),
  }));
}

/** Browser-side function. Pure, no closures. Runs inside the page context. */
function extractElementsBrowser(): Omit<UiElement, "uaipId">[] {
  const INTERACTABLE_TAGS = new Set([
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "label",
    "option",
    "summary",
  ]);
  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "combobox",
    "checkbox",
    "radio",
    "switch",
    "slider",
    "spinbutton",
    "tab",
    "menuitem",
    "option",
  ]);

  function computeRole(el: Element): string {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case "a":
        return (el as HTMLAnchorElement).href ? "link" : "generic";
      case "button":
        return "button";
      case "input": {
        const type = ((el as HTMLInputElement).type || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "submit" || type === "button" || type === "reset")
          return "button";
        if (type === "search") return "searchbox";
        return "textbox";
      }
      case "textarea":
        return "textbox";
      case "select":
        return "combobox";
      case "label":
        return "generic";
      case "nav":
        return "navigation";
      case "main":
        return "main";
      case "form":
        return "form";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return "heading";
      case "img":
        return "img";
      case "dialog":
        return "dialog";
      case "ul":
      case "ol":
        return "list";
      case "li":
        return "listitem";
      case "table":
        return "table";
      case "td":
      case "th":
        return "cell";
      case "tr":
        return "row";
      default:
        return "generic";
    }
  }

  function accessibleName(el: Element): string | undefined {
    // Simplified accessible name computation. Full algorithm is W3C ACCNAME
    // which is complex — we implement the 80% case that matters for codegen.
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel?.trim()) return ariaLabel.trim();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }

    // <label for="..."> association
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl?.textContent) return lbl.textContent.trim();
    }

    // For inputs, the wrapping <label> counts
    const wrappingLabel = el.closest("label");
    if (wrappingLabel) {
      const txt = (wrappingLabel.textContent || "").trim();
      if (txt) return txt;
    }

    // alt for images, value for buttons, placeholder for text inputs
    const tag = el.tagName.toLowerCase();
    if (tag === "img") {
      const alt = el.getAttribute("alt");
      if (alt?.trim()) return alt.trim();
    }
    if (tag === "input") {
      const input = el as HTMLInputElement;
      const type = (input.type || "text").toLowerCase();
      if (type === "submit" || type === "button") {
        return (input.value || "").trim() || undefined;
      }
      // For text-like inputs, placeholder is the best accessible-name fallback.
      // ACCNAME treats placeholder as a last-resort naming source; matching that
      // here means role+name selectors (score 50) become available when a page
      // skips <label> entirely (common on marketing/demo sites).
      const textLikeInputTypes = new Set([
        "text",
        "email",
        "search",
        "tel",
        "url",
        "password",
        "number",
      ]);
      if (textLikeInputTypes.has(type)) {
        const placeholder = input.getAttribute("placeholder");
        if (placeholder?.trim()) return placeholder.trim();
      }
    }
    if (tag === "textarea") {
      const placeholder = el.getAttribute("placeholder");
      if (placeholder?.trim()) return placeholder.trim();
    }
    if (tag === "button" || tag === "a") {
      const txt = (el.textContent || "").trim();
      if (txt) return txt;
    }
    // Headings: their text content is their accessible name per ACCNAME.
    if (/^h[1-6]$/.test(tag)) {
      const txt = (el.textContent || "").trim();
      if (txt) return txt;
    }
    return undefined;
  }

  function domPath(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      const parentEl: Element | null = node.parentElement;
      if (!parentEl) {
        parts.unshift(tag);
        break;
      }
      const currentTag = node.tagName;
      const siblings: Element[] = Array.from(parentEl.children).filter(
        (c: Element) => c.tagName === currentTag,
      );
      const idx = siblings.indexOf(node);
      parts.unshift(siblings.length > 1 ? `${tag}[${idx}]` : tag);
      node = parentEl;
    }
    return "/" + parts.join("/");
  }

  function xpathFor(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1) {
      const tag = node.tagName.toLowerCase();
      const parentEl: Element | null = node.parentElement;
      if (!parentEl) {
        parts.unshift(tag);
        break;
      }
      const currentTag = node.tagName;
      const siblings: Element[] = Array.from(parentEl.children).filter(
        (c: Element) => c.tagName === currentTag,
      );
      const idx = siblings.indexOf(node) + 1;
      parts.unshift(`${tag}[${idx}]`);
      node = parentEl;
    }
    return "/" + parts.join("/");
  }

  function siblingIndexOf(el: Element): number {
    if (!el.parentElement) return 0;
    const sameTag = Array.from(el.parentElement.children).filter(
      (c) => c.tagName === el.tagName,
    );
    return sameTag.indexOf(el);
  }

  function boundingBoxOf(el: Element): BoundingBox | undefined {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return undefined;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  // Walk up the ancestor chain and reject if any layer is invisible.
  // Why ancestors: a child can be display:block / opacity:1 itself but live
  // inside a closed drawer (opacity:0) or hidden tab panel (display:none).
  // The drawer items on saucedemo are exactly this case — that's why the
  // simple `getComputedStyle(el)` check missed them and the generated
  // Selenium tests timed out asserting visibility.
  function isVisuallyVisible(el: Element): boolean {
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1) {
      const cs = window.getComputedStyle(cur as HTMLElement);
      if (cs.display === "none") return false;
      if (cs.visibility === "hidden" || cs.visibility === "collapse")
        return false;
      const op = parseFloat(cs.opacity);
      if (!Number.isNaN(op) && op === 0) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  // Catches elements translated off-page (e.g. closed off-canvas menus
  // using `transform: translateX(-100%)`). getBoundingClientRect reflects
  // the post-transform position, so the drawer's children come back with
  // negative right/bottom coords even though they have a non-zero size.
  function isOnPage(el: Element): boolean {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const docW = Math.max(
      document.documentElement.scrollWidth,
      window.innerWidth,
    );
    const docH = Math.max(
      document.documentElement.scrollHeight,
      window.innerHeight,
    );
    if (r.right <= 0 || r.bottom <= 0) return false;
    if (r.left >= docW || r.top >= docH) return false;
    return true;
  }

  // Hit-test: the center of the element must actually be reachable.
  // Only meaningful when the element is currently within the viewport;
  // for below-the-fold elements we trust isOnPage and skip this check
  // (Selenium will scroll into view before clicking).
  function isHitTestable(el: Element): boolean {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (
      cx < 0 ||
      cy < 0 ||
      cx >= window.innerWidth ||
      cy >= window.innerHeight
    ) {
      return true;
    }
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) return false;
    return el === hit || el.contains(hit) || hit.contains(el);
  }

  function isInteractable(el: Element): boolean {
    const tag = el.tagName.toLowerCase();
    const role = computeRole(el);
    if (!INTERACTABLE_TAGS.has(tag) && !INTERACTIVE_ROLES.has(role)) {
      // Include elements with tabindex or onclick
      const tabIndex = el.getAttribute("tabindex");
      const hasClick = (el as HTMLElement).onclick !== null;
      if (!tabIndex && !hasClick) return false;
    }
    if ((el as HTMLInputElement).disabled) return false;
    if (!isVisuallyVisible(el)) return false;
    if (!isOnPage(el)) return false;
    if (!isHitTestable(el)) return false;
    return true;
  }

  function collectDataAttrs(el: Element): Record<string, string> {
    const out: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-")) {
        out[attr.name] = attr.value;
      }
    }
    return out;
  }

  // Walk all elements; filter to interactable ones + semantic landmarks.
  const all = Array.from(document.querySelectorAll("*"));
  const results: Omit<UiElement, "uaipId">[] = [];

  for (const el of all) {
    if (!(el instanceof Element)) continue;
    const role = computeRole(el);
    const interactable = isInteractable(el);

    // Keep interactable + any labelled landmarks we might want to assert on.
    const isLandmark = [
      "heading",
      "navigation",
      "main",
      "dialog",
      "alert",
      "form",
    ].includes(role);

    if (!interactable && !isLandmark) continue;

    const name = accessibleName(el);
    const text = (el.textContent || "").trim().slice(0, 200) || undefined;
    const tag = el.tagName.toLowerCase();

    const attrs = {
      id: el.id || undefined,
      name: el.getAttribute("name") || undefined,
      className: el.className?.toString() || undefined,
      type: el.getAttribute("type") || undefined,
      placeholder: el.getAttribute("placeholder") || undefined,
      value:
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.value || undefined
          : undefined,
      href: el instanceof HTMLAnchorElement ? el.href || undefined : undefined,
      alt: el.getAttribute("alt") || undefined,
      title: el.getAttribute("title") || undefined,
      ariaLabel: el.getAttribute("aria-label") || undefined,
      ariaLabelledBy: el.getAttribute("aria-labelledby") || undefined,
      ariaDescribedBy: el.getAttribute("aria-describedby") || undefined,
      dataAttributes: collectDataAttrs(el),
    };

    results.push({
      tag,
      role: role as AriaRole,
      accessibleName: name,
      text,
      attrs,
      domPath: domPath(el),
      xpath: xpathFor(el),
      box: boundingBoxOf(el),
      interactable,
      siblingIndex: siblingIndexOf(el),
    });
  }

  return results;
}

/** FNV-1a 32-bit hash — tiny, deterministic, no crypto dependency. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function hashElement(
  tag: string,
  role: string,
  name: string | undefined,
  domPath: string,
  ordinal: number,
): string {
  const key = `${tag}|${role}|${name ?? ""}|${domPath}|${ordinal}`;
  return `el_${fnv1a(key)}`;
}
