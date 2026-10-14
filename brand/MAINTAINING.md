# Keeping the brand kit current

`brand/` is the Weaver brand kit: the brand book (`README.md`), the design tokens (`tokens.json`, and the same values as CSS
variables in `weaver-tokens.css`), the logo files, the 21 website icons and the guides for the logo, button and AI tag. It is
the reference every Weaver surface follows: the public website today, the staff portal and the member app as they move onto
it (backlog B81).

- **Where the values come from.** The website's look lives in `src/app/site/site.css` (colours and faces inside `.site-root`),
  `src/components/site/ui.tsx` (buttons) and `src/components/site/header.tsx` (the logo lockup). A change there is a change
  to the brand: make the same change in `tokens.json` and `weaver-tokens.css` in the same pull request.
- **The mark.** `logos/weaver-mark.svg` is a copy of `src/app/icon.svg`. After any change to the mark, copy it here and run
  `node scripts/brand-logo-pngs.mjs` from the repository root: it redraws every PNG in `brand/logos/` and the downloads in
  `public/brand/` (it fetches the two faces from Google Fonts, so it needs the internet).
- **The icons.** `icons/*.svg` are drawn from `src/components/site/icons.tsx` in `navy`. Add a new icon in both places.
- **The words.** The lines in the brand book's Voice section are the owner's, word for word. Change them only on the owner's
  say-so, and change the website's copy with them.
- **The previews.** `cover.html` and `components/*/preview.html` open in a browser straight from this folder; they read
  `weaver-tokens.css` and the files in `logos/`.

The same kit is published as a browsable brand book (a private Claude artifact, "Weaver Brand Kit") and as a public page at
www.weaverams.org/brand.
