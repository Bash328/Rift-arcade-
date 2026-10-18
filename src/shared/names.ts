// Player names are the only text players can send each other, so every name goes
// through here on the server before it is stored or shown.

/** Shown instead of a name that is empty or not allowed. */
export const FALLBACK_NAME = "Player";
const MAX_NAME = 12;

/**
 * Stems matched anywhere in the name after lowercasing, undoing look-alike
 * characters (1->i, 0->o, $->s ...) and dropping everything that isn't a letter.
 * ponytail: a list of profanity, sexual terms and slurs, not a moderation system. Because it matches inside a
 * name, a stem short enough to sit inside ordinary words is left out on purpose ("ass", "cum", "anus", "spic", "wank").
 * Extend it as reports come in; it cannot catch a misspelling that drops or swaps letters.
 */
const BLOCKED = ["fuck", "shit", "bitch", "cunt", "dick", "cock", "pussy", "whore", "slut", "rape", "nazi", "hitler", "porn", "penis", "vagina", "asshole", "bastard", "kkk",
  // slurs
  "nigger", "nigga", "faggot", "fagot", "retard", "tranny", "chink", "kike", "wetback", "beaner", "towelhead",
  // sexual and abuse
  "jizz", "blowjob", "handjob", "cumshot", "dildo", "twat", "wanker", "bukkake", "hentai", "molest", "pedophile", "paedophile", "incest"];

const LOOKALIKE: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "|": "i" };

/** A name safe to store: normalised, free of invisible and direction-changing characters, at most 12 long. */
export function sanitizeName(raw: unknown): string {
  const name = String(raw ?? "")
    .normalize("NFKC")
    // control characters, zero-width and left-to-right/right-to-left marks and overrides
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME)
    .trim();
  if (!name) { return FALLBACK_NAME; }
  const letters = name.toLowerCase().replace(/[013457@$!|8]/g, (c) => LOOKALIKE[c]).replace(/[^a-z]/g, "");
  return BLOCKED.some((word) => letters.includes(word)) ? FALLBACK_NAME : name;
}
