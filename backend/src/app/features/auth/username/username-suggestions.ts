import { randomInt } from "node:crypto";

const ADJECTIVES = [
  "bright",
  "calm",
  "clever",
  "cosmic",
  "crisp",
  "curious",
  "daring",
  "gentle",
  "golden",
  "happy",
  "jolly",
  "kind",
  "lively",
  "lucky",
  "merry",
  "mighty",
  "nimble",
  "peaceful",
  "playful",
  "quick",
  "radiant",
  "ready",
  "steady",
  "sunny",
  "swift",
  "vivid",
  "warm",
  "wise",
] as const;

const NOUNS = [
  "badger",
  "beacon",
  "cedar",
  "comet",
  "dolphin",
  "falcon",
  "forest",
  "fox",
  "harbor",
  "heron",
  "island",
  "juniper",
  "lantern",
  "maple",
  "meadow",
  "otter",
  "owl",
  "panda",
  "pebble",
  "pine",
  "quartz",
  "river",
  "robin",
  "sparrow",
  "summit",
  "tiger",
  "willow",
  "wren",
] as const;

export type UsernameSuggestionCandidateFactory = () => string;

/** Builds a non-identifying username that already satisfies the public format. */
export function createRandomUsernameSuggestion(): string {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
  const noun = NOUNS[randomInt(NOUNS.length)]!;
  const suffix = randomInt(10_000).toString().padStart(4, "0");

  return `${adjective}-${noun}-${suffix}`;
}
