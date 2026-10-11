// Words that surround names in many cultures: honorifics, family words, particles and relationship words. All entries are
// lower-case and already folded (no accents; "señor" is "senor"). Pure data, no dependencies.
//
// How they are used (see resolve/names.ts):
//   * TITLES are dropped wherever they stand; PREFIX_TITLES only in front of a name, and only when a name follows.
//   * CREDENTIALS are dropped after a name ("Rahul Shah, MD").
//   * FAMILY_WORDS mark a household-style name ("Familia Garcia", "Shah Parivar"); they are not part of any name.
//   * PARTICLES belong to the family name that follows them ("al-Farsi", "van der Berg", "de la Cruz", "McDonald"): they
//     are glued to it, never read as a second family name or a maiden name.
//   * NOT_A_NAME are the words that come in brackets after a name and are not a maiden name or nickname ("Mira (wife)").

import { table } from "./fold";

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

/** Titles that are never a name, in front of or after it: English, Spanish/Portuguese, French, German, Italian, South Asian, Arabic. */
export const TITLES = words(`
  mr mrs ms miss mx dr prof professor rev reverend madam madame
  capt captain col adv
  shri shree sri sree srimathi shrimati smt kum pt pandit sh swami acharya selvi thiru thirumathi tmt

  sra srta senor senora senorita dna lic licenciado arq profa
  mme mlle melle monsieur mademoiselle abbe
  sig signor signore signora signorina dott dottore dottoressa avv geom
  hrn
  ustaz ustadh maulana mawlana mufti hafiz hjh hj
`);

/** Titles that are also names or surnames somewhere ("Sir", "Don", "Rav", "Haji"): dropped only in front of a name. */
export const PREFIX_TITLES = words(`
  sir sheikh shaikh shaykh sheikha shaikha imam haji hajji hajja hajjah rabbi rav reb harav hazzan cantor
  herr frau fraulein dipl mag judge
  fr father
`);

/** Credentials and professional suffixes: "Rahul Shah, MD". */
export const CREDENTIALS = words(`md phd cpa esq dds rn mba dvm pe dmd dpt jd llb llm msc bsc mphil pmp cfa cfp`);

/** Jr / Sr and friends. */
export const GENERATIONS: Record<string, "jr" | "sr" | "ii" | "iii" | "iv"> = table({
  jr: "jr", jnr: "jr", junior: "jr", filho: "jr", fils: "jr",
  sr: "sr", snr: "sr", senior: "sr",
  ii: "ii", "2nd": "ii", iii: "iii", "3rd": "iii", iv: "iv", "4th": "iv",
});

/** A child's title. */
export const MINOR_TITLES = words(`master baby`);

/** "Smith Family", "Familia Garcia", "Famille Dubois", "Familie Muller", "Famiglia Rossi", "Shah Parivar", "Rodzina Nowak". */
export const FAMILY_WORDS = words(`
  family families household residence fam hh
  familia familias hogar
  famille foyer menage
  familie haushalt gezin
  famiglia
  parivar pariwar
  rodzina semya semja
  aile ailesi
  ahl usra usrat aal mishpacha mishpachat
  jiating
`);

/** Native-script family words: the surrounding text may be Arabic, Hebrew, Devanagari, Gujarati, Cyrillic, Han, Hangul. */
export const FAMILY_WORDS_NATIVE = words(`
  عائله اسره
  משפחת משפחה
  परिवार પરિવાર
  семья семя родина
  家庭 一家
  가족
`);

/** Words in brackets, or after a name, that say who someone is to the person who typed the row. Not a name. */
export const NOT_A_NAME = words(`
  wife husband spouse partner mother father mom dad mum son daughter child sister brother uncle aunt cousin friend grandfather grandmother
  home work cell mobile office business personal primary secondary main alt late deceased jr sr
  esposa esposo madre padre hijo hija casa trabajo celular movil
  marido mae pai filho filha
  epouse epoux femme mari mere pere fils fille
  ehefrau ehemann mutter vater sohn tochter
  moglie marito madre padre figlio figlia
  zawja zawj walida walid
  patni pati biwi shohar beta beti ma baap pita mata dada dadi nana nani
  isha ish eshet ishti ishto baali ima aba
  tsuma otto haha chichi musuko musume qizi zhangfu erzi nuer anae nampyeon eomma appa adeul ttal
`);

/** Honorific suffixes that are only ever honorifics: after a given name, or after a hyphen, they are not part of it. */
export const SUFFIX_ALWAYS = words(`bhai bhaii bhaai`);
/**
 * Honorific suffixes that are also letters of other names (Korean "Min-ji", Hebrew "Ben", Hindi "Bhi"). They are an honorific
 * only when the name shows South Asian context: a family name common there, a title like Shri or Smt, or Indic script.
 */
