// English words that are also given names (Will, Hope, Chase, May, An, My ...). A child with such a name is matched only where the
// word is written with a capital letter (a name) or stands beside another word of the child's name, never inside a longer word
// ("purchase") or in plain lower case ("I will come"). The list is deliberately long: a name missing from it is matched everywhere,
// which is the safe side. Lower case, folded (no accents). Pure data.

const WORDS =
  // function words and very short words
  "a an as at be by do go he if in is it me my no of on or so to up us we am ah oh ok hi id ma pa ha la lo mo yo ye " +
  "all and any are bay big bud can day dew dot eve fay fox gay hap ice ivy jay jet joy key kit lee lou may mid nan " +
  "pat ray red rex rob roy rue sam sky sol son sue sun tan ted tim tip tom van wes won zip " +
  // words that are names
  "will hope chase grace faith joy pearl ruby jade iris lily daisy rose violet willow holly hazel olive cherry ginger candy " +
  "amber crystal summer autumn winter spring april june august dawn dale glen lane page reed rich mark miles grant frank " +
  "hunter forest river lake brook field stone wood heath heather fern flora bella belle blair blake brook cliff dean drew " +
  "earl else ever gene guy hall hank jack jean jerry kay king kirk lance lee leigh lord love major mercy merry mike mimi " +
  "nick noble pace paris park patience peace penny pepper poppy precious prince princess queen quinn rain randy ranger " +
  "raven reign rich robin rocky rory rowan royal rusty sage sandy scout sean shay shine shy sierra skye sonny star stella " +
  "storm sunny sunshine tiger tony trace trust tyler unity valentine victory vine warren wayne wendy wilder wiley wish " +
  "honor honour justice liberty lucky happy harmony melody trinity destiny charity journey phoenix sterling bishop " +
  "baron baker butler carter chance charm clark cook cooper day duke fisher fox gold green hill jordan lee long miller " +
  "moore north parker price rich rider rivers sharp smart smith strong sweet taylor wise young bill bob art ace ash bay " +
  "bud cash chip clay cole cruz deb don dot ed fay gail gale gray guy hal ian jim jo ken kim lou max mel nat ned pam rex " +
  "ron sal stan sue ted tess tom van vic wes zane about above after again alone along among angel apple beach beauty " +
  "begin black blue bright brown calm clear close cloud clever comfort dear deep dream early easy faith fancy fine fire " +
  "first fresh gift glad glory good great happy heart heaven hero holy home honey infant jewel jolly joyce keen kind lady " +
  "light little lively lovely loyal magic major merit mighty mild moon morning music noble ocean order pretty pride proud " +
  "pure quick quiet rare ready rich rising royal sacred safe saint shiny silver simple smile smooth soft sound sparkle " +
  "special spirit steady sunday sunrise sweet swift tender thank thanks tomorrow truth twin vivid warm wonder world young " +
  "bell bond dane dell ford gray hart kane lamb link lord marsh mason nash pike pyle rand reid ross rush shaw slate " +
  "steel stew swan tate vale vance ward webb west wolf wynn york";

export const COMMON_WORDS: ReadonlySet<string> = new Set(WORDS.split(/\s+/).filter(Boolean));
