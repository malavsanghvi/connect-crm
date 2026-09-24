# JSH platform handoff kit

1. Unzip this folder into your Claude Code project (or open it as the project).
2. Start Claude Code in the folder; it reads `CLAUDE.md` automatically.
3. Run the prototypes: `npx serve prototypes/site` (then open the printed URL).
4. Deploy to Netlify from your machine: `npx netlify-cli login` once, then
   `npx netlify-cli deploy --dir prototypes/site --prod --site c2f043f9-3043-4713-9869-dec78ee40bac`
5. Bring over the written work:
   - Recommendations doc: open https://claude.ai/code/artifact/338356dc-8bc9-4cbf-9c06-7040f443f72a, export each tab as Markdown, save into `docs/`.
   - Original conversation: claude.ai › Settings › Privacy › Export data (emails you a download with your conversations as JSON); put the JSH conversation file in `docs/conversation/`.
