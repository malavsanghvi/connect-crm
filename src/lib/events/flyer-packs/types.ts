// The shape of a drawn art pack for an occasion every kind of organization may hold (a service, a mixer, a ribbon
// cutting...). Each pack lives in its own file in this folder and is registered in ONE list in ../flyer-art-packs.ts.

/**
 * The colours a pack draws with: the community's brand (primary and secondary) plus the text colour and the paper. Frame
 * accents and key shapes follow these; flames, skies and leaves keep their natural colours.
 */
export type ArtColors = { primary: string; secondary: string; ink: string; paper: string };

export type DrawnPack = {
  /** The occasion key (the catalog's key, e.g. "christmas_eve"). */
  occasion: string;
  /** One line for the picker. */
  blurb: string;
  /** The frame, W x H units (W is 1080; H is 1350, 1398, 1620 or 1920): ornament along the edges, a calm centre. */
  frame: (W: number, H: number, c: ArtColors) => string;
  /** The bottom scene, W x h units (W runs from about 760 on a Story to 1800 on a crowded Post), its sky fading out at the top. */
  scene: (W: number, h: number, c: ArtColors) => string;
  /** The scene's height in units at full size. */
  sceneHeight: number;
  /** Units from the scene's bottom that hold the art: the words stay above them. */
  busy: number;
  /** For an AI scene: transparent above `from`, solid below `to` (fractions of its height). */
  fade: { from: number; to: number };
  /** For an AI frame: the opacity of the soft paper panel behind the words. */
  scrim: number;
  /** Units from the top edge the frame's own ornament hangs down to in the middle: the words start below it. */
  topInset: number;
};
