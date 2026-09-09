import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const USERNAME_WORDS_PATH = join(
  process.cwd(),
  "resources",
  "username-suggestion-words.txt",
);
const WORD_PATTERN = /^[a-z]+$/;
const SUFFIX_COMBINATIONS = 10_000;

export interface UsernameSuggestionVocabulary {
  adjectives: readonly string[];
  nouns: readonly string[];
}

export function parseUsernameSuggestionVocabulary(
  source: string,
): UsernameSuggestionVocabulary {
  const words = {
    adjectives: new Set<string>(),
    nouns: new Set<string>(),
  };
  let section: keyof typeof words | undefined;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line === "[adjectives]" || line === "[nouns]") {
      section = line.slice(1, -1) as keyof typeof words;
      continue;
    }

    if (!section) {
      throw new Error(
        "Username vocabulary words must follow a section header.",
      );
    }

    if (!WORD_PATTERN.test(line)) {
      throw new Error(`Invalid username vocabulary word: ${line}`);
    }

    if (words[section].has(line)) {
      throw new Error(`Duplicate username vocabulary word: ${line}`);
    }

    words[section].add(line);
  }

  if (words.adjectives.size === 0 || words.nouns.size === 0) {
    throw new Error("Username vocabulary must contain adjectives and nouns.");
  }

  return {
    adjectives: [...words.adjectives],
    nouns: [...words.nouns],
  };
}

const vocabulary = parseUsernameSuggestionVocabulary(
  readFileSync(USERNAME_WORDS_PATH, "utf8"),
);

export const USERNAME_SUGGESTION_COMBINATION_COUNT =
  vocabulary.adjectives.length * vocabulary.nouns.length * SUFFIX_COMBINATIONS;

export type UsernameSuggestionCandidateFactory = () => string;

/** Builds a non-identifying username that already satisfies the public format. */
export function createRandomUsernameSuggestion(): string {
  const adjective =
    vocabulary.adjectives[randomInt(vocabulary.adjectives.length)]!;
  const noun = vocabulary.nouns[randomInt(vocabulary.nouns.length)]!;
  const suffix = randomInt(SUFFIX_COMBINATIONS).toString().padStart(4, "0");

  return `${adjective}-${noun}-${suffix}`;
}
