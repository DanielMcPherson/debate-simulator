import type { Card, Crowd, GramNumber, Opponent, Side, Topic } from '../engine/types';

// Chunk lexicon (Oh...Sir!!-style). The deck is mostly SUBJECT noun phrases and
// chunky PREDICATE phrases. Predicates are either complete ("kicks puppies") or
// "open" with a fill-in object slot ("is in bed with ___"). Connectors chain
// them; intensifiers cap them.

// --- builders ---------------------------------------------------------------

interface NpOpts {
  person?: 1 | 2 | 3;
  number?: GramNumber;
  topics?: string[];
  intensity?: number;
  /** False for a thing/abstraction subject so a modifier says "which", not "who". */
  animate?: boolean;
  /** Headliner: raises the statement's score cap (see Card.ceiling). */
  ceiling?: number;
}
// A subject's SIDE implies its topic(s): every self subject answers "Your Record";
// every opponent subject answers BOTH "Your Opponent" and "Name-Calling" (naming the
// target is half of a roast). Derived here so the data can't drift — a new
// self/opponent NP is auto-tagged; you never hand-type these. (audience/neutral have
// no implied topic; tag those explicitly via `o.topics`.)
const SIDE_TOPIC: Partial<Record<Side, string[]>> = { self: ['record'], opponent: ['opponent', 'jackass'] };
const NP = (id: string, text: string, side: Side, sentiment: number, o: NpOpts = {}): Card => {
  const topics = [...new Set([...(SIDE_TOPIC[side] ?? []), ...(o.topics ?? [])])];
  return {
    id,
    role: 'np',
    text,
    side,
    sentiment,
    person: o.person ?? 3,
    number: o.number ?? 'sing',
    topics: topics.length ? topics : undefined,
    intensity: o.intensity,
    animate: o.animate,
    ceiling: o.ceiling,
  };
};

interface PredExtra {
  pre?: string;
  topics?: string[];
  /** Headliner: raises the statement's score cap (see Card.ceiling). */
  ceiling?: number;
}
/** Closed, conjugatable predicate: "kicks puppies", "is a national disgrace". */
const pc = (id: string, lead: string, post: string, sentiment: number, e: PredExtra = {}): Card => ({
  id,
  role: 'predicate',
  lead,
  post,
  sentiment,
  pre: e.pre,
  topics: e.topics,
  ceiling: e.ceiling,
});
/** Closed, invariant predicate (modal/negated phrasings work for any subject). */
const pi = (id: string, text: string, sentiment: number, e: PredExtra = {}): Card => ({
  id,
  role: 'predicate',
  text,
  invariant: true,
  sentiment,
  topics: e.topics,
  ceiling: e.ceiling,
});
/** Open predicate: needs an object; polarity = deed + affinity × object sentiment. */
const po = (
  id: string,
  lead: string,
  post: string,
  affinity: number,
  deed: number,
  e: PredExtra = {},
): Card => ({ id, role: 'predicate', open: true, lead, post, affinity, deed, pre: e.pre, topics: e.topics, ceiling: e.ceiling });

/**
 * Post-nominal modifier aside: "who is ugly, just very ugly" / "which is a treasure".
 * Like a mini-predicate on the subject (conjugates via `lead`/`post`), but rendered
 * with a relative pronoun and folded into its clause for scoring. `sentiment` is
 * about the subject's referent; `rel` is only the standalone display hint. NO `side` —
 * the effect depends on whatever subject it's played on (an attack on an opponent, a
 * self-own on yourself), exactly like a roaming bit of sentiment.
 */
const md = (
  id: string,
  post: string,
  sentiment: number,
  e: { lead?: string; pre?: string; rel?: 'who' | 'which'; topics?: string[]; invariant?: boolean; conj?: Card['conj']; ceiling?: number } = {},
): Card =>
  e.invariant
    ? { id, role: 'modifier', text: post, invariant: true, sentiment, topics: e.topics, conj: e.conj, ceiling: e.ceiling } // `post` carries the full phrase incl. its pronoun
    : { id, role: 'modifier', lead: e.lead ?? 'be', post, pre: e.pre, sentiment, rel: e.rel, topics: e.topics, conj: e.conj, ceiling: e.ceiling };

// --- subjects (noun phrases with a side) ------------------------------------

export const SUBJECTS: Card[] = [
  NP('s_i', 'I', 'self', 1, { person: 1 }),
  NP('s_admin', 'My administration', 'self', 1, { animate: false }),
  NP('s_record', 'My record', 'self', 1, { animate: false }),
  NP('s_policies', 'My policies', 'self', 1, { number: 'plural', animate: false }),
  NP('s_opp', 'My opponent', 'opponent', -1),
  NP('s_opp_wife', "My opponent's wife", 'opponent', -1),
  NP('s_opp_donors', "My opponent's donors", 'opponent', -1, { number: 'plural' }),
  NP('s_career', 'Career politicians', 'opponent', -1, { number: 'plural' }),
  NP('s_insiders', 'Washington insiders', 'opponent', -1, { number: 'plural' }),
  NP('s_people', 'The American people', 'audience', 2, { number: 'plural', topics: ['pander'] }),
  NP('s_families', 'Hardworking families', 'audience', 2, { number: 'plural', topics: ['children'] }),
  NP('s_children', 'Our children', 'audience', 2, { number: 'plural', topics: ['children'] }),
  NP('s_nation', 'This great nation', 'audience', 2, { topics: ['freedom'], animate: false }),
  // Flavor variants (score like their plain counterparts; funnier wording).
  NP('s_admin_normal', 'My totally normal administration', 'self', 1, { animate: false, intensity: 1.3 }),
  NP('s_campaign_legal', 'My beautiful and completely legal campaign', 'self', 1, { animate: false, intensity: 1.3 }),
  NP('s_opp_team', "My opponent's team of untrustworthy weirdos", 'opponent', -1, { intensity: 1.3 }),
  NP('s_people_brave', 'The brave people watching this debate', 'audience', 2, { number: 'plural', topics: ['pander'] }),
  NP('s_people_normal', 'The deeply normal and not-at-all-angry people of this country', 'audience', 2, { number: 'plural', topics: ['pander'], intensity: 1.3 }),
  NP('s_children_screen', 'Our screen-addicted but still precious children', 'audience', 2, { number: 'plural', topics: ['children'], intensity: 1.3 }),
  NP('s_handshake', 'My famously firm handshake', 'self', 1, { animate: false }),
  NP('s_commonsense', 'My award-winning common sense', 'self', 1, { animate: false }),
  NP('s_opp_friends', "My opponent's mysterious offshore friends", 'opponent', -1, { number: 'plural', intensity: 1.3 }),
  NP('s_opp_list', "My opponent's entirely imaginary list of accomplishments", 'opponent', -1, { animate: false }),
  NP('s_goodpeople', 'The good people who actually showed up tonight', 'audience', 2, { number: 'plural', topics: ['pander'], intensity: 1.3 }),
  NP('s_smalltowns', 'Our tired but unbeaten small towns', 'audience', 2, { number: 'plural', topics: ['pander'], animate: false }),
  NP('s_country_flaws', 'This beautiful country, flaws and all', 'audience', 2, { topics: ['freedom'], animate: false, intensity: 1.3 }),
];

// --- objects (noun phrases that fill an open predicate's slot) --------------

export const OBJECTS: Card[] = [
  { ...NP('o_satan', 'Satan', 'neutral', -3), proper: true }, // generic evil — no topic
  NP('o_swamp', 'the swamp', 'neutral', -2, { topics: ['economy'], animate: false }),
  NP('o_taxes', 'higher taxes', 'neutral', -2, { number: 'plural', topics: ['economy'], animate: false }),
  NP('o_lobbyists', 'shady lobbyists', 'neutral', -2, { number: 'plural', topics: ['economy'] }),
  NP('o_chaos', 'total chaos', 'neutral', -3, { topics: ['security'], animate: false }),
  NP('o_freedom', 'freedom and democracy', 'neutral', 3, { topics: ['freedom'], animate: false }),
  NP('o_veterans', 'our veterans', 'neutral', 3, { number: 'plural', topics: ['security'] }),
  NP('o_smallbiz', 'small businesses', 'neutral', 2, { number: 'plural', topics: ['economy'], animate: false }),
  NP('o_middle', 'the middle class', 'neutral', 2, { topics: ['economy'], animate: false }),
  NP('o_borders', 'our borders', 'neutral', 2, { number: 'plural', topics: ['security'], animate: false }),
  NP('o_schools', 'our public schools', 'neutral', 2, { number: 'plural', topics: ['children'], animate: false }),
  NP('o_constitution', 'the Constitution', 'neutral', 3, { topics: ['freedom'], animate: false }),
  NP('o_paycheck', "the working man's paycheck", 'neutral', 2, { topics: ['economy'], animate: false }),
  { ...NP('o_mainstreet', 'Main Street', 'neutral', 2, { topics: ['economy'], animate: false }), proper: true },
  NP('o_familyfarm', 'the family farm', 'neutral', 2, { topics: ['economy'], animate: false }),
  NP('o_commonsense', 'common sense itself', 'neutral', 2, { animate: false }),
  NP('o_bureaucracy', 'the bloated bureaucracy', 'neutral', -2, { topics: ['economy'], animate: false }),
  NP('o_inflation', 'runaway inflation', 'neutral', -3, { topics: ['economy'], animate: false }),
  NP('o_interests', 'the special interests', 'neutral', -2, { number: 'plural', topics: ['economy'], animate: false }),
  NP('o_committee', 'a do-nothing committee', 'neutral', -2, { topics: ['economy'], animate: false }),
];

// --- predicates -------------------------------------------------------------

