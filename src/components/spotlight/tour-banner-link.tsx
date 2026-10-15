"use client";

import { SPOTLIGHT_TEXT as T } from "@/lib/spotlight/copy";

import { useSpotlight } from "./spotlight-provider";

/**
 * "Take the tour" in the demo banner, for a demo person who has a tour (the treasurer today); nothing for anyone else, and nothing
 * when the person turned tours off. It starts the person's first tour. The hit area is 44px tall without making the slim banner taller.
 */
export function TourBannerLink() {
  const spotlight = useSpotlight();
  const first = spotlight.tours[0];
  // It waits until this browser's memory has been read (so it never flashes for a person who turned tours off), and stays while a tour
  // runs (starting one again does nothing), so focus can return to it when the tour closes.
  if (!first || !spotlight.loaded || spotlight.toursOff) return null;
  return (
    <>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={() => spotlight.start(first.id)}
        data-testid="demo-banner-tour"
        className="-my-3.5 inline-flex min-h-[44px] items-center font-bold underline underline-offset-2"
      >
        {T.bannerLink}
      </button>
    </>
  );
}
