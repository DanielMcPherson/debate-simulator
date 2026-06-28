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
  };
};

interface PredExtra {
  pre?: string;
  topics?: string[];
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
});
/** Closed, invariant predicate (modal/negated phrasings work for any subject). */
const pi = (id: string, text: string, sentiment: number, e: PredExtra = {}): Card => ({
  id,
  role: 'predicate',
  text,
  invariant: true,
  sentiment,
  topics: e.topics,
});
/** Open predicate: needs an object; polarity = deed + affinity × object sentiment. */
const po = (
  id: string,
  lead: string,
  post: string,
  affinity: number,
  deed: number,
  e: PredExtra = {},
): Card => ({ id, role: 'predicate', open: true, lead, post, affinity, deed, pre: e.pre, topics: e.topics });

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
  e: { lead?: string; pre?: string; rel?: 'who' | 'which'; topics?: string[]; invariant?: boolean } = {},
): Card =>
  e.invariant
    ? { id, role: 'modifier', text: post, invariant: true, sentiment, topics: e.topics } // `post` carries the full phrase incl. its pronoun
    : { id, role: 'modifier', lead: e.lead ?? 'be', post, pre: e.pre, sentiment, rel: e.rel, topics: e.topics };

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
  NP('s_admin_normal', 'My totally normal administration', 'self', 1, { animate: false }),
  NP('s_campaign_legal', 'My beautiful and completely legal campaign', 'self', 1, { animate: false }),
  NP('s_opp_team', "My opponent's team of untrustworthy weirdos", 'opponent', -1),
  NP('s_people_brave', 'The brave people watching this debate', 'audience', 2, { number: 'plural', topics: ['pander'] }),
  NP('s_people_normal', 'The deeply normal and not-at-all-angry people of this country', 'audience', 2, { number: 'plural', topics: ['pander'] }),
  NP('s_children_screen', 'Our screen-addicted but still precious children', 'audience', 2, { number: 'plural', topics: ['children'] }),
  NP('s_handshake', 'My famously firm handshake', 'self', 1, { animate: false }),
  NP('s_commonsense', 'My award-winning common sense', 'self', 1, { animate: false }),
  NP('s_opp_friends', "My opponent's mysterious offshore friends", 'opponent', -1, { number: 'plural' }),
  NP('s_opp_list', "My opponent's entirely imaginary list of accomplishments", 'opponent', -1, { animate: false }),
  NP('s_goodpeople', 'The good people who actually showed up tonight', 'audience', 2, { number: 'plural', topics: ['pander'] }),
  NP('s_smalltowns', 'Our tired but unbeaten small towns', 'audience', 2, { number: 'plural', topics: ['pander'], animate: false }),
  NP('s_country_flaws', 'This beautiful country, flaws and all', 'audience', 2, { topics: ['freedom'], animate: false }),
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
  pc('p_deliver', 'deliver', 'blue skies and happiness', 3),
  pc('p_love_fd', 'love', 'freedom and democracy', 3, { topics: ['freedom'] }),
  pc('p_patriot', 'be', 'a true patriot', 3),
  pc('p_strong', 'be', 'strong and decisive', 2),
  pc('p_standup', 'stand', 'up for the little guy', 2, { topics: ['pander'] }),
  pc('p_protect_vets', 'protect', 'our veterans', 3, { topics: ['security'] }),
  pc('p_cut_taxes', 'cut', 'taxes for working families', 2, { topics: ['economy'] }),
  pi('p_fund_schools', 'will fully fund our schools', 3, { topics: ['children'] }),
  pi('p_defend_liberty', 'will defend our liberty', 3, { topics: ['freedom'] }),
  pi('p_fight_for_you', 'will always fight for you', 2, { topics: ['pander'] }),
  pi('p_have_back', 'will always have your back', 2, { topics: ['pander'] }),
  pi('p_keep_safe', 'will keep this country safe', 3, { topics: ['security'] }),
  pc('p_read_constitution', 'have', 'read every single word of the Constitution and loved all of it', 3, { topics: ['freedom'] }),
];