// COMMON predicates — generic "stump speech" material, found only in the shared
// (contested) pool. Mild and serviceable; everyone fights over them.
export const COMMON_PRAISE: Card[] = [
  pc('p_deliver', 'deliver', 'blue skies and happiness', 2),
  pc('p_love_fd', 'love', 'freedom and democracy', 2, { topics: ['freedom'] }),
  pc('p_patriot', 'be', 'a true patriot', 2),
  pc('p_strong', 'be', 'strong and decisive', 2),
  pc('p_standup', 'stand', 'up for the little guy', 2, { topics: ['pander'] }),
  pc('p_protect_vets', 'protect', 'our veterans', 2, { topics: ['security'] }),
  pc('p_cut_taxes', 'cut', 'taxes for working families', 2, { topics: ['economy'] }),
  pi('p_fund_schools', 'will fully fund our schools', 2, { topics: ['children'] }),
  pi('p_defend_liberty', 'will defend our liberty', 2, { topics: ['freedom'] }),
  pi('p_fight_for_you', 'will always fight for you', 2, { topics: ['pander'] }),
  pi('p_have_back', 'will always have your back', 2, { topics: ['pander'] }),
  pi('p_keep_safe', 'will keep this country safe', 2, { topics: ['security'] }),
  pc('p_read_constitution', 'have', 'read every single word of the Constitution and loved all of it', 3, { topics: ['freedom'] }),
];

// Every insult answers BOTH attack topics — Name-Calling ('jackass') and Your
// Opponent ('opponent'): slinging mud IS the worst-thing-about-them. (Tags appended
// below; de-duped so a topical insult like p_raise_taxes keeps 'economy' too.)
export const COMMON_INSULTS: Card[] = [
  pc('p_kick_pup', 'kick', 'puppies', -3),
  pc('p_lie', 'lie', 'to your face', -2),
  pc('p_disgrace', 'be', 'a national disgrace', -2),
  pc('p_weak', 'be', 'weak and out of touch', -1),
  pc('p_jackass', 'be', 'an unscrupulous jackass', -2),
  pc('p_raise_taxes', 'want', 'to raise your taxes', -2, { topics: ['economy'] }),
  pc('p_cut_lunch', 'want', 'to cancel school lunch', -2, { topics: ['children'] }),
  pc('p_silence', 'want', 'to silence free speech', -2, { topics: ['freedom'] }),
  pc('p_worship', 'worship', 'Satan', -2), // generic smear → Name-Calling only (jackass via map)
  pc('p_ignore_vets', 'ignore', 'our veterans', -2, { topics: ['security'] }),
  pi('p_cant_trust', "can't be trusted", -1),
  pi('p_say_anything', 'will say anything to get elected', -1),
  pi('p_destroy_country', 'will destroy this country', -2),
  pi('p_ashamed', 'should be ashamed', -1),
  pc('p_tax_christmas', 'want', 'to tax your Christmas presents', -3, { topics: ['economy', 'children'] }),
  pc('p_tollbooth', 'want', 'to put a toll booth on your driveway', -3, { topics: ['economy'] }),
  pc('p_naps', 'nap', 'through every important meeting', -2),
].map((c) => ({ ...c, topics: [...new Set([...(c.topics ?? []), 'jackass', 'opponent'])] }));

// SIGNATURE predicates — punchy, characterful zingers found ONLY in private decks
// (never in the shared pool), grouped by archetype. These are the cards worth
// building a deck around, and they define the opponents' personalities.
export const SIG_BRAG: Card[] = [
  pi('p_fight_bear', 'will personally fight a bear for your freedom', 3),
  pc('p_lift_boats', 'bench-press', 'small fishing boats before breakfast', 3),
  pi('p_phonecall', 'could fix the whole economy with a single phone call', 3, { topics: ['economy'] }),
  pc('p_neverwrong', 'be', 'never wrong about anything, ever', 3),
  // (p_treasure cut 2026-07 — duplicated the m_treasure aside; the aside misfiring next to
  // the wrong subject is the funnier failure mode, so the aside version stays.)
  pc('p_handshake_hair', 'have', 'the handshake of a champion and the hair of a statesman', 3),
  pc('p_courage', 'have', 'the courage of ten senators and the humility of eleven', 3),
  pi('p_battery', "will direct our nation's scientists to make the last 10% of a phone battery last longer", 3),
  pi('p_hurricane', 'once talked a hurricane into changing course', 3),
  pi('p_wallet', 'personally returned a lost wallet on live television', 3),
  pc('p_oncegen', 'be', 'a once-in-a-generation genius', 2), // demoted from a reward — too generic for the top tier
  pi('p_zipcodes', 'memorized every ZIP code in this country, out of respect', 3),
  pc('p_ikea', 'assemble', 'IKEA furniture with no leftover screws, on the first try', 3), // authored WITH its upgrade chain (Daniel, 2026-07)
];

export const SIG_ATTACK: Card[] = [
  pc('p_microchip', 'want', 'to put a microchip in your flu shot', -3),
  pc('p_llama', 'run', 'an underground llama-grooming cartel', -3, { pre: 'secretly' }),
  pc('p_moon', 'think', 'the moon landing was filmed in a Denny’s', -3),
  pc('p_crayons', 'eat', 'crayons at cabinet meetings', -3),
  pc('p_handshake', 'have', 'a secret handshake with the deep state', -3),
  pi('p_sell_constitution', 'would sell the Constitution for airline miles', -3, { topics: ['freedom'] }),
  pc('p_dubstep_anthem', 'want', 'to replace the national anthem with screechy dubstep noises', -3),
  pc('p_big_kale', 'take', 'marching orders from Big Kale', -3),
  pc('p_magic_eightball', 'want', 'to replace the Supreme Court with a Magic Eight Ball', -3),
  pc('p_shrimp_buffet', 'have', 'the moral compass of a casino shrimp buffet', -3),
  pi('p_find_economy', "couldn't find the economy with both hands and a map", -2, { topics: ['economy'] }),
  // Petty-crimes-against-society tier (2026-07): small, vivid, damning.
  pc('p_shoppingcart', 'have', 'never once returned a shopping cart', -3),
  pc('p_microwavefish', 'microwave', 'fish in the office breakroom', -3),
  pc('p_fridgelunch', 'eat', "other people's lunches out of the office fridge", -3),
].map((c) => ({ ...c, topics: [...new Set([...(c.topics ?? []), 'jackass', 'opponent'])] })); // smears answer Name-Calling + Your Opponent

export const SIG_PANDER: Card[] = [
  pi('p_free_icecream', 'will deliver free ice cream every Friday', 3, { topics: ['pander'] }),
  pc('p_tuck_vets', 'tuck', 'in every veteran at night', 3, { topics: ['security'] }),
  pi('p_golden', 'will give every family a golden retriever', 3, { topics: ['pander'] }),
  pc('p_highfive', 'high-five', 'every single voter personally', 2, { topics: ['pander'] }),
  pi('p_christmas3', 'will add three more Christmases to the national calendar', 3, { topics: ['pander'] }),
  pi('p_birthday', 'will fight to ensure that every birthday feels special', 3, { topics: ['pander'] }),
  pi('p_naphour', 'will establish a national nap hour for hardworking Americans', 3, { topics: ['pander'] }),
  pc('p_wakeup', 'wake', 'up every morning thinking about you, specifically', 3, { topics: ['pander'] }),
  pi('p_monday', 'will make Monday a second Saturday', 3, { topics: ['pander'] }),
  pi('p_refund', 'will personally refund your last parking ticket', 3, { topics: ['pander'] }),
  pc('p_dmv', 'promise', 'shorter lines at the DMV, forever', 3, { topics: ['pander'] }),
  pi('p_coffeeshop', 'will put a coffee shop on every single corner', 2, { topics: ['pander'] }),
  // Recognizable presidential rhetoric — baked into a promise (where these phrases
  // actually live), not bare nouns. Playtester suggestions.
  pi('p_city_hill', 'will build a shining city on a hill', 3, { topics: ['freedom'] }),
  pi('p_points_light', 'will light a thousand points of light across this great land', 3, { topics: ['pander'] }),
  pi('p_anthemkey', 'will put the national anthem in a key normal people can actually sing', 3, { topics: ['pander'] }),
  pi('p_noupdates', 'will ban software updates during business hours', 3, { topics: ['pander'] }),
];

// SIGNATURE noun phrases — flavorful openers/objects, private decks only.
export const SIG_SUBJ_BRAG: Card[] = [
  NP('s_position', 'My position, which is the best position, believe me,', 'self', 1, { intensity: 1.3 }),
  NP('s_campaign_transparent', 'My incredibly well-organized and financially transparent campaign', 'self', 1, { intensity: 1.3, animate: false }),
  NP('s_plan', 'My plan, which fits neatly on a single index card', 'self', 1, { animate: false }),
  NP('s_gut', 'My gut, which has frankly never once been wrong', 'self', 1, { intensity: 1.3, animate: false }),
  NP('s_plan_spellcheck', 'My beautiful, patriotic, and mostly spell-checked plan', 'self', 1, { intensity: 1.3, animate: false }),
  NP('s_admin_unhaunted', 'My administration, which has never once been haunted', 'self', 1, { intensity: 1.3, animate: false }),
];
export const SIG_SUBJ_ATTACK: Card[] = [
  NP('s_idiot_opp', 'My idiot freedom-hating opponent', 'opponent', -2, { intensity: 1.3 }),
  NP('s_crook_opp', 'My crooked, do-nothing opponent', 'opponent', -2, { intensity: 1.3 }),
  NP('s_opp_buffoons', "The malignant buffoons backing my opponent's campaign", 'opponent', -2, { number: 'plural', intensity: 1.3 }),
  NP('s_opp_army', "My opponent's army of elitist hall monitors", 'opponent', -2, { intensity: 1.3 }),
  NP('s_opp_speechwriters', "The lobbyists who write my opponent's speeches", 'opponent', -2, { number: 'plural', intensity: 1.3 }),
  NP('s_opp_personality', "My opponent's heavily focus-grouped personality", 'opponent', -2, { intensity: 1.3, animate: false }),
];
export const SIG_SUBJ_PANDER: Card[] = [
  NP('s_proud_nation', 'This great and proud nation', 'audience', 2, { topics: ['freedom'], intensity: 1.3, animate: false }),
  NP('s_wonderful_people', 'The wonderful, beautiful people of this country', 'audience', 2, { number: 'plural', topics: ['pander'], intensity: 1.3 }),
];
export const SIG_OBJECTS: Card[] = [
  NP('o_radical', 'the radical fringe', 'neutral', -2),
  NP('o_communists', 'card-carrying communists', 'neutral', -3, { number: 'plural' }),
  NP('o_patriots', 'hardworking patriots', 'neutral', 3, { number: 'plural' }),
];
export const SIG_NPS: Card[] = [
  ...SIG_SUBJ_BRAG,
  ...SIG_SUBJ_ATTACK,
  ...SIG_SUBJ_PANDER,
  ...SIG_OBJECTS,
];

