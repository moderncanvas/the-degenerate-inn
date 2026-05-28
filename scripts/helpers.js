/**
 * helpers.js — Handlebars template helpers used in table.hbs
 *
 * Foundry doesn't ship all the helpers we need out of the box,
 * so we register a small set here.
 */

export function registerHandlebarsHelpers() {
  // Equality check: {{#if (eq a b)}}
  Handlebars.registerHelper("eq", (a, b) => a === b);

  // Less-than: {{#if (lt a b)}}
  Handlebars.registerHelper("lt", (a, b) => a < b);

  // Greater-than: {{#if (gt a b)}}
  Handlebars.registerHelper("gt", (a, b) => a > b);

  // Logical AND: {{#if (and a b)}}
  Handlebars.registerHelper("and", (a, b) => Boolean(a) && Boolean(b));

  // Logical OR: {{#if (or a b)}}
  Handlebars.registerHelper("or", (a, b) => Boolean(a) || Boolean(b));

  // Logical NOT: {{#if (not a)}}
  Handlebars.registerHelper("not", a => !a);

  // Array length: {{length array}}
  Handlebars.registerHelper("length", arr => Array.isArray(arr) ? arr.length : 0);

  // Subtraction: {{subtract 5 (length communityCards)}}
  Handlebars.registerHelper("subtract", (a, b) => Math.max(0, (a ?? 0) - (b ?? 0)));

  // Addition: {{add a b}}
  Handlebars.registerHelper("add", (a, b) => (a ?? 0) + (b ?? 0));

  // Repeat N times block helper: {{#times 3}}...{{/times}}
  Handlebars.registerHelper("times", function(n, options) {
    let result = "";
    for (let i = 0; i < n; i++) {
      result += options.fn(i);
    }
    return result;
  });

  // Format a number with commas
  Handlebars.registerHelper("formatNumber", n => (n ?? 0).toLocaleString());
}