// Every insult answers BOTH attack topics — Name-Calling ('jackass') and Your
// Opponent ('opponent'): slinging mud IS the worst-thing-about-them. (Tags appended
// below; de-duped so a topical insult like p_raise_taxes keeps 'economy' too.)
export const COMMON_INSULTS: Card[] = [
  pc('p_kick_pup', 'kick', 'puppies', -2),
  pc('p_eat_babies', 'eat', 'babies', -2, { pre: 'secretly', topics: ['children'] }), // a child-harm, like cancelling school lunch
  pc('p_lie', 'lie', 'to your face', -2),
  pc('p_disgrace', 'be', 'a national disgrace', -3),
  pc('p_weak', 'be', 'weak and out of touch', -2),
  pc('p_jackass', 'be', 'an unscrupulous jackass', -3),
  pc('p_raise_taxes', 'want', 'to raise your taxes', -2, { topics: ['economy'] }),
  pc('p_cut_lunch', 'want', 'to cancel school lunch', -2, { topics: ['children'] }),
  pc('p_silence', 'want', 'to silence free speech', -2, { topics: ['freedom'] }),
  pc('p_worship', 'worship', 'Satan', -3), // generic smear → Name-Calling only (jackass via map)
  pc('p_ignore_vets', 'ignore', 'our veterans', -2, { topics: ['security'] }),
  pi('p_cant_trust', "can't be trusted", -2),
  pi('p_say_anything', 'will say anything to get elected', -2),
  pi('p_destroy_country', 'will destroy this country', -3),
  pi('p_ashamed', 'should be ashamed', -2),
  pc('p_tax_christmas', 'want', 'to tax your Christmas presents', -2, { topics: ['economy', 'children'] }),
  pc('p_tollbooth', 'want', 'to put a toll booth on your driveway', -2, { topics: ['economy'] }),
  pc('p_freedom_subscription', 'believe', 'that freedom should have a monthly subscription', -2, { topics: ['freedom'] }),
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
  pc('p_treasure', 'be', 'frankly a national treasure', 3),
  pc('p_handshake_hair', 'have', 'the handshake of a champion and the hair of a statesman', 3),
  pc('p_courage', 'have', 'the courage of ten senators and the humility of eleven', 3),
  pi('p_battery', "will direct our nation's scientists to make the last 10% of a phone battery last longer", 3),
  pi('p_hurricane', 'once talked a hurricane into changing course', 3),
  pi('p_wallet', 'personally returned a lost wallet on live television', 3),
];

export const SIG_ATTACK: Card[] = [
  pc('p_microchip', 'want', 'to put a microchip in your flu shot', -3),
  pc('p_llama', 'run', 'a secret llama-grooming cartel', -3, { pre: 'secretly' }),
  pc('p_moon', 'think', 'the moon landing was filmed in a Denny’s', -3),
  pc('p_crayons', 'eat', 'crayons at cabinet meetings', -3),
  pc('p_handshake', 'have', 'a secret handshake with the deep state', -3),
  pi('p_timeshare', 'will sell this country to a Florida timeshare scheme', -3),
  pi('p_sell_constitution', 'would sell the Constitution for airline miles', -3, { topics: ['freedom'] }),
  pc('p_dubstep_anthem', 'want', 'to replace the national anthem with screechy dubstep noises', -3),
  pc('p_big_kale', 'take', 'marching orders from Big Kale', -3),
  pc('p_magic_eightball', 'want', 'to replace the Supreme Court with a Magic Eight Ball', -3),
  pc('p_ban_happiness', 'have', 'a secret plan to make happiness illegal', -3),
  pi('p_find_economy', "couldn't find the economy with both hands and a map", -3, { topics: ['economy'] }),
].map((c) => ({ ...c, topics: [...new Set([...(c.topics ?? []), 'jackass', 'opponent'])] })); // smears answer Name-Calling + Your Opponent

export const SIG_PANDER: Card[] = [
  pi('p_free_icecream', 'will deliver free ice cream every Friday', 3, { topics: ['pander'] }),
  pc('p_tuck_vets', 'tuck', 'in every veteran at night', 3, { topics: ['security'] }),
  pi('p_golden', 'will give every family a golden retriever', 3, { topics: ['pander'] }),
  pc('p_highfive', 'high-five', 'every single voter personally', 2, { topics: ['pander'] }),
  pi('p_christmas3', 'will add three more Christmases to the national calendar', 3, { topics: ['pander'] }),
  pi('p_birthday', 'will fight to ensure that every birthday feels special', 3, { topics: ['pander'] }),
  pi('p_naphour', 'will establish a national nap hour for hardworking Americans', 2, { topics: ['pander'] }),
  pc('p_wakeup', 'wake', 'up every morning thinking about you, specifically', 2, { topics: ['pander'] }),
  pi('p_monday', 'will make Monday a second Saturday', 3, { topics: ['pander'] }),
  pi('p_refund', 'will personally refund your last parking ticket', 2, { topics: ['pander'] }),
  pc('p_dmv', 'promise', 'shorter lines at the DMV, forever', 2, { topics: ['pander'] }),
  pi('p_coffeeshop', 'will put a coffee shop on every single corner', 2, { topics: ['pander'] }),
];