// Open predicates: completed with an object from OBJECTS / SUBJECTS / topic card.
export const OPEN_PREDS: Card[] = [
  po('p_bed_with', 'be', 'in bed with', 1, 0), // in bed with Satan = bad; with our veterans = good
  po('p_destroy', 'want', 'to destroy', -1, 0), // destroy freedom = bad; destroy the swamp = good
  po('p_funded', 'be', 'bankrolled by', 1, 0),
  po('p_blame', 'blame', 'everything on', -1, 0), // blame our veterans = bad; blame the swamp = good
  po('p_defend', 'defend', '', 1, 0, { pre: 'proudly' }), // "proudly defends ___"
  po('p_war_on', 'have', 'declared war on', -1, 0), // war on the swamp = good; war on freedom = bad
  po('p_oath', 'have', 'sworn a blood oath to', 1, 0), // oath to Satan = bad; oath to our veterans = good
  po('p_photo', 'keep', 'a framed photo of', 1, 0),
  // modal phrasing can't conjugate to the subject — invariant, object still fills the slot
  { id: 'p_anything_for', role: 'predicate', open: true, invariant: true, text: 'would do absolutely anything for', affinity: 1, deed: 0 },
];

export const PREDICATES: Card[] = [
  ...COMMON_PRAISE,
  ...COMMON_INSULTS,
  ...SIG_BRAG,
  ...SIG_ATTACK,
  ...SIG_PANDER,
  ...OPEN_PREDS,
];

// --- modifiers (post-nominal asides) ----------------------------------------
// Played between a subject and its predicate to intensify the clause and break the
// noun-verb rhythm (also a handy waiting move). Sentiment is about the subject; the
// effect flips with who you attach it to, so they carry no side.
export const MODIFIERS: Card[] = [
  md('m_ugly', 'ugly, just very ugly', -2, { rel: 'who' }),
  md('m_crook', 'as crooked as the day is long', -3, { rel: 'who' }),
  md('m_liar', 'constantly', -2, { lead: 'lie', rel: 'who' }), // "who lies constantly"
  md('m_disaster', 'a total disaster', -2, { rel: 'which' }),
  md('m_treasure', 'frankly a national treasure', 3, { rel: 'who' }),
  md('m_genius', 'an absolute genius', 3, { rel: 'who' }),
  md('m_loves_country', 'this country', 2, { lead: 'love', rel: 'who' }), // "who loves this country"
  md('m_blessing', 'a blessing to us all', 2, { rel: 'which' }),
  md('m_stupidest', 'among the stupidest humans to ever walk the Earth', -3, { rel: 'who' }),
  md('m_smells', 'even worse than expected', -2, { lead: 'smell', pre: 'somehow', rel: 'who' }), // "who somehow smells…"
  md('m_lostit', 'who, and I say this with love, has completely lost it', -3, { invariant: true }), // the fake mid-sentence tenderness earns the tier
  // good
  md('m_better', 'frankly never looked better', 2, { lead: 'have', rel: 'who' }), // "who has frankly never looked better"
  md('m_winning', 'winning by every available metric', 2, { rel: 'who' }),
  md('m_triumph', 'which the experts are reportedly calling a triumph', 2, { invariant: true }),
  md('m_humility', 'whose sparkling humility is praised by everyone who matters', 3, { invariant: true }),
  md('m_ff_proud', 'who would truly make our founding fathers proud', 2, { invariant: true }),
  // bad
  md('m_catbox', 'like a goat vomited into an overfilled catbox', -3, { lead: 'smell', pre: 'frankly', rel: 'which' }),
  md('m_park', 'who cannot parallel park to save their life', -2, { invariant: true }),
  md('m_lowiq', 'a very low IQ, believe me', -2, { lead: 'have', rel: 'who' }), // "who has a very low IQ, believe me"
  md('m_drunk', 'probably drunk right now', -3, { rel: 'who' }), // "who is probably drunk right now"
  // neutral (0): pure flavor + a waiting move; never angers the crowd, never helps the score
  md('m_tape', 'which is, between us, mostly held together with tape', 0, { invariant: true }),
  md('m_pollswell', 'which polls very well among people I invented', 3, { invariant: true }),
  md('m_dmvpolls', "whose approval rating recently fell below the DMV's", -3, { invariant: true }),
  // (The dual-role coordinating parentheticals m_trustme/m_notmakingup moved to REWARDS
  // 2026-07 — an aside + ×1.25-connector in one slot strictly dominated plain "and" when
  // face-up in the shared pool. The dual-role mechanic is deck-agnostic; see REWARDS.)
];

// --- connectors -------------------------------------------------------------

export const CONNECTORS: Card[] = [
  { id: 'c_and', role: 'connector', text: 'and', conj: 'and' },
  { id: 'c_but', role: 'connector', text: 'but', conj: 'but' },
  { id: 'c_because', role: 'connector', text: 'because', conj: 'because' },
  { id: 'c_therefore', role: 'connector', text: 'and therefore', conj: 'and therefore' },
  { id: 'c_which', role: 'connector', text: 'which is why', conj: 'and therefore' },
  { id: 'c_frankly', role: 'connector', text: 'and frankly', conj: 'and' }, // retiered 2026-07 — reads as "and" with an adverb, didn't earn the ×1.30 logic tier
  { id: 'c_seeing', role: 'connector', text: 'seeing as how', conj: 'because' }, // second clause-only teacher (CBEC needs a full clause after it)
  // Flavor variants (map to existing conj behaviors) — more connector words to chain
  // longer compound sentences. Playtester wanted to ramble; these are the sanctioned
  // way to do it (period stays disabled; jamming two thoughts with no connector = run-on).
  { id: 'c_so', role: 'connector', text: 'so', conj: 'and therefore' },
  { id: 'c_plus', role: 'connector', text: 'and plus', conj: 'and' },
  { id: 'c_however', role: 'connector', text: 'however', conj: 'but' },
];

/**
 * The free, unlimited period — a virtual card that is ALWAYS available (never
 * drawn, never consumed), so it is deliberately NOT part of CONNECTORS/ALL and
 * never enters a deck. It ends the current clause and opens a fresh one with no
 * combo bonus (legal-only glue). The grammar/scoring treat `conj: 'period'`.
 */
export const PERIOD: Card = { id: 'c_period', role: 'connector', text: '.', conj: 'period' };

/**
 * Feature flag — the period button experiment. When false, the period is never
 * offered (UI button hidden, AI `availFor` skips it), so a statement is one
 * sentence (or connectors chained into one compound sentence); jamming two
 * complete thoughts together reads as a "Run-on" (confused). All the period
 * plumbing (grammar `CPERIOD`, scoring residual/decay, `endableLine` trim) stays
 * intact, so flipping this back to `true` fully restores the feature.
 */
export const PERIOD_ENABLED = false;

// --- intensifiers (finishers) -----------------------------------------------

// One-shot action cards (not part of the sentence). Played from the hand. The two
// sabotage cards are worded as a contrasting pair (REPLACE vs DELETE) and colored
// differently in the UI (see .card.fx-* in style.css) so they're not confused.
export const POWERUPS: Card[] = [
  { id: 'pw_search', role: 'powerup', effect: 'search', text: '📋 Search Notes — draw 5 cards' },
  { id: 'pw_typo', role: 'powerup', effect: 'typo', text: "🎤 Teleprompter Typo — REPLACE their last word with yours" },
  { id: 'pw_forgot', role: 'powerup', effect: 'forgot', text: "🧠 Forgot My Line — DELETE their last word" },
  { id: 'pw_plant', role: 'powerup', effect: 'plant', text: '🕵️ Plant in the Audience — reveal the crowd' },
  { id: 'pw_hotmic', role: 'powerup', effect: 'hotmic', text: '🎙️ Hot Mic — see their hand, steal a card' },
  { id: 'pw_filibuster', role: 'powerup', effect: 'filibuster', text: '🗣️ Filibuster — stock up on connectors' },
];

// The scripted pre-boss story card. STANDALONE on purpose: not in POWERUPS (which seeds every
// default deck), not in REWARDS (random drafts), not in ALL (tutorial-pool sampling) — the only
// way in is the guaranteed award after debate 4 (UNDER_OATH_RUNG in ui/main.ts) → run.bonus.
export const UNDER_OATH: Card = {
  id: 'pw_underoath',
  role: 'powerup',
  effect: 'oath',
  text: '⚖️ Under Oath — this question, your opponent cannot lie',
};

export const INTENSIFIERS: Card[] = [
  { id: 'x_guarantee', role: 'intensifier', text: 'and I personally guarantee it', factor: 1.5 },
  { id: 'x_everyone', role: 'intensifier', text: 'and everyone knows it', factor: 1.5 },
  { id: 'x_believe', role: 'intensifier', text: 'believe me', factor: 1.4 },
  { id: 'x_record', role: 'intensifier', text: 'and that is on the record', factor: 1.4 },
  { id: 'x_promise', role: 'intensifier', text: "and that's a promise", factor: 1.4 },
  { id: 'x_factcheck', role: 'intensifier', text: "and I don't care what the fact checkers say about it", factor: 1.5 },
  { id: 'x_tired', role: 'intensifier', text: "and frankly I'm tired of saying it", factor: 1.4 },
  { id: 'x_lookitup', role: 'intensifier', text: 'and you can look that up, folks, it’s true', factor: 1.5 },
  { id: 'x_settled', role: 'intensifier', text: "and that's settled science", factor: 1.5 },
  { id: 'x_endofstory', role: 'intensifier', text: 'period, end of story', factor: 1.4 },
  { id: 'x_otherguy', role: 'intensifier', text: "and you won't hear that from the other guy", factor: 1.4 },
  { id: 'x_history', role: 'intensifier', text: 'and history will prove me right', factor: 1.5 },
  { id: 'x_writedown', role: 'intensifier', text: 'write that down', factor: 1.4 },
  { id: 'x_comeon', role: 'intensifier', text: 'come on, man', factor: 1.4 }, // playtester suggestion — folksy exasperated closer
  { id: 'x_brave', role: 'intensifier', text: "and I'm the only one brave enough to say it!", factor: 1.5 },
  { id: 'x_thankme', role: 'intensifier', text: 'and history will thank me for saying it!', factor: 1.5 },
  { id: 'x_micdrop', role: 'intensifier', text: 'Checkmate. Boom. Mic drop.', factor: 1.5 }, // renders as its own sentence (no leading "and")
  { id: 'x_oughtto', role: 'intensifier', text: "and if that isn't true, then it damn sure ought to be!", factor: 1.4 },
  { id: 'x_saidwhatisaid', role: 'intensifier', text: 'I said what I said.', factor: 1.4 }, // renders as its own sentence
  { id: 'x_blessmic', role: 'intensifier', text: 'God bless this microphone', factor: 1.4 }, // renders as its own sentence
];