export const SUFFIX_SOUTH_ASIAN = words(`ben behn bahen bein baen bhi ji kumar kumari`);
/** Japanese and Korean courtesy words attached with a hyphen: "Tanaka-san", "Kim-ssi". */
export const HYPHEN_COURTESY = words(`san sama sensei ssi`);
/** Titles that show a South Asian name. */
export const SOUTH_ASIAN_TITLES = words(`shri shree sri sree srimathi shrimati smt kum pt pandit sh selvi thiru thirumathi tmt`);
/** Chinese and Korean courtesy words after a name: "Wang Xiansheng", "Kim Ssi". */
export const COURTESY_AFTER = words(`xiansheng taitai xiaojie furen laoshi nushi sama sensei ssi nim`);

/** Suffix words that are glued to the front of the name that follows them (Arabic "Abdul Rahman", "Abu Bakr", "Umm Kulthum"). */
export const NAME_PREFIX_GLUE = words(`abu umm abd abdul abdel abdal abdu abdur abdus abdoul abdou`);

/** Words that start a family name and belong with it. */
export const PARTICLES = words(`
  al el ul ell
  ibn bin bint binti bat
  van von der den de da di du del della delle dei degli dos das do des la le lo los las
  mac mc ter ten te op zu zur zum vom
`);

/** The Arabic article and its spoken forms. */
export const ARABIC_ARTICLES = words(`al el ul ell`);
/** The article as it is written before a "sun letter" ("ar-Rahman", "ash-Shamsi"): the letters the next word must start with. */
export const SUN_ARTICLES: Readonly<Record<string, string>> = table({ as: "s", ar: "r", an: "n", ad: "d", at: "t", az: "z", ash: "sh", adh: "dh", ath: "th" });

/** Vietnamese family names: "Van" and "Thi" after one of these are middle names, not particles. */
export const VIETNAMESE_FAMILY = words(`nguyen tran le pham hoang huynh phan vu vo dang bui do ho ngo duong ly`);

/** Words that follow "Ben" when it is the Hebrew "son of" and not the Gujarati honorific ("David Ben Gurion"). */
export const HEBREW_AFTER_BEN = words(`
  gurion david yosef moshe shimon zion yehuda haim ami israel ezra avraham yaakov ari oz tzvi meir nun asher shlomo levi natan
  eliezer yitzhak baruch hur zvi shabbat gal amram shushan
`);

/** Common family names in South Asia: the context that makes an attached -ben, -ji or -kumar an honorific and not part of a name. */
export const SOUTH_ASIAN_SURNAMES = words(`
  patel shah mehta desai doshi sanghvi sanghavi parekh gandhi trivedi thakkar thakker kothari jain vora vohra modi joshi bhatt chokshi
  choksi kapadia kapadiya zaveri amin shroff gala dedhia shethia nagda vakil vaidya pandya pandit dave dholakia dalal contractor master
  sheth seth mistry parmar solanki rathod chauhan rajput thakur makwana chavda vaghela jadeja zala gohil sisodia bhavsar prajapati
  panchal soni sonara luhar suthar darji lakhani kanani kakadiya ghelani savani moradiya vasani hirani rupani chotai bhanushali
  mody golwala modh jani vyas upadhyay pathak dixit purohit acharya adhvaryu oza raval bhatia lohana thakrar
  sharma verma gupta agarwal aggarwal agrawal singh kumar yadav mishra tiwari tripathi pandey dubey dwivedi shukla srivastava saxena
  kapoor kapur khanna malhotra chopra bhatia arora sethi sahni anand bajaj bansal goel goyal jindal mittal garg mahajan khurana
  banerjee mukherjee chatterjee ganguly bose ghosh dutta das roy sen sengupta chakraborty bhattacharya mondal majumdar biswas
  iyer iyengar nair menon pillai reddy naidu rao shetty hegde bhat kamath pai prabhu kulkarni deshpande deshmukh patil pawar jadhav
  kadam shinde more gaikwad kale chavan salvi sawant naik gawde
  sidhu sandhu gill dhillon brar grewal bedi sodhi kaur khalsa
  khan ahmed ahmad hussain hussein hasan hassan ali shaikh sheikh sayyed syed ansari qureshi siddiqui mirza malik chaudhry
  chaudhary choudhury chowdhury rahman begum akhtar iqbal butt bhatti rana raja
  fernandes dsouza dcosta pereira gomes rodrigues
`);

export function isWord(set: Set<string>, w: string): boolean {
  return set.has(w);
}