// SIGNATURE noun phrases — flavorful openers/objects, private decks only.
export const SIG_SUBJ_BRAG: Card[] = [
  NP('s_position', 'My position, which is the best position believe me,', 'self', 1, { intensity: 1.3 }),
  NP('s_genius', 'A stable genius such as myself', 'self', 1, { intensity: 1.3 }),
  NP('s_brain', 'My beautiful brain, which many people say is the best brain', 'self', 1, { intensity: 1.3, animate: false }),
  NP('s_campaign_transparent', 'My incredibly well-organized and financially transparent campaign', 'self', 1, { intensity: 1.3, animate: false }),
  NP('s_plan', 'My plan, which fits neatly on a single index card', 'self', 1, { animate: false }),
  NP('s_gut', 'My gut, which has frankly never once been wrong', 'self', 1, { intensity: 1.3, animate: false }),
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
  md('m_crook', 'as crooked as the day is long', -2, { rel: 'who' }),
  md('m_liar', 'constantly', -2, { lead: 'lie', rel: 'who' }), // "who lies constantly"
  md('m_disaster', 'a total disaster', -3, { rel: 'which' }),
  md('m_treasure', 'frankly a national treasure', 3, { rel: 'who' }),
  md('m_genius', 'an absolute genius', 3, { rel: 'who' }),
  md('m_loves_country', 'this country', 2, { lead: 'love', rel: 'who' }), // "who loves this country"
  md('m_blessing', 'a blessing to us all', 3, { rel: 'which' }),
  md('m_stupidest', 'among the stupidest humans to ever walk the Earth', -3, { rel: 'who' }),
  md('m_smells', 'even worse than expected', -2, { lead: 'smell', pre: 'somehow', rel: 'who' }), // "who somehow smells…"
  md('m_lostit', 'who, and I say this with love, has completely lost it', -2, { invariant: true }),
  // good
  md('m_better', 'frankly never looked better', 2, { lead: 'have', rel: 'who' }), // "who has frankly never looked better"
  md('m_winning', 'winning by every available metric', 2, { rel: 'who' }),
  md('m_triumph', 'which the experts are reportedly calling a triumph', 2, { invariant: true }),
  // bad
  md('m_catbox', 'like a goat vomited into an overfilled catbox', -3, { lead: 'smell', pre: 'frankly', rel: 'which' }),
  md('m_park', 'who cannot parallel park to save their life', -2, { invariant: true }),
  // neutral (0): pure flavor + a waiting move; never angers the crowd, never helps the score
  md('m_tape', 'which is, between us, mostly held together with tape', 0, { invariant: true }),
  md('m_trustme', "and trust me, what I'm about to say is absolutely true", 0, { invariant: true }),
  md('m_notmakingup', "and I'm not making this up", 0, { invariant: true }),
];

// --- connectors -------------------------------------------------------------

export const CONNECTORS: Card[] = [
  { id: 'c_and', role: 'connector', text: 'and', conj: 'and' },
  { id: 'c_but', role: 'connector', text: 'but', conj: 'but' },
  { id: 'c_because', role: 'connector', text: 'because', conj: 'because' },
  { id: 'c_therefore', role: 'connector', text: 'and therefore', conj: 'and therefore' },
  { id: 'c_which', role: 'connector', text: 'which is why', conj: 'and therefore' },
  { id: 'c_frankly', role: 'connector', text: 'and frankly', conj: 'and therefore' },
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
  { id: 'pw_soundbite', role: 'powerup', effect: 'soundbite', text: '👏 Soundbite — your next statement ×1.5' },
  { id: 'pw_plant', role: 'powerup', effect: 'plant', text: '🕵️ Plant in the Audience — reveal the crowd' },
  { id: 'pw_hotmic', role: 'powerup', effect: 'hotmic', text: '🎙️ Hot Mic — see their hand, steal a card' },
  { id: 'pw_filibuster', role: 'powerup', effect: 'filibuster', text: '🗣️ Filibuster — stock up on connectors' },
];

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
  pc('r_traitor', 'be', 'a traitor to this very nation', -4, { topics: ['jackass', 'opponent'] }),
  pc('r_lizard', 'be', 'secretly a lizard person', -4, { topics: ['jackass', 'opponent'] }),
  pi('r_christmas', 'wants to cancel Christmas forever', -4, { topics: ['jackass', 'opponent'] }),
  pc('r_eatpup', 'eat', 'live puppies on national television', -4, { topics: ['jackass', 'opponent'] }),
  pc('r_greatest', 'be', 'the greatest leader in human history', 4),
  pi('r_cured', 'personally cured a deadly disease last Tuesday', 4),
  pi('r_pony', 'will give every citizen a pony and a tax cut', 4),
  pc('r_oncegen', 'be', 'a once-in-a-generation genius', 4),
  pc('r_never_truth', 'have', 'never once told the truth, not even by accident', -4, { topics: ['jackass', 'opponent'] }),
  NP('r_treason_opp', 'My crooked, treasonous opponent', 'opponent', -2, { intensity: 1.6 }),
  NP('r_blessed_nation', 'This blessed and chosen nation', 'audience', 2, { topics: ['freedom'], intensity: 1.6, animate: false }),
];

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

/** Look up a base card definition by base id. */
export function findDef(baseId: string): Card | undefined {
  return ALL.find((c) => c.id === baseId);
}