// --- topics -----------------------------------------------------------------

// A topic's card is always available to both players and never consumed. It can
// be a subject, an object, or a predicate — whatever the topic "requires".
// Issue topics are valued things (+2) so charged predicates land on them.
const tNp = (id: string, text: string, side: Side, sentiment: number, o: NpOpts = {}): Card =>
  NP(`t_${id}`, text, side, sentiment, { ...o, topics: [id] });
const tPred = (id: string, sentiment: number, fields: Partial<Card>): Card => ({
  id: `t_${id}`,
  role: 'predicate',
  sentiment,
  topics: [id],
  ...fields,
});

// Each topic carries several interchangeable open-ended moderator phrasings; one is
// picked per question so prompts don't repeat. They're flavor — the `id` (not the
// wording) is what cards address. The `card` is reserved/unused — see Topic.
export const TOPICS: Topic[] = [
  { id: 'economy', label: 'The Economy', card: tNp('economy', 'the economy', 'neutral', 2), questions: [
    "What's your plan for the economy?",
    'The economy: total disaster, or catastrophic dumpster fire?',
    'Voters are broke. Whose fault is it?',
    'Money — how do we get more of it?',
    'Is the economy doing great, or are we all doomed?',
  ] },
  { id: 'security', label: 'National Security', card: tNp('security', 'national security', 'neutral', 2), questions: [
    'How will you keep this country safe?',
    'Are we safe? Lie if you have to.',
    'Who should we be afraid of, and why is it your opponent?',
    'What scary thing will you protect us from today?',
    'How do you plan to defend this great nation?',
  ] },
  { id: 'freedom', label: 'Freedom & Liberty', card: tNp('freedom', 'our freedom', 'neutral', 2), questions: [
    'Is freedom overrated, or is it the best thing ever?',
    'Why is our country so awesome?',
    'Freedom: are we losing it, and who do we blame?',
    'What will you do to protect our precious liberty?',
    'How free is too free?',
  ] },
  { id: 'opponent', label: 'Your Opponent', card: tNp('opponent', 'my opponent', 'opponent', -1), questions: [
    'Why is your opponent such an asshole?',
    "What's the single worst thing about your opponent?",
    'Your opponent: incompetent, corrupt, or both?',
    'Why are you the marginally-less-terrible choice?',
    'Tell us why your opponent is the real villain here.',
  ] },
  { id: 'record', label: 'Your Record', card: tNp('record', 'my record', 'self', 1), questions: [
    'How are you so incredibly awesome?',
    'Brag about yourself. Go.',
    'Why do you deserve this more than literally everyone else?',
    "What's your proudest accomplishment? Make one up if needed.",
    'Remind the good people how great you are.',
  ] },
  { id: 'children', label: 'The Children', card: tNp('children', 'our children', 'audience', 2, { number: 'plural' }), questions: [
    'Our children: national treasure, or lazy jerks who should get off TikTok?',
    'What about the children? Seriously, what about them?',
    'The next generation: our future, or a lost cause?',
    'Won’t somebody PLEASE think of the children?',
    'How will you save the kids from whatever is threatening them this week?',
  ] },
  { id: 'pander', label: 'The Voters', card: tNp('pander', 'the wonderful voters', 'audience', 2, { number: 'plural' }), questions: [
    'These fine people are watching — tell them what they want to hear.',
    'Pander to the crowd. Subtlety is for losers.',
    'What will you promise the voters today?',
    'Win over the room — shameless flattery encouraged.',
    'Say something the base will cheer for.',
  ] },
  { id: 'jackass', label: 'Name-Calling', card: tPred('jackass', -3, { lead: 'be', post: 'an unscrupulous jackass' }), questions: [
    'Just how much does your opponent suck?',
    'Insult your opponent. We’ll wait.',
    'How big a jerk is your opponent, exactly?',
    "Don't be polite — roast your opponent.",
    'Gloves off: what do you REALLY think of your opponent?',
  ] },
];

// Named opponents, each with a fixed debating style (and a style-tuned deck).
// gaffeChance falls up the ladder: opp 1 is a Glass-Joe rookie who flubs often and
// cracks under any pressure; the boss is unflappable and plays optimally. nervousOf
// is the opponent's *tell* — what fluster them — for the player to discover.
export const OPPONENTS: Opponent[] = [
  { id: 'pander', name: 'Gov. Patty Pander', pronoun: 'she', style: 'pander', blurb: 'Nervous. Prone to gaffes.', gaffeChance: 0.45, nervousOf: ['attacked', 'pander', 'self_brag'] },
  { id: 'blowhard', name: 'Senator Blowhard', pronoun: 'he', style: 'brag', blurb: 'Big ego — rattled when shown up.', gaffeChance: 0.25, nervousOf: ['self_brag'] },
  { id: 'passer', name: 'Mayor Buck Passer', pronoun: 'he', style: 'pander', blurb: 'Slick, but cracks under a hot crowd.', gaffeChance: 0.12, nervousOf: ['pander'] },
  { id: 'smearwell', name: 'Rep. Dirk Smearwell', pronoun: 'he', style: 'attack', blurb: 'Sharp-tongued. Hates being attacked.', gaffeChance: 0.05, nervousOf: ['attacked'] },
  { id: 'slander', name: 'Justice Vera Slander', pronoun: 'she', style: 'attack', blurb: 'Polished. Rarely slips.', gaffeChance: 0.02 },
  { id: 'grandstand', name: 'Maximilian Q. Grandstand III', pronoun: 'he', style: 'brag', blurb: 'Unflappable. Never makes a mistake.', gaffeChance: 0 },
];

/**
 * The campaign ladder: a sequence of opponents of rising difficulty. Beat one to
 * earn a reward card and climb to the next; lose and the run ends. `maxExtend`
 * tunes how long/combo-heavy each opponent's statements get.
 */
// Difficulty rises on two axes: deeper planning (maxExtend) and fewer gaffes
// (Opponent.gaffeChance). The boss plans deep and never slips — beating it on the
// DEFAULT deck should be near-impossible; deck upgrades (later) close the gap.
// maxExtend tops out at 6: past that the ±35/50 scoring cap flattens it (deeper
// planning just caps out, no extra edge). The early ramp (3→6) is the real depth
// lever; the boss's "near-impossible on the default deck" must come from DECK
// QUALITY (giving top opponents reward-tier cards — see Roadmap), tuned with the
// deck-building pass. Gaffes (Opponent.gaffeChance) carry the easy/mid difficulty.
export const LADDER: { opponentId: string; maxExtend: number }[] = [
  { opponentId: 'pander', maxExtend: 3 },
  { opponentId: 'blowhard', maxExtend: 4 },
  { opponentId: 'passer', maxExtend: 5 },
  { opponentId: 'smearwell', maxExtend: 6 },
  { opponentId: 'slander', maxExtend: 6 },
  { opponentId: 'grandstand', maxExtend: 6 }, // final boss
];

// Crowds with a HIDDEN taste — the player must read the room from reactions.
export const CROWDS: Crowd[] = [
  { id: 'flattery', loves: 'praise_self', boost: 1.5 },
  { id: 'bloodthirsty', loves: 'attack_opp', boost: 1.5 },
  { id: 'patriots', loves: 'pander_aud', boost: 1.5 },
];

