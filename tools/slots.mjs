// Minimal slot filler: LITERAL string replacement (no regex), so app payloads
// containing $, {{ }}, backticks, or HTML-comment-like text are never mangled.
export function fillSlots(template, slots) {
  let out = template;
  for (const [marker, value] of Object.entries(slots)) {
    out = out.split(marker).join(value);
  }
  return out;
}
