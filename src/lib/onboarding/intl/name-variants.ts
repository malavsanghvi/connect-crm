// Name variants across cultures. Pure data plus three lookups, no dependencies.
//
// Two strengths, because they are different claims:
//   * SPELLING groups are one name written several ways (Muhammad / Mohammed / Mohamed, Sergey / Sergei, Choudhury /
//     Chowdhury, Hoffmann / Hofmann). Two names in one group compare as the SAME name ("variant").
//   * EQUIVALENT groups are the same name in another language or romanisation (Yusuf / Joseph, Juan / John,
//     Zhang / Cheung / Chang). That is only a hint, so it is a WEAK signal: it never makes two names "the same".
// Neither one ever joins two records on its own: a name is supporting evidence, never an identifier.
//
// Every word is lower-case and already folded (no accents). The first word of a group is its canonical spelling.

import { table } from "./fold";

function indexGroups(groups: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups) {
    const list = g.split(/\s+/).filter(Boolean);
    const head = list[0];
    if (!head) continue;
    for (const w of list) if (!out.has(w)) out.set(w, head);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spelling variants (strong). Given names and family names share the table: a spelling is a spelling.
// ---------------------------------------------------------------------------

const SPELLING_GROUPS: readonly string[] = [
  // Arabic and Muslim names, in the Latin spellings people really use.
  "muhammad mohammad mohammed mohamed muhammed mohamad muhamad mohd muhd mohammud mahomed muhamed mohamet mohmmed mohamd muhamet",
  "ahmed ahmad ahmet ahmat ahmid ehmed",
  "ali aly",
  "omar umar oumar omer umer",
  "usman othman osman uthman othmane utman",
  "hasan hassan hasen",
  "hussein hussain husain hosein hossein hossain hussin husein husayn husaen",
  "ibrahim ebrahim ibraheem ibrahem brahim ibrahima",
  "ismail ismael esmail ismaeel ismayil ismaiel",
  "yusuf yousef youssef yusef yousuf yussuf yousif yousuf youssouf yusufu",
  "mustafa moustafa mostafa mustapha mostapha mustafah",
  "mahmoud mahmud mahmood mehmood mahmoed",
  "abdullah abdallah abdulla abdulah abdalla abdellah",
  "khalid khaled khalyd khalede",
  "said saeed saied sayeed saeid saaid",
  "zaid zayd zeid zaied",
  "tariq tarik tareq tarek tarique",
  "karim kareem karime",
  "salim saleem selim saleim",
  "samir sameer samer",
  "waleed walid walied",
  "hamid hameed",
  "majid majeed",
  "rashid rasheed rashed",
  "nasser naser nasar",
  "jamal gamal jamaal",
  "bilal belal billal",
  "hamza hamzah hamzeh",
  "idris idriss edris",
  "nour noor nur nuur",
  "rahim raheem",
  "rahman rehman rahmaan",
  "hakim hakeem",
  "amin ameen amine",
  "fatima fatimah fatema fatma fatmah fatimeh fatemeh",
  "aisha aysha ayesha aiesha aicha ayisha aishah",
  "khadija khadijah khadeeja khadidja khadiga hadija",
  "zainab zaynab zeinab zaineb zenab zaynep",
  "maryam mariam meryem maryem mariyam",
  "layla leila laila lailah leyla",
  "yasmin yasmine yasmeen yazmin yasmina",
  "mohsin muhsin",
  "tahir taher",
  "shahid shaheed",
  "imran emran",
  "irfan erfan",
  "junaid junaed junaid",
  "faisal faysal feisal fayssal",
  "fahad fahd fahed",
  "nabil nabeel",
  "adil adel adeel",
  "hisham hesham",
  "osama usama oussama",
  "haroon harun haroun",
  "ayub ayyub ayoub eyub",
  "dawood daoud dawud dawoud",
  "sulaiman sulayman suleiman suleman soliman",
  "musa mousa moussa",
  "isa eisa issa essa",
  "syed sayed saiyed sayyid sayyed seyed",
  "sheikh shaikh shaykh sheik",
  "chowdhury choudhury chaudhary chaudhry choudhry chowdhry",
  "siddiqui siddiqi siddiki",
  "qureshi quraishi kureshi koreshi",
  // South Asian family names with several Latin spellings.
  "sharma sarma",
  "agarwal aggarwal agrawal agarwala aggrawal agarawal",
  "banerjee bannerjee banerji bandyopadhyay bandopadhyay banerjea",
  "chatterjee chatterji chattopadhyay chaterjee chatterjea",
  "mukherjee mukerjee mukherji mukhopadhyay mukhopadhaya",
  "ganguly ganguli gangopadhyay gangully",
  "iyer iyyer ayyar aiyar",
  "iyengar aiyangar ayyangar",
  "nair nayar",
  "reddy reddi raddy",
  "naidu nayudu",
  "pillai pilai pillay pillei",
  "shetty shetti setty",
  "subramanian subramaniam subramanyam subrahmanyam subramaniyan",
  "krishnamurthy krishnamoorthy krishnamurti",
  "srinivasan sreenivasan srinivasa",
  "singh sing",
  "kaur kour caur",
  "dhillon dhilon",
  // Slavic: transliterations of the same name.
  "sergey sergei sergej serhiy serhii sergii sergiy",
  "alexander aleksander alexandr aleksandr oleksandr",
  "dmitri dmitry dmitriy dmitrij dimitri dimitry",
  "nikolai nikolay nikolaj nicolay",
  "vladimir wladimir vladimer",
  "yuri yury yuriy yurii iurii jurij juri",
  "andrei andrey andrej",
  "mikhail mikhael mihail michail mikail",
  "evgeny evgeniy yevgeny yevgeniy jevgeni",
  "ivan iwan",
  "tatiana tatyana tatjana tetiana",
  "elena yelena jelena",
  "natalia nataliya natalya natalja",
  "irina iryna",
  "svetlana svitlana",
  "ludmila lyudmila ludmilla liudmila lyudmyla",
  "anastasia anastasiya anastasija anastasiia",
  "ekaterina yekaterina jekaterina",
  "sofia sophia sofiya sofija",
  "stanislaw stanislav",
  "ivanov ivanoff ivanow ivanof",
  "petrov petroff petrow",
  "smirnov smirnoff smirnow",
  "kuznetsov kuznetsoff kuznecov kuznetzov",
  "popov popoff",
  "sokolov sokoloff",
  "volkov volkoff",
  "novak nowak",
  "kowalski kovalski kowalsky kovalsky",
  "horvat horvath",
  "papadopoulos papadopulos papadopoulou",
  // German, Dutch and French spellings.
  "schmidt schmitt schmid",
  "meyer meier mayer maier meijer",
  "hoffmann hofmann hoffman",
  "schulz schultz schulze",
  "zimmermann zimmerman",
  "hartmann hartman",
  "lehmann lehman",
  "neumann neuman",
  "klein kline",
  "wolf wolff wulf",
  "weber webber",
  // Spanish and Portuguese: -z and -s endings are the same family name.
  "gonzalez gonzales gonsalez",
  "rodriguez rodrigues",
  "perez peres",
  "garcia garsia",
  "lopez lopes",
  "gomez gomes",
  "sanchez sanches",
  "diaz dias",
  "vasquez vazquez",
  "jimenez ximenez gimenez",
  "ruiz ruis",
  "alvarez alvares",
  "mendez mendes",
  "ramirez ramires",
  "torres torrez",
  "flores florez",
  "francisco fransisco",
  "luis luiz",
  // Hebrew.
  "cohen kohen cohan",
  "levi levy",
  "shapiro shapira schapiro",
  "friedman freedman friedmann",
  "goldberg goldburg",
  "rosenberg rosenburg",
  "weiss weis weisz",
  "yitzhak itzhak yitzchak",
  "moshe moishe",
  "avraham avrohom",
  "yaakov yacov yakov",
  // English.
  "katherine catherine kathryn katharine katherin kathrine cathryn catharine",
  "stephen steven",
  "jeffrey geoffrey jeffery jeffry",
  "sean shawn shaun shon",
  "brian bryan",
  "philip phillip",
  "eric erik",
  "mark marc",
  "allan alan allen",
  "anne ann",
  "sara sarah",
  "rebecca rebekah rebeca",
  "michael micheal",
  "jonathan jonathon",
  "matthew mathew",
  "zachary zachariah zackary zakary",
  "isaac issac isaak",
  "teresa theresa tereza",
  "elizabeth elisabeth",
  "michelle michele",
  "jennifer jenifer",
  "smith smyth smythe",
  // Japanese long vowels written three ways.
  "sato satoh satou",
  "ito itoh itou itoo",
  "kondo kondoh kondou",
  "saito saitoh saitou",
  "goto gotoh gotou",
  "ono ohno oono",
  "kato katoh katou",
  "ota ohta oota",
  "yuki yuuki",
];

const SPELLING = indexGroups(SPELLING_GROUPS);

const SPELLING_MEMBERS = new Map<string, string[]>();
for (const g of SPELLING_GROUPS) {
  const list = g.split(/\s+/).filter(Boolean);
  const head = list[0];
  if (!head) continue;
  const id = SPELLING.get(head) ?? head;
  const members = SPELLING_MEMBERS.get(id) ?? [];
  for (const w of list) if (!members.includes(w)) members.push(w);
  SPELLING_MEMBERS.set(id, members);
}

/** Every spelling of a name that has spelling variants (Muhammad: Mohammed, Mohamed ...), the word itself first; just the word otherwise. */
export function spellingVariantsOf(word: string): readonly string[] {
  const members = SPELLING_MEMBERS.get(SPELLING.get(word) ?? "");
  return members ? [word, ...members.filter((w) => w !== word)] : [word];
}

/** The canonical spelling of a name that has spelling variants (Mohammed -> muhammad); the word itself otherwise. */
export function spellingCanonical(word: string): string {
  return SPELLING.get(word) ?? word;
}

// ---------------------------------------------------------------------------
// Nicknames and short forms (strong, like the existing English list), in several languages.
// ---------------------------------------------------------------------------

export const NICKNAMES: Readonly<Record<string, string>> = table({
  // English
  mike: "michael", mick: "michael", bob: "robert", rob: "robert", bobby: "robert", bill: "william", will: "william", billy: "william",
  jim: "james", jimmy: "james", joe: "joseph", joey: "joseph", dave: "david", dan: "daniel", danny: "daniel", tom: "thomas", tommy: "thomas",
  steve: "steven", chris: "christopher", nick: "nicholas", matt: "matthew", andy: "andrew", tony: "anthony", rick: "richard",
  dick: "richard", rich: "richard", jeff: "jeffrey", greg: "gregory", ken: "kenneth", ed: "edward", eddie: "edward", sam: "samuel",
  liz: "elizabeth", beth: "elizabeth", betty: "elizabeth", kate: "katherine", katie: "katherine", kathy: "katherine", cathy: "catherine",
  sue: "susan", susie: "susan", jen: "jennifer", jenny: "jennifer", pat: "patricia", patty: "patricia", peggy: "margaret", maggie: "margaret",
  meg: "margaret", becky: "rebecca", debbie: "deborah", deb: "deborah", vicky: "victoria",
  jack: "john", johnny: "john", hank: "henry", larry: "lawrence", gene: "eugene", fred: "frederick", tim: "timothy", ron: "ronald",
  chuck: "charles", charlie: "charles", abby: "abigail", cindy: "cynthia", nate: "nathan", zach: "zachary", zack: "zachary", josh: "joshua",
  sally: "sarah", dottie: "dorothy", pete: "peter",
  // Spanish and Portuguese
  pepe: "jose", paco: "francisco", pancho: "francisco", quico: "francisco", lupe: "guadalupe", chuy: "jesus", manolo: "manuel",
  nacho: "ignacio", memo: "guillermo", lola: "dolores", concha: "concepcion", pili: "pilar", charo: "rosario", tere: "teresa", pepa: "josefa",
  juanito: "juan", chema: "josemaria", tono: "antonio", rafa: "rafael", fran: "francisco", edu: "eduardo", gabi: "gabriela",
  // Italian
  gianni: "giovanni", beppe: "giuseppe", peppe: "giuseppe", franco: "francesco", gigi: "luigi", nino: "antonino", checco: "francesco",
  // German, Dutch, French
  heinz: "heinrich", fritz: "friedrich", sepp: "josef", wim: "willem", piet: "pieter", jeannot: "jean", jojo: "joseph",
  // Slavic
  sasha: "alexander", sasa: "alexander", sanya: "alexander", shura: "alexander", misha: "mikhail", mischa: "mikhail", dima: "dmitri", dimka: "dmitri",
  vanya: "ivan", vanja: "ivan", kolya: "nikolai", kolja: "nikolai", volodya: "vladimir", vova: "vladimir", seryozha: "sergei", serezha: "sergei",
  zhenya: "evgeny", petya: "pyotr", masha: "maria", katya: "ekaterina", natasha: "natalia", olya: "olga", nadya: "nadezhda",
  tanya: "tatiana", lena: "elena", sveta: "svetlana", galya: "galina", zosia: "zofia", kasia: "katarzyna", basia: "barbara", janek: "jan",
  wojtek: "wojciech", staszek: "stanislaw", zbyszek: "zbigniew", piotrek: "piotr", tomek: "tomasz", honza: "jan", jirka: "jiri", vasek: "vaclav",
});

/** The full name for a nickname or short form, or the word itself. */
export function nicknameCanonical(word: string): string {
  return NICKNAMES[word] ?? word;
}

// ---------------------------------------------------------------------------
// The same name in another language or romanisation (weak).
// ---------------------------------------------------------------------------

const GIVEN_EQUIVALENT_GROUPS: readonly string[] = [
  "joseph jose josef giuseppe jozef osip yusuf yosef youssef joe josip",
  "john juan jean johann johannes giovanni ivan jan yohanan yahya ian sean evan hans joao jon ioan",
  "peter pedro pierre pietro pyotr piotr petr boutros petros",
  "paul pablo paulo pavel pawel paolo pol paulus",
  "james jacob santiago jacques yaakov yacoub jakub giacomo jaime iago",
  "michael miguel mikhail michel mikael michal mihail mikhael",
  "mary maria miriam marie mariam maryam marija",
  "anna hannah ana anne ann hanna anya anja",
  "elizabeth isabel elisabeth elisabetta elzbieta yelizaveta isabella elsa lisbeth",
  "catherine katherine katarzyna ekaterina caterina katerina katrin katharina catalina",
  "abraham ibrahim avraham abram",
  "moses musa moshe moises mose",
  "david dawud daoud dawood davide davit",
  "daniel danyal daniyal danilo",
  "solomon sulaiman shlomo salomon salomone suleyman",
  "mark marcos marco marc marek markus",
  "luke lucas luca lukas lukasz luc",
  "matthew mateo matteo mathieu matthias matvey mateusz matias",
  "andrew andres andre andrea andrzej andrei andreas",
  "thomas tomas tomasz tommaso tomaso toma",
  "simon simeon shimon simone",
  "philip felipe filippo philippe filip",
  "stephen esteban etienne stefan stefano istvan stephan stepan",
  "anthony antonio antoine anton antoni antonin",
  "francis francisco francesco francois franz franciszek frank",
  "charles carlos carlo karl carl karol",
  "henry enrique henri heinrich enrico hendrik henryk",
  "william guillermo guillaume wilhelm guglielmo willem wilhelmus",
  "robert roberto rupert",
  "louis luis luigi ludwig lewis ludovic",
  "george jorge georges giorgio georg yuri jerzy gyorgy girgis gheorghe",
  "nicholas nicolas nicola nikolai mikolaj nikola nikolaus",
  "eugene eugenio eugen evgeny",
  "victor vittorio viktor wiktor vicente",
  "martin marten",
  "edward eduardo edouard eduard edvard",
  "richard ricardo riccardo",
  "frederick federico friedrich frederic fryderyk",
  "lawrence lorenzo laurent lorenz",
  "vincent vicente vincenzo",
  "samuel samuele shmuel",
  "gabriel jibril gavriel gabriele",
  "raphael rafael raffaele rafal",
  "isaac ishaq yitzhak isaak",
  "teresa therese theresa tereza",
  "margaret margarita marguerite margherita malgorzata margit greta",
  "susan susana suzanne susanna zuzana shoshana",
  "sarah sara sarra",
  "rebecca rebeca rivka ribqa",
  "rachel raquel rahel rakhil",
  "judith judit yehudit",
  "joanna juana jeanne giovanna johanna joan",
  "christine cristina christina kristina krystyna",
  "helen elena helena helene yelena eleni ellen",
  "julia julie giulia yulia",
  "magdalena madeleine magdalene maddalena",
  "louise luisa luiza",
  "caroline carolina carolin",
  "alice alicia",
  "paula paola",
  "victoria viktoria wiktoria",
  "natalia natalie nathalie natalya",
  "irene irina irini irena",
  "sophia sofia zofia sophie",
  "barbara varvara",
  "eve eva hawa",
  "alexander alejandro alexandre alessandro alexandros iskander oleksandr",
  "dmitri dmytro demetrius dimitrios dimitri",
  "boris borys",
  "adam adem",
  "noah nuh noe",
  "jonathan yonatan",
  "muhammad mehmet mamadou muhammadou",
  "yasmin jasmine",
  "rose rosa rosie",
];

const SURNAME_EQUIVALENT_GROUPS: readonly string[] = [
  // Chinese in Mandarin pinyin, Cantonese, Hokkien and Wade-Giles romanisations, with the Korean reading of the same character.
  "zhang chang cheung teo jang jhang",
  "wang wong ong",
  "li lee lie leigh yi rhee ri",
  "liu lau low liew",
  "chen chan tan chin",
  "yang yeung young yeo yeoh",
  "huang hwang uy whang",
  "zhao chao chiu",
  "wu woo ng goh",
  "zhou chow chou chau",
  "xu hsu",
  "sun suen",
  "ma mah",
  "zhu chu choo",
  "guo kwok kuo",
  "he ho",
  "lin lam lim im yim",
  "gao koh kao ko go",
  "luo law lor",
  "liang leung leong",
  "zheng cheng teng jung jeong chung jeung",
  "xie hsieh tse",
  "song soong sohn",
  "tang tong tung",
  "han hon hahn",
  "feng fung",
  "cao tsao",
  "peng pang phang",
  "zeng tsang",
  "xiao hsiao siu",
  "tian tien",
  "pan poon",
  "yuan yuen",
  "cai tsai",
  "jiang chiang kiang",
  "yu yue yoo you",
  "du tu",
  "ye yip yeh",
  "su so sou",
  "lu loo",
  "wei wai",
  "ding ting",
  "shen sum",
  "yao yiu",
  "wan man",
  "qian",
  "fu foo",
  // Korean.
  "kim gim",
  "park bak pak",
  "choi choe chey",
  "kang gang",
  "cho jo",
  "yoon yun",
  "seo suh",
  "shin sin",
  "kwon gwon",
  "ahn an",
  "jeon jun chon",
  "moon mun",
  "bae pae",
  "baek paik",
  "heo huh hur",
  // Other languages: the same name in another language.
  "muller miller moller",
  "schneider taylor",
  "fischer fisher",
  "becker baker",
  "koch cook",
  "neumann newman",
  "braun brown",
  "schmidt smith",
  "martinez martins martin",
  "fernandez fernandes",
];

function equivalentIndex(groups: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups) {
    const list = g.split(/\s+/).filter(Boolean);
    const head = list[0];
    if (!head) continue;
    const id = spellingCanonical(head);
    for (const w of list) {
      const c = spellingCanonical(w);
      if (!out.has(c)) out.set(c, id);
    }
  }
  return out;
}

const GIVEN_EQUIVALENT = equivalentIndex(GIVEN_EQUIVALENT_GROUPS);
const SURNAME_EQUIVALENT = equivalentIndex(SURNAME_EQUIVALENT_GROUPS);

/** The id of the translation group a given name is in (Joseph, Yusuf and Jose share one), or null. A hint, never proof. */
export function givenEquivalentId(word: string): string | null {
  return GIVEN_EQUIVALENT.get(spellingCanonical(nicknameCanonical(word))) ?? null;
}

/** The id of the romanisation group a family name is in (Zhang, Cheung and Chang share one), or null. A hint, never proof. */
export function surnameEquivalentId(word: string): string | null {
  return SURNAME_EQUIVALENT.get(spellingCanonical(word)) ?? null;
}