// REWARD cards — exclusive to the campaign ladder (never in a starting deck).
// Stronger than normal cards: ±4 predicates and high-intensity loaded subjects.
export const REWARDS: Card[] = [
  // Headliners: these powerful cards also raise the statement's score cap (`ceiling`) so they
  // break past the base ±35 instead of clipping. ±4 predicates → +4, loaded subjects → +3.
  // (r_traitor + r_eatpup cut 2026-07: "traitor to this very nation" was pure extremity with
  // no comedic transformation — the weakest ★ — and three creature-consumption attacks was
  // one too many; "secretly eats babies" keeps the crown.)
  pc('r_lizard', 'be', 'secretly a lizard person', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  pi('r_christmas', 'wants to cancel Christmas forever', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  pc('r_greatest', 'be', 'the greatest leader in human history', 4, { ceiling: 4 }),
  pi('r_cured', 'personally cured a deadly disease last Tuesday', 4, { ceiling: 4 }),
  pi('r_pony', 'will give every citizen a pony and a tax cut', 4, { ceiling: 4 }),
  pc('r_never_truth', 'have', 'never once told the truth, not even by accident', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  NP('r_treason_opp', 'My crooked, treasonous opponent', 'opponent', -2, { intensity: 1.6, ceiling: 3 }),
  NP('r_blessed_nation', 'This blessed and chosen nation', 'audience', 2, { topics: ['freedom'], intensity: 1.6, animate: false, ceiling: 3 }),
  // Funny PRIVATE conjunctions — drafted rewards (connectors live only in the contested
  // shared pool otherwise). Score exactly like their plain `conj` counterpart
  // (and=1.25 / logic=1.30 / but=1.40); the verbose wording is the reward. A connector you
  // OWN can't be out-raced, so it's a guaranteed combo-enabler for private-deck builds.
  { id: 'r_conj_honesttruth', role: 'connector', text: 'but to tell the honest truth', conj: 'but' },
  { id: 'r_conj_noonetells', role: 'connector', text: 'but what no one else in this room will tell you is that', conj: 'but' },
  { id: 'r_conj_longstory', role: 'connector', text: 'and so to make a long though quite articulate story short', conj: 'and therefore' },
  { id: 'r_conj_cannotstress', role: 'connector', text: 'because — and I cannot stress this enough —', conj: 'because' },
  { id: 'r_conj_magnificent', role: 'connector', text: "and as if that weren't already magnificent enough", conj: 'and' },
  // Clause-only (conj 'because' → CBEC): must be followed by a full noun–verb clause, e.g.
  // "…is a lizard person which conclusively explains why my opponent naps through meetings".
  { id: 'r_conj_conclusively', role: 'connector', text: 'which conclusively explains why', conj: 'because' },
  // More verbose-wording reward connectors (2026-07) — the flourish is the reward, the
  // multiplier stays tier-matched to the plain conj.
  { id: 'r_conj_writethisdown', role: 'connector', text: 'and — write this down —', conj: 'and' },
  { id: 'r_conj_quotemyself', role: 'connector', text: 'and, if I may quote myself,', conj: 'and' },
  { id: 'r_conj_nightfollows', role: 'connector', text: 'and it therefore follows, as night follows the glorious day, that', conj: 'and therefore' },
  { id: 'r_conj_precisely', role: 'connector', text: 'which is exactly, precisely, and specifically why', conj: 'and therefore' },
  { id: 'r_conj_heartstudy', role: 'connector', text: 'because, according to a study I commissioned in my heart,', conj: 'because' },
  { id: 'r_conj_grandmother', role: 'connector', text: 'because, as my sainted grandmother always screamed,', conj: 'because' },
  { id: 'r_conj_mainstream', role: 'connector', text: "but here's what the mainstream media refuses to print:", conj: 'but' },
  { id: 'r_conj_countryilove', role: 'connector', text: 'but in this country — the country I love —', conj: 'but' },
  { id: 'r_conj_unlikecertain', role: 'connector', text: 'but unlike certain people on this stage,', conj: 'but' },
  { id: 'r_conj_humblest', role: 'connector', text: 'but — and I say this as the humblest person on this stage —', conj: 'but' },
  // Dual-role coordinating parentheticals (moved here from MODIFIERS 2026-07): a subject
  // aside ("My opponent, and I'm not making this up, naps…") that ALSO works as a clause
  // connector. An aside + ×1.25-connector in one slot dominates plain "and", so it's a
  // drafted privilege now, not a shared-pool freebie.
  md('m_trustme', "and trust me, what I'm about to say is absolutely true", 0, { invariant: true, conj: 'and' }),
  md('m_notmakingup', "and I'm not making this up", 0, { invariant: true, conj: 'and' }),

  // Drafted ACTION card (NOT in the default deck — only ever earned as a reward). A revival of
  // the removed "Call a Recess" button: re-deal the contested shared pool. As a one-shot drafted
  // card it sidesteps the old free-button exploit. Lives here, NOT in POWERUPS (which seeds every
  // default deck via buildPrivateDeck); effect handled in game.ts applyPowerup.
  { id: 'r_recess', role: 'powerup', effect: 'redeal', text: '🔄 Call a Recess — re-deal the shared pool' },

  // More headliner nouns/verbs — funnier and higher-scoring than the default deck. ±4 predicates
  // raise the cap (+4); loaded subjects are ×1.6 with a +3 ceiling.
  pc('r_goldtoilet', 'bill', 'the taxpayer for a solid-gold toilet', -4, { pre: 'secretly', topics: ['jackass', 'opponent'], ceiling: 4 }),
  pi('r_popupads', 'personally invented the pop-up ad', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  pc('r_coinslot', 'want', 'to put a coin slot on the Statue of Liberty', -4, { topics: ['jackass', 'opponent', 'freedom'], ceiling: 4 }),
  pi('r_rubber_chicken', 'will personally slap every voter in this audience across the face with a rubber chicken', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  // (r_inventweekend + r_everylaw cut 2026-07 by Daniel's upgrade pass — flat bragging with
  // no comic image; the pass also cut r_m_morse, r_onlycrime_self, r_raccoons_opp, r_crowd_onhold.)
  pc('r_eagle', 'bench-press', 'a full-grown bald eagle before breakfast', 4, { ceiling: 4 }),
  NP('r_weird_opp', 'My deeply weird, poll-tested opponent', 'opponent', -2, { intensity: 1.6, ceiling: 3 }),
  NP('r_scumbag_opp', 'My treasonous and perverted scumbag of an opponent', 'opponent', -2, { intensity: 1.6, ceiling: 3 }),
  NP('r_grill_patriots', 'The hardest-working patriots ever to fire up a backyard grill', 'audience', 2, { topics: ['pander'], intensity: 1.6, ceiling: 3, number: 'plural' }),

  // Promoted to reward-tier (top strength = drafted-only): these were base-pool cards a playtest
  // rated as rank-4 zingers. Moved here at ±4 with a ceiling so the base pool stays capped at ±3
  // and the outrageous lines are something you EARN. (Ids keep their p_ prefix — no rename needed.)
  pc('p_eat_babies', 'eat', 'babies', -4, { pre: 'secretly', topics: ['jackass', 'opponent', 'children'], ceiling: 4 }),
  pc('p_freedom_subscription', 'believe', 'that freedom should have a monthly subscription', -4, { topics: ['jackass', 'opponent', 'freedom'], ceiling: 4 }),
  pi('p_timeshare', 'will sell this country to a Florida timeshare scheme', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  pc('p_ban_happiness', 'have', 'a secret plan to make happiness illegal', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  pi('p_got_ending', 'will fix the ending of Game of Thrones in a way that satisfies everyone', 4, { topics: ['pander'], ceiling: 4 }),
  NP('s_brain', 'My beautiful brain, which many people say is the best brain', 'self', 1, { intensity: 1.6, animate: false, ceiling: 3 }),
  NP('s_genius', 'A stable genius such as myself', 'self', 1, { intensity: 1.6, ceiling: 3 }),

  // New reward-tier cards (playtester-rated rank 4 / most-loaded).
  pc('r_haunted_bus', 'want', 'to replace every school bus with a haunted limousine', -4, { topics: ['jackass', 'opponent', 'children'], ceiling: 4 }),
  pi('r_auction_bor', 'will auction off the Bill of Rights one amendment at a time', -4, { topics: ['jackass', 'opponent', 'freedom'], ceiling: 4 }),
  pc('r_pledge_ads', 'want', 'to put ads in the Pledge of Allegiance', -4, { topics: ['jackass', 'opponent', 'freedom'], ceiling: 4 }),
  pi('r_suplex_inflation', 'will personally suplex inflation through a folding table', 4, { topics: ['economy'], ceiling: 4 }),
  NP('r_crowd_grillmasters', 'This proud nation of grill masters, coupon clippers, and quiet heroes', 'audience', 2, { topics: ['pander'], intensity: 1.6, ceiling: 3, animate: false }),
  NP('r_crowd_ducttape', 'The exhausted patriots currently holding this country together with duct tape', 'audience', 2, { topics: ['pander'], intensity: 1.6, ceiling: 3, number: 'plural' }),
  NP('r_crowd_toosmart', 'This audience of upstanding patriots, each one far too intelligent to be influenced by shameless flattery,', 'audience', 2, { topics: ['pander'], intensity: 1.6, ceiling: 3 }),

  // 2026-07 slate (web-Fable card review): everyday-grievance attacks + absurd-promise brags.
  pc('r_warranty', 'call', "you during dinner about your car's extended warranty", -4, { pre: 'personally', topics: ['jackass', 'opponent'], ceiling: 4 }),
  pi('r_passwords', 'will make every password in America expire daily', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  pc('r_aquariums', 'be', 'banned from three aquariums and will not say why', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  pi('r_pigeon', 'will replace the bald eagle with a pigeon that owes them money', -4, { topics: ['jackass', 'opponent', 'freedom'], ceiling: 4 }),
  pi('r_middleseat', 'invented the middle airplane seat', -4, { topics: ['jackass', 'opponent'], ceiling: 4 }),
  pc('r_resortfee', 'charge', 'a resort fee on the American Dream', -4, { topics: ['jackass', 'opponent', 'economy'], ceiling: 4 }),
  pi('r_printers', 'will sign an executive order forcing every printer in this nation to just work', 4, { topics: ['pander'], ceiling: 4 }),
  pi('r_funeral', 'once received a standing ovation at a funeral', 4, { ceiling: 4 }),
  pi('r_trafficlights', 'will personally time every traffic light to your commute, specifically', 4, { topics: ['pander'], ceiling: 4 }),
  pi('r_badwheel', 'will hunt down and destroy every shopping cart with one bad wheel', 4, { topics: ['pander'], ceiling: 4 }),

  // Reward-tier naming NPs (loaded openers; ×1.6 with a +3 ceiling like the ones above).
  NP('r_coconspirator_opp', 'My unindicted co-conspirator of an opponent', 'opponent', -2, { intensity: 1.6, ceiling: 3 }),
  NP('r_campaign_relatives', 'My campaign, staffed entirely by my most loyal relatives,', 'self', 1, { animate: false, intensity: 1.6, ceiling: 3 }),
  NP('r_crowd_turnsignals', 'The last brave patriots in this country who still use their turn signals', 'audience', 2, { number: 'plural', topics: ['pander'], intensity: 1.6, ceiling: 3 }),

  // Reward-tier ASIDE — a folded-in modifier is worth ~a bonus attack/brag and rides the combo, so a
  // −4 aside (with a ceiling) is a strong, flexible draft (attaches to any subject; direction flips
  // with whom you play it on). The first reward aside — base asides cap at ±3.
  md('r_ff_vomit', 'whose political opinions would make our founding fathers vomit into a house plant', -4, { invariant: true, ceiling: 4 }),
  md('r_m_lawyer', 'whose lawyer is watching this broadcast and quietly weeping', -4, { invariant: true, ceiling: 4 }),
  md('r_m_allegedly', "which I am legally required to describe as 'allegedly'", -4, { invariant: true, ceiling: 4 }),

  // PRIVATE finishers — premium: a guaranteed ×factor you OWN (can't be out-raced in the shared
  // pool the way the pool finishers can). Phrasings author-supplied. (Rendered as a trailing
  // flourish; no baked punctuation — renderSentence adds it.)
  { id: 'r_x_pipe', role: 'intensifier', text: 'put that in your pipe and smoke it', factor: 1.5 },
  { id: 'r_x_idiot', role: 'intensifier', text: 'and anyone who disagrees with that is an idiot', factor: 1.4 },
  { id: 'r_x_votemany', role: 'intensifier', text: 'which is why you should vote for me, as many times as possible', factor: 1.5 },
  { id: 'r_x_science', role: 'intensifier', text: 'and that, my friends, is just basic science', factor: 1.5 },
  { id: 'r_x_polls', role: 'intensifier', text: 'and I have the tremendous poll numbers to prove it', factor: 1.5 },
  { id: 'r_x_nofurther', role: 'intensifier', text: 'No further questions. There were no questions.', factor: 1.5 }, // own-sentence render
  { id: 'r_x_eternal', role: 'intensifier', text: 'My time is up, but my truth is eternal.', factor: 1.5 }, // own-sentence render
  { id: 'r_x_comingfromme', role: 'intensifier', text: "and that's coming from me, so you know it's true", factor: 1.4 },
  { id: 'r_x_sheeple', role: 'intensifier', text: 'Wake up, sheeple. Respectfully.', factor: 1.5 }, // own-sentence render

  // Drafted ACTION card reusing an existing effect (rides run.bonus → private deck → played from
  // hand like any power-up). A privately-owned Typo can't be out-raced in the pool.
  { id: 'r_typo', role: 'powerup', effect: 'typo', text: '🎤 Teleprompter Typo — REPLACE their last word with yours' },
];

// --- upgrade chains (Debate Consultant "Punch Up the Zingers") ----------------
// Authored next-tier versions of deck cards. NEVER in decks/pools/REWARDS drafts —
// reachable only by upgrading, so they must not be added to ALL (buildTutorialPool
// samples ALL and super-cards would leak into the Q1 tutorial pool; findDef gets a
// separate fallback instead). Key = current-tier id, value = the next-tier def, so
// chains compose: UPGRADES['p_fight_bear'] → the _t1 def, UPGRADES['p_fight_bear_t1']
// → the _t2 def. Ids are `<origId>_t1` / `<origId>_t2` — never reuse an existing id.
//
// Stat curve (text must get FUNNIER each tier — the upgrade is a strictly stronger NEW
// joke in the same slot, never the old joke with more words):
//   SIG predicate ±3        → t1 ±4, ceiling 4 (≈ reward tier) → t2 ±5, ceiling 6
//   SIG subject int 1.3     → t1 int 1.6, ceiling 3            → t2 int 1.9, ceiling 5
//   REWARDS pred ±4/ceil 4  → t1 ±5, ceiling 6 → t2 ±6, ceiling 8 (the super-card arc)
//   REWARDS NPs/asides      → no chains yet (see the roadmap backlog note)
// Ceiling is bounded by HEADROOM_MAX in scoring, so no chain can enable a knockout.
// Not every card upgrades — the consultant dialog shows only cards WITH a chain.
export const UPGRADES: Record<string, Card> = {};
/** Register a chain: orig id → tier-1 def → tier-2 def…; stamps `Card.tier` from the
 * position so the +/++ badge can't drift from the chain structure. */
const chain = (origId: string, ...tiers: Card[]): void => {
  let prev = origId;
  for (let i = 0; i < tiers.length; i++) {
    UPGRADES[prev] = { ...tiers[i], tier: i + 1 };
    prev = tiers[i].id;
  }
};
// Attack upgrades keep answering both attack topics, like every insult.
const SMEAR = ['jackass', 'opponent'];

// Chains authored by Daniel (daniel-upgrades.md, 2026-07). The upgrade rule: a strictly
// STRONGER card in the same slot — a brand-new joke that punches harder, never the old
// joke with more words. Cards without a chain simply don't appear in the upgrade dialog.

// --- signature attacks (−3 → −4/ceil 4 → −5/ceil 6; the −2 runs −3 → −4/ceil 4) ---
chain('p_microchip',
  pc('p_microchip_t1', 'want', 'to replace your doctor with a QR code controlled by the deep state', -4, { topics: SMEAR, ceiling: 4 }),
  pi('p_microchip_t2', 'will sell your medical history to three foreign governments and the highest-bidding cereal company', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_llama',
  pc('p_llama_t1', 'launder', 'money through a chain of counterfeit petting zoos', -4, { topics: SMEAR, ceiling: 4 }),
  pc('p_llama_t2', 'be', 'the shadowy kingpin behind every rigged claw machine in America', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_moon',
  pc('p_moon_t1', 'think', 'that birds are a government conspiracy', -4, { topics: SMEAR, ceiling: 4 }),
  pc('p_moon_t2', 'be', 'convinced that the world is flat and the moon is a glow-in-the-dark beach ball', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_crayons',
  pc('p_crayons_t1', 'bring', 'a juice box and a blankie to the Situation Room', -4, { topics: SMEAR, ceiling: 4 }),
  pi('p_crayons_t2', 'lost the nuclear football in a ball pit', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_handshake',
  pc('p_handshake_t1', 'have', 'the deep state on speed dial', -4, { topics: SMEAR, ceiling: 4 }),
  pc('p_handshake_t2', 'host', 'the annual Illuminati holiday party, paid for with your tax dollars', -5, { pre: 'personally', topics: SMEAR, ceiling: 6 }),
);
chain('p_sell_constitution',
  pi('p_sell_constitution_t1', 'would pawn the Liberty Bell to pay off a bar tab', -4, { topics: ['freedom', ...SMEAR], ceiling: 4 }),
  pi('p_sell_constitution_t2', 'once traded the nuclear launch codes to a Nigerian phone scammer in exchange for an expired gift card', -5, { topics: ['freedom', ...SMEAR], ceiling: 6 }),
);
chain('p_dubstep_anthem',
  pc('p_dubstep_anthem_t1', 'want', 'Mount Rushmore recarved to look like their golf buddies', -4, { topics: SMEAR, ceiling: 4 }),
  pi('p_dubstep_anthem_t2', 'will replace every church bell in this fine country with a car alarm', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_big_kale',
  pc('p_big_kale_t1', 'be', 'a wholly owned subsidiary of Big Everything', -4, { topics: SMEAR, ceiling: 4 }),
  pc('p_big_kale_t2', 'be', 'controlled by the fake auto warranty scam email industry', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_magic_eightball',
  pi('p_magic_eightball_t1', 'would pick federal judges by eenie, meenie, minie, moe', -4, { topics: SMEAR, ceiling: 4 }),
  pc('p_magic_eightball_t2', 'make', 'all policy decisions using a pair of dice and a bootleg version of ChatGPT 1.0', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_shrimp_buffet',
  pc('p_shrimp_buffet_t1', 'have', 'the scruples of a payday loan office inside a funeral home', -4, { topics: SMEAR, ceiling: 4 }),
  pc('p_shrimp_buffet_t2', 'have', 'the moral compass of a getaway driver with diplomatic immunity', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_find_economy',
  pi('p_find_economy_t1', "couldn't balance a checkbook with a calculator and divine intervention", -3, { topics: ['economy', ...SMEAR] }),
  pi('p_find_economy_t2', 'once got lost in a revolving door for an entire afternoon', -4, { topics: SMEAR, ceiling: 4 }),
);
chain('p_shoppingcart',
  pc('p_shoppingcart_t1', 'park', 'diagonally across two spaces, on purpose', -4, { topics: SMEAR, ceiling: 4 }),
  pc('p_shoppingcart_t2', 'take', 'phone calls on speakerphone in movie theaters', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_microwavefish',
  pc('p_microwavefish_t1', 'steal', 'coins out of mall fountains', -4, { topics: SMEAR, ceiling: 4 }),
  // ("replies-all" can't conjugate as a lead — "hits reply-all" keeps the joke and inflects cleanly)
  pc('p_microwavefish_t2', 'hit', '"reply all" on company-wide emails just to say "thanks"', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_fridgelunch',
  // (participle instead of a second conjugated verb so first-person self-owns still read right)
  pc('p_fridgelunch_t1', 'take', 'the last cup of coffee, leaving the empty pot on the burner', -4, { topics: SMEAR, ceiling: 4 }),
  pi('p_fridgelunch_t2', 'once stole the office birthday cake and returned the used candles', -5, { topics: SMEAR, ceiling: 6 }),
);

// --- signature brags (+3 → +4/ceil 4 → +5/ceil 6; the +2 runs +3 → +4/ceil 4) ---
chain('p_fight_bear',
  pi('p_fight_bear_t1', 'will personally suplex a grizzly bear to protect our democracy', 4, { ceiling: 4 }),
  pi('p_fight_bear_t2', 'will personally fistfight an asteroid to protect this nation', 5, { ceiling: 6 }),
);
chain('p_lift_boats',
  pc('p_lift_boats_t1', 'deadlift', 'small cars as a warmup', 4, { ceiling: 4 }),
  pi('p_lift_boats_t2', 'once towed a cruise ship into harbor with a jump rope', 5, { ceiling: 6 }),
);
chain('p_phonecall',
  pi('p_phonecall_t1', 'could balance the federal budget on a napkin at Waffle House', 4, { topics: ['economy'], ceiling: 4 }),
  pi('p_phonecall_t2', 'once fixed a recession by glaring at it', 5, { topics: ['economy'], ceiling: 6 }),
);
chain('p_neverwrong',
  pc('p_neverwrong_t1', 'have', 'never lost an argument, a bet, or a game of rock-paper-scissors', 4, { ceiling: 4 }),
  pc('p_neverwrong_t2', 'have', 'been correct about every issue, including several that have not happened yet', 5, { ceiling: 6 }),
);
chain('p_handshake_hair',
  pc('p_handshake_hair_t1', 'have', 'a jawline that has been declared a national landmark', 4, { ceiling: 4 }),
  pc('p_handshake_hair_t2', 'have', 'the handshake of a president, the jawline of a monument, and approval ratings of free pizza on a snow day', 5, { ceiling: 6 }),
);
chain('p_courage',
  pc('p_courage_t1', 'have', 'the courage of a thousand soldiers and the humility to mention it only constantly', 4, { ceiling: 4 }),
  pc('p_courage_t2', 'have', 'the bravery of a warrior and a humility so heroic it should be carved into a mountain', 5, { ceiling: 6 }),
);
chain('p_battery',
  pi('p_battery_t1', 'will direct NASA to make the stars brighter and your cell phone service 20% faster', 4, { ceiling: 4 }),
  pi('p_battery_t2', "will direct our nation's scientists to invent a time machine, travel back to 1984, and convince Van Halen to record a Christmas album", 5, { ceiling: 6 }),
);
chain('p_hurricane',
  pi('p_hurricane_t1', 'once negotiated a ceasefire between two tornadoes', 4, { ceiling: 4 }),
  pi('p_hurricane_t2', 'once ended a drought with a single stern warning', 5, { ceiling: 6 }),
);
chain('p_wallet',
  pi('p_wallet_t1', 'helped an old lady cross eight consecutive streets', 4, { ceiling: 4 }),
  pc('p_wallet_t2', 'have', 'rescued more kittens than a dozen fire departments', 5, { ceiling: 6 }),
);
chain('p_oncegen',
  pc('p_oncegen_t1', 'be', 'the smartest human being currently permitted by law', 3),
  pi('p_oncegen_t2', 'once finished the Sunday crossword in pen, in the rain, in four minutes', 4, { ceiling: 4 }),
);
chain('p_zipcodes',
  pc('p_zipcodes_t1', 'know', "every American's name, birthday, and preferred barbecue sauce", 4, { ceiling: 4 }),
  pc('p_zipcodes_t2', 'be', 'on a first name basis with every bald eagle in the country', 5, { ceiling: 6 }),
);
chain('p_ikea',
  pi('p_ikea_t1', 'once untangled a box of Christmas lights in a single pull', 4, { ceiling: 4 }),
  pc('p_ikea_t2', 'have', 'successfully folded a fitted sheet on more than one occasion', 5, { ceiling: 6 }),
);

// --- signature pander (+3 → +4/ceil 4 → +5/ceil 6; the +2s run +3 → +4/ceil 4) ---
chain('p_free_icecream',
  pi('p_free_icecream_t1', 'will install a soft-serve machine in every home', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_free_icecream_t2', 'will make every meal come with free dessert and no calories', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_tuck_vets',
  pi('p_tuck_vets_t1', 'will hand-write a thank-you note to every teacher in America', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_tuck_vets_t2', 'will personally carry every sleeping child in from the car, forever', 5, { topics: ['children'], ceiling: 6 }),
);
chain('p_golden',
  pi('p_golden_t1', 'will give every household a hot tub and a guy to maintain it', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_golden_t2', 'will give every American a beach house, and the beach', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_highfive',
  // (participle instead of a second conjugated verb so first-person still reads right)
  pc('p_highfive_t1', 'attend', "every American's little-league game, cheering the loudest", 3, { topics: ['pander'] }),
  pc('p_highfive_t2', 'bake', 'a fresh batch of chocolate chip cookies for every voter at least once a month', 4, { topics: ['pander'], ceiling: 4 }),
);
chain('p_christmas3',
  pi('p_christmas3_t1', 'will make Christmas a three-day weekend, four times a year', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_christmas3_t2', 'will add a secret bonus month of paid vacation between July and August', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_birthday',
  pi('p_birthday_t1', 'will make your birthday a federal holiday', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_birthday_t2', 'will guarantee every American one flawless hair day per week', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_naphour',
  pi('p_naphour_t1', 'will mandate hammocks in every workplace', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_naphour_t2', 'will make snoozing your alarm a protected constitutional right', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_wakeup',
  pi('p_wakeup_t1', 'will answer your texts personally, immediately, with punctuation', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_wakeup_t2', 'will help you move, including the couch, and bring the truck', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_monday',
  pi('p_monday_t1', 'will replace Monday and Wednesday with extra Saturdays', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_monday_t2', 'will abolish Monday and replace it with National Weekly Pancake Day', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_refund',
  pi('p_refund_t1', "will erase every late fee you've ever been charged, with interest", 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_refund_t2', 'will give every citizen three wishes and a government-certified loophole', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_dmv',
  pi('p_dmv_t1', 'will make every government form fit on one page, front only', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_dmv_t2', 'will abolish hold music and replace it with a polite and well-spoken human who answers immediately', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_coffeeshop',
  pi('p_coffeeshop_t1', 'will install a personal barista in every kitchen', 3, { topics: ['pander'] }),
  pi('p_coffeeshop_t2', 'will make refills free everywhere, forever', 4, { topics: ['pander'], ceiling: 4 }),
);
chain('p_city_hill',
  pi('p_city_hill_t1', 'will build a shining city on every hill', 4, { topics: ['freedom'], ceiling: 4 }),
  pi('p_city_hill_t2', 'will build so many shining cities on so many hills that our great nation will be visible from outer space', 5, { topics: ['freedom'], ceiling: 6 }),
);
chain('p_points_light',
  pi('p_points_light_t1', 'will add a second moon and fourteen more stars to the night sky', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_points_light_t2', 'will give this nation a second proudly shining sun, just like Tatooine', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_anthemkey',
  pi('p_anthemkey_t1', 'will add an extra verse to the national anthem where America wins even harder', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_anthemkey_t2', 'will make it illegal for weirdo pop stars to add showoff extra notes to the national anthem', 5, { topics: ['pander'], ceiling: 6 }),
);
chain('p_noupdates',
  pi('p_noupdates_t1', 'will make every crosswalk button actually do something', 4, { topics: ['pander'], ceiling: 4 }),
  pi('p_noupdates_t2', 'will require every "unsubscribe" button to actually work, the first time', 5, { topics: ['pander'], ceiling: 6 }),
);

// --- signature subjects (×1.3 → ×1.6/ceil 3 → ×1.9/ceil 5; unloaded → ×1.3 → ×1.6/ceil 3) ---
chain('s_position',
  NP('s_position_t1', 'My position, which is the best position in recorded history,', 'self', 1, { intensity: 1.6, ceiling: 3 }),
);
chain('s_campaign_transparent',
  // (Daniel's line said "My position…" — adapted to the campaign it upgrades; flag for review)
  NP('s_campaign_transparent_t1', 'My campaign, which is objectively perfect and legally beyond criticism,', 'self', 1, { intensity: 1.6, ceiling: 3, animate: false }),
);
chain('s_plan',
  NP('s_plan_t1', 'My plan, which fits on one index card in large, confident letters,', 'self', 1, { intensity: 1.3, animate: false }),
  NP('s_plan_t2', 'My foolproof plan, which history has already endorsed unanimously,', 'self', 1, { intensity: 1.6, ceiling: 3, animate: false }),
);
chain('s_gut',
  NP('s_gut_t1', 'My gut, which outperforms every think tank in this country,', 'self', 1, { intensity: 1.6, ceiling: 3, animate: false }),
  NP('s_gut_t2', 'My flawless instincts, which have repeatedly overruled experts and reality,', 'self', 1, { number: 'plural', intensity: 1.9, ceiling: 5, animate: false }),
);
chain('s_plan_spellcheck',
  NP('s_plan_spellcheck_t1', 'My gorgeous, flag-scented, fully spell-checked plan', 'self', 1, { intensity: 1.6, ceiling: 3, animate: false }),
  NP('s_plan_spellcheck_t2', 'My magnificent, airtight, patriotic, Nobel-prize-ready plan', 'self', 1, { intensity: 1.9, ceiling: 5, animate: false }),
);
chain('s_admin_unhaunted',
  NP('s_admin_unhaunted_t1', 'My administration, which is free of all blemishes, demonic-possession, and acne,', 'self', 1, { intensity: 1.6, ceiling: 3, animate: false }),
  NP('s_admin_unhaunted_t2', 'My administration, certified to be fresh, vibrant, devoid of all blemishes, and 60% scandal-free,', 'self', 1, { intensity: 1.9, ceiling: 5, animate: false }),
);
chain('s_idiot_opp',
  NP('s_idiot_opp_t1', 'My drooling, liberty-despising cretin of an opponent', 'opponent', -2, { intensity: 1.6, ceiling: 3 }),
  NP('s_idiot_opp_t2', 'My brain-dead, flag-burning, malodorous nincompoop of an opponent', 'opponent', -2, { intensity: 1.9, ceiling: 5 }),
);
chain('s_crook_opp',
  NP('s_crook_opp_t1', 'My corrupt and sexually deviant opponent', 'opponent', -2, { intensity: 1.6, ceiling: 3 }),
  NP('s_crook_opp_t2', 'My morally bankrupt, perverted, and foul-smelling opponent', 'opponent', -2, { intensity: 1.9, ceiling: 5 }),
);
chain('s_opp_buffoons',
  NP('s_opp_buffoons_t1', "The treasonous sewer mutants bankrolling my opponent's campaign", 'opponent', -2, { number: 'plural', intensity: 1.6, ceiling: 3 }),
  NP('s_opp_buffoons_t2', 'The writhing nest of grifters, buffoons, and drug-addled miscreants that fund my opponent', 'opponent', -2, { intensity: 1.9, ceiling: 5 }),
);
chain('s_opp_army',
  NP('s_opp_army_t1', "My opponent's jackbooted army of hall monitors and tattletales", 'opponent', -2, { intensity: 1.6, ceiling: 3 }),
  NP('s_opp_army_t2', "My opponent's smug, acne-ridden militia of basement-dwelling reddit moderators", 'opponent', -2, { intensity: 1.9, ceiling: 5 }),
);
chain('s_opp_speechwriters',
  NP('s_opp_speechwriters_t1', "The lobbyists who write my opponent's speeches on the back of donation checks", 'opponent', -2, { number: 'plural', intensity: 1.6, ceiling: 3 }),
  NP('s_opp_speechwriters_t2', 'The corporate parasites remotely operating my opponent like a humanoid disinformation drone', 'opponent', -2, { number: 'plural', intensity: 1.9, ceiling: 5 }),
);
chain('s_opp_personality',
  NP('s_opp_personality_t1', "My opponent's lab-grown personality, assembled entirely from polling data,", 'opponent', -2, { intensity: 1.6, ceiling: 3, animate: false }),
  NP('s_opp_personality_t2', "My opponent's committee-designed, focus-tested, and overly Photoshopped personality", 'opponent', -2, { intensity: 1.9, ceiling: 5, animate: false }),
);
chain('s_proud_nation',
  NP('s_proud_nation_t1', 'This great, proud, undefeated nation', 'audience', 2, { topics: ['freedom'], intensity: 1.6, ceiling: 3, animate: false }),
  NP('s_proud_nation_t2', 'This sacred nation of heroes, legends, and people just like you', 'audience', 2, { topics: ['freedom'], intensity: 1.9, ceiling: 5, animate: false }),
);
chain('s_wonderful_people',
  NP('s_wonderful_people_t1', 'The wonderful, beautiful, criminally underappreciated people of this country', 'audience', 2, { number: 'plural', topics: ['pander'], intensity: 1.6, ceiling: 3 }),
  NP('s_wonderful_people_t2', "The wisest, bravest, best-looking voters on God's green earth", 'audience', 2, { number: 'plural', topics: ['pander'], intensity: 1.9, ceiling: 5 }),
);

// --- signature objects (what open predicates multiply: −2 → −3 → −4/ceil 3; ±3 → ±4/ceil 3 → ±5/ceil 5) ---
chain('o_radical',
  NP('o_radical_t1', 'the treasonous lunatic fringe', 'neutral', -3),
  NP('o_radical_t2', 'the mentally unstable lowlifes on the radical fringe', 'neutral', -4, { number: 'plural', ceiling: 3 }),
);
chain('o_communists',
  NP('o_communists_t1', 'foreign-funded traitors to freedom', 'neutral', -4, { number: 'plural', ceiling: 3 }),
  NP('o_communists_t2', 'corrupt traitorous enemies embedded to destroy this nation from within', 'neutral', -5, { number: 'plural', ceiling: 5 }),
);
chain('o_patriots',
  NP('o_patriots_t1', 'hardworking, flag-waving patriots', 'neutral', 4, { number: 'plural', ceiling: 3 }),
  NP('o_patriots_t2', 'the finest, hardest-working patriots God ever made', 'neutral', 5, { number: 'plural', ceiling: 5 }),
);

// --- default-deck staples (every deck opens with these) ---
chain('s_opp',
  NP('s_opp_t1', 'My spineless, scheming opponent', 'opponent', -2, { intensity: 1.3 }),
  NP('s_opp_t2', 'My treasonous, weasel-hearted disgrace of an opponent', 'opponent', -2, { intensity: 1.6, ceiling: 3 }),
);
chain('s_i',
  NP('s_i_t1', 'I, a humble titan of public service,', 'self', 1, { person: 1, intensity: 1.3 }),
  NP('s_i_t2', 'I, the last honest person alive,', 'self', 1, { person: 1, intensity: 1.6, ceiling: 3 }),
);
chain('o_satan',
  { ...NP('o_satan_t1', 'Satan and all his minions', 'neutral', -4, { number: 'plural', ceiling: 3 }), proper: true },
  { ...NP('o_satan_t2', 'Satan, his minions, and the infernal creature Satan calls for moral guidance', 'neutral', -5, { number: 'plural', ceiling: 5 }), proper: true },
);
chain('o_freedom',
  NP('o_freedom_t1', 'freedom, democracy, and the right to grill', 'neutral', 4, { topics: ['freedom'], ceiling: 3, animate: false }),
  NP('o_freedom_t2', 'freedom, democracy, apple pie, and everything else worth defending', 'neutral', 5, { topics: ['freedom'], ceiling: 5, animate: false }),
);

// --- reward predicates (−4/ceil 4 → −5/ceil 6 → −6/ceil 8 — the super-card arc). The
// remaining reward predicates + all reward subjects/asides have NO chains yet (Daniel ran
// out of steam authoring them — see the roadmap backlog note). ---
chain('r_lizard',
  pc('r_lizard_t1', 'be', 'a space alien sent to destroy our nation from within', -5, { topics: SMEAR, ceiling: 6 }),
  pc('r_lizard_t2', 'be', 'a soulless lizard-centipede hybrid merely disguised as human to trick our fair nation into self-destruction', -6, { topics: SMEAR, ceiling: 8 }),
);
chain('r_christmas',
  pc('r_christmas_t1', 'want', 'to replace Christmas morning with a mandatory tax audit', -5, { topics: SMEAR, ceiling: 6 }),
  pc('r_christmas_t2', 'want', 'to replace Christmas and snow days with tax audits, standardized testing, and boiled Brussels sprouts', -6, { topics: SMEAR, ceiling: 8 }),
);
chain('r_greatest',
  pc('r_greatest_t1', 'be', 'the greatest leader in human history, including several histories yet to be written', 5, { ceiling: 6 }),
  pc('r_greatest_t2', 'be', 'a leader great enough to be added to Mount Rushmore, replacing all four existing faces', 6, { ceiling: 8 }),
);
chain('r_cured',
  pi('r_cured_t1', 'will cure hangnails and the common cold', 5, { ceiling: 6 }),
  pi('r_cured_t2', 'will bring eternal health and happiness to everyone', 6, { ceiling: 8 }),
);
chain('r_pony',
  pi('r_pony_t1', 'will make every citizen independently wealthy', 5, { ceiling: 6 }),
  pi('r_pony_t2', 'will deliver wealth, happiness, and free snow cones to every citizen', 6, { ceiling: 8 }),
);
chain('r_never_truth',
  pi('r_never_truth_t1', "couldn't tell the truth by reading it off a cue card", -5, { topics: SMEAR, ceiling: 6 }),
  pc('r_never_truth_t2', 'be', 'deathly allergic to truth, courage, common decency, and returning shopping carts', -6, { topics: SMEAR, ceiling: 8 }),
);
chain('r_goldtoilet',
  pc('r_goldtoilet_t1', 'use', 'taxpayer money to fly private jets to play mini-golf', -5, { topics: SMEAR, ceiling: 6 }),
  pc('r_goldtoilet_t2', 'flush', 'taxpayer money down a solid-gold toilet while flying private jets to private billionaire-only disc golf tournaments', -6, { topics: SMEAR, ceiling: 8 }),
);
chain('r_popupads',
  pc('r_popupads_t1', 'have', 'a plan to add a tip prompt to grocery store self-checkout stations', -5, { topics: SMEAR, ceiling: 6 }),
  pc('r_popupads_t2', 'have', 'a secret scheme to add an unskippable ad break to the national anthem', -6, { topics: SMEAR, ceiling: 8 }),
);
chain('r_coinslot',
  pi('r_coinslot_t1', 'will put a pop-up ad on the Statue of Liberty', -5, { topics: [...SMEAR, 'freedom'], ceiling: 6 }),
  pi('r_coinslot_t2', "will replace the Statue of Liberty's torch with hamburger from whichever fast food restaurant pays the most bribe money", -6, { topics: [...SMEAR, 'freedom'], ceiling: 8 }),
);
chain('r_rubber_chicken',
  pi('r_rubber_chicken_t1', 'will give a wedgie to every voter in this audience and then slap them across the face with a rubber chicken', -5, { topics: SMEAR, ceiling: 6 }),
  pi('r_rubber_chicken_t2', 'will personally slap every voter across the face with a rubber chicken, make a rude hand gesture, and then fart in their general direction', -6, { topics: SMEAR, ceiling: 8 }),
);
chain('r_eagle',
  pc('r_eagle_t1', 'bench-press', 'two full-grown bald eagles before breakfast', 5, { ceiling: 6 }),
  pc('r_eagle_t2', 'bench-press', 'two full-grown bald eagles before breakfast, while they salute', 6, { ceiling: 8 }),
);
chain('p_freedom_subscription',
  pi('p_freedom_subscription_t1', 'will make constitutional rights an in-app purchase', -5, { topics: [...SMEAR, 'freedom'], ceiling: 6 }),
  pi('p_freedom_subscription_t2', 'will make the Bill of Rights available only as a part of a Disney+ premium subscription bundle', -6, { topics: [...SMEAR, 'freedom'], ceiling: 8 }),
);
chain('p_timeshare',
  pi('p_timeshare_t1', 'will sell our national parks to a self-storage conglomerate', -5, { topics: SMEAR, ceiling: 6 }),
  pi('p_timeshare_t2', "will replace the Statue of Liberty's torch with a rotating casino sign", -6, { topics: SMEAR, ceiling: 8 }),
);
chain('p_ban_happiness',
  pc('p_ban_happiness_t1', 'want', 'to require a permit for birthday parties', -5, { topics: SMEAR, ceiling: 6 }),
);
chain('p_got_ending',
  pi('p_got_ending_t1', 'will fix Daylight Saving Time and the ending of Game of Thrones in a way that satisfies everyone', 5, { topics: ['pander'], ceiling: 6 }),
  pi('p_got_ending_t2', 'will reform Daylight Saving Time, fix the endings of Game of Thrones, Lost, and How I Met Your Mother in a way that satisfies everyone, and produce a new Star Wars trilogy that everyone agrees is awesome', 6, { topics: ['pander'], ceiling: 8 }),
);

export const UPGRADE_DEFS: Card[] = Object.values(UPGRADES);
/** The next-tier def for a card id, if it has one (drives the upgrade UI). */
export function upgradeOf(id: string): Card | undefined {
  return UPGRADES[id];
}
/** Walk `tier` steps up the chain from an ORIGINAL base id (clamps at chain end). */
export function resolveTier(origId: string, tier: number): Card | undefined {
  let def = findDef(origId);
  for (let i = 0; i < tier && def; i++) def = UPGRADES[def.id] ?? def;
  return def;
}

export const ALL: Card[] = [
  ...SUBJECTS,
  ...OBJECTS,
  ...SIG_NPS,
  ...PREDICATES,
  ...MODIFIERS,
  ...REWARDS,
  ...CONNECTORS,
  ...INTENSIFIERS,
  ...POWERUPS,
  ...TOPICS.map((t) => t.card),
];

/** Look up a base card definition by base id (upgraded defs resolve too, but live
 * outside ALL so they never leak into deck building or the tutorial pool). */
export function findDef(baseId: string): Card | undefined {
  return (
    ALL.find((c) => c.id === baseId) ??
    UPGRADE_DEFS.find((c) => c.id === baseId) ??
    (baseId === UNDER_OATH.id ? UNDER_OATH : undefined)
  );
}
