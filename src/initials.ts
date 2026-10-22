// The letter on a person's avatar circle: the first grapheme that is a letter,
// in upper case; "" when the name has none (the circle stays empty). Same as
// nameInitial in supabase/functions/_shared/meeting-list.ts —
// tests/meeting-list.test.ts keeps them equal.
let segmenter: Intl.Segmenter | null | undefined;

/** Graphemes of a text; code points where Intl.Segmenter is missing (iOS < 14.5). */
function graphemesOf(text: string): string[] {
  if (segmenter === undefined)
    segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
}

export function nameInitial(name: string): string {
  for (const segment of graphemesOf(name.normalize("NFC"))) {
    if (/\p{L}/u.test(segment)) return segment.toUpperCase();
  }
  return "";
}
