/**
 * Commerce category rules — product browse, cart, checkout, confirmation.
 *
 * These rules are structural: "grid of items with price-looking text" for
 * product-list, "single item with add-to-cart" for detail, etc. URL patterns
 * are a strong secondary signal for Shopify/WooCommerce/SaaS apps that all
 * converged on the same path conventions.
 */
import type { PageRule } from "./types.js";
import {
  countElements,
  hasAnyText,
  hasButton,
  hasHeading,
  hasInput,
  hasLink,
  urlMatches,
} from "./predicates.js";

const rules: PageRule[] = [
  {
    id: "product-list",
    label: "product-list",
    category: "commerce",
    description: "Multiple product cards with price-looking text.",
    match: (page) => {
      const urlHit = urlMatches(page, /\b(products|inventory|shop|catalog|store)\b/);
      const priceHits = countElements(page, (el) =>
        /[$£€¥]\s?\d|\b\d+\.\d{2}\b/.test((el.text ?? "") + " " + (el.accessibleName ?? "")),
      );
      const addBtns = countElements(page, (el) =>
        (el.role === "button" || el.tag === "button")
        && /add to cart|buy now|add to bag/i.test(el.accessibleName ?? el.text ?? ""),
      );
      if (priceHits >= 3 && (urlHit || addBtns >= 2)) return 0.9;
      if (priceHits >= 3) return 0.75;
      if (urlHit && priceHits >= 1) return 0.6;
      return null;
    },
  },
  {
    id: "product-detail",
    label: "product-detail",
    category: "commerce",
    description: "Single product page: one add-to-cart button + one price.",
    match: (page) => {
      const urlHit = urlMatches(page, /\/(product|item|p)s?\/[^/]+/);
      const addBtn = countElements(page, (el) =>
        (el.role === "button" || el.tag === "button")
        && /add to cart|add to bag|buy now/i.test(el.accessibleName ?? el.text ?? ""),
      );
      if (addBtn === 1 && urlHit) return 0.9;
      if (addBtn === 1) return 0.7;
      return null;
    },
  },
  {
    id: "cart",
    label: "cart",
    category: "commerce",
    description: "Cart page — line items + totals + checkout CTA.",
    match: (page) => {
      const urlHit = urlMatches(page, /\b(cart|basket|bag)\b/);
      const headingHit = hasHeading(page, /(your )?(shopping )?(cart|basket|bag)/);
      const checkoutCTA = hasButton(page, /(check ?out|proceed)/) || hasLink(page, /(check ?out|proceed)/);
      if ((urlHit || headingHit) && checkoutCTA) return 0.92;
      if (urlHit && headingHit) return 0.8;
      if (urlHit) return 0.65;
      return null;
    },
  },
  {
    id: "empty-cart",
    label: "empty-cart",
    category: "commerce",
    description: "Cart page telling the user their cart is empty.",
    match: (page) => {
      const cartCtx = urlMatches(page, /\b(cart|basket|bag)\b/)
        || hasHeading(page, /(cart|basket|bag)/);
      const empty = hasAnyText(page, /(cart is empty|nothing in (your )?(cart|bag|basket))/);
      if (cartCtx && empty) return 0.95;
      return null;
    },
  },
  {
    id: "checkout-address",
    label: "checkout-address",
    category: "commerce",
    description: "Shipping / billing address form.",
    match: (page) => {
      const urlHit = urlMatches(page, /check ?out|shipping|delivery|address/);
      const addrInputs =
        +hasInput(page, { nameLike: /(address|street|addr)/ })
        + +hasInput(page, { nameLike: /(zip|postal|postcode)/ })
        + +hasInput(page, { nameLike: /(city|town)/ })
        + +hasInput(page, { nameLike: /(state|province|region|country)/ });
      if (addrInputs >= 3) return 0.9;
      if (addrInputs >= 2 && urlHit) return 0.78;
      return null;
    },
  },
  {
    id: "checkout-payment",
    label: "checkout-payment",
    category: "commerce",
    description: "Card number / expiry / CVV form.",
    match: (page) => {
      const cardLike =
        hasInput(page, { nameLike: /(card.?number|cc.?num|pan)/ })
        || hasInput(page, { placeholderLike: /card number|4242 4242/ })
        || hasInput(page, { ariaLabelLike: /card number/ });
      const expLike = hasInput(page, { nameLike: /(exp|expiry|expiration)/ })
        || hasInput(page, { placeholderLike: /mm\s?\/\s?yy/ });
      const cvvLike = hasInput(page, { nameLike: /(cvv|cvc|cid|security)/ });
      const urlHit = urlMatches(page, /\b(payment|pay|billing|checkout)\b/);
      const signals = +cardLike + +expLike + +cvvLike;
      if (signals >= 2 && urlHit) return 0.95;
      if (signals >= 2) return 0.85;
      if (signals === 1 && urlHit) return 0.65;
      return null;
    },
  },
  {
    id: "order-confirm",
    label: "order-confirm",
    category: "commerce",
    description: "Thank-you / order-complete page.",
    match: (page) => {
      const urlHit = urlMatches(page, /\b(order|thank-?you|confirmation|complete|success)\b/);
      const headingHit = hasHeading(page, /(thank you|order (placed|complete|confirmed)|success)/);
      const orderNum = hasAnyText(page, /order\s*#?\s*\d{3,}/);
      if (headingHit && (orderNum || urlHit)) return 0.92;
      if (headingHit) return 0.75;
      return null;
    },
  },
];

export default rules;
