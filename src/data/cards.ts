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
}
const NP = (id: string, text: string, side: Side, sentiment: number, o: NpOpts = {}): Card => ({
  id,
  role: 'np',
  text,
  side,
  sentiment,
  person: o.person ?? 3,
  number: o.number ?? 'sing',
  topics: o.topics,
  intensity: o.intensity,
});

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

// --- subjects (noun phrases with a side) ------------------------------------

export const SUBJECTS: Card[] = [
  NP('s_i', 'I', 'self', 1, { person: 1, topics: ['record'] }),
  NP('s_admin', 'My administration', 'self', 1, { topics: ['record'] }),
  NP('s_record', 'My record', 'self', 1, { topics: ['record'] }),
  NP('s_policies', 'My policies', 'self', 1, { number: 'plural', topics: ['record'] }),
  NP('s_opp', 'My opponent', 'opponent', -1, { topics: ['opponent'] }),
  NP('s_opp_wife', "My opponent's wife", 'opponent', -1, { topics: ['opponent'] }),
  NP('s_opp_donors', "My opponent's donors", 'opponent', -1, { number: 'plural', topics: ['opponent'] }),
  NP('s_career', 'Career politicians', 'opponent', -1, { number: 'plural', topics: ['opponent'] }),
  NP('s_insiders', 'Washington insiders', 'opponent', -1, { number: 'plural', topics: ['opponent'] }),
  NP('s_people', 'The American people', 'audience', 2, { number: 'plural' }),
  NP('s_families', 'Hardworking families', 'audience', 2, { number: 'plural', topics: ['children'] }),
  NP('s_children', 'Our children', 'audience', 2, { number: 'plural', topics: ['children'] }),
  NP('s_nation', 'This great nation', 'audience', 2),
];

// --- objects (noun phrases that fill an open predicate's slot) --------------

export const OBJECTS: Card[] = [
  { ...NP('o_satan', 'Satan', 'neutral', -3), proper: true }, // generic evil — no topic
  NP('o_swamp', 'the swamp', 'neutral', -2, { topics: ['economy'] }),
  NP('o_taxes', 'higher taxes', 'neutral', -2, { number: 'plural', topics: ['economy'] }),
  NP('o_lobbyists', 'shady lobbyists', 'neutral', -2, { number: 'plural', topics: ['economy'] }),
  NP('o_chaos', 'total chaos', 'neutral', -3, { topics: ['security'] }),
  NP('o_freedom', 'freedom and democracy', 'neutral', 3, { topics: ['freedom'] }),
  NP('o_veterans', 'our veterans', 'neutral', 3, { number: 'plural', topics: ['security'] }),
  NP('o_smallbiz', 'small businesses', 'neutral', 2, { number: 'plural', topics: ['economy'] }),
  NP('o_middle', 'the middle class', 'neutral', 2, { topics: ['economy'] }),
  NP('o_borders', 'our borders', 'neutral', 2, { number: 'plural', topics: ['security'] }),
  NP('o_schools', 'our public schools', 'neutral', 2, { number: 'plural', topics: ['children'] }),
  NP('o_constitution', 'the Constitution', 'neutral', 3, { topics: ['freedom'] }),
];

// --- predicates -------------------------------------------------------------

// COMMON predicates — generic "stump speech" material, found only in the shared
// (contested) pool. Mild and serviceable; everyone fights over them.
export const COMMON_PRAISE: Card[] = [
  pc('p_deliver', 'deliver', 'blue skies and happiness', 3),
  pc('p_love_fd', 'love', 'freedom and democracy', 3, { topics: ['freedom'] }),
  pc('p_patriot', 'be', 'a true patriot', 3),
  pc('p_strong', 'be', 'strong and decisive', 2),
  pc('p_standup', 'stand', 'up for the little guy', 2),
  pc('p_protect_vets', 'protect', 'our veterans', 3, { topics: ['security'] }),
  pc('p_cut_taxes', 'cut', 'taxes for working families', 2, { topics: ['economy'] }),
  pi('p_fund_schools', 'will fully fund our schools', 3, { topics: ['children'] }),
  pi('p_defend_liberty', 'will defend our liberty', 3, { topics: ['freedom'] }),
  pi('p_fight_for_you', 'will always fight for you', 2),
  pi('p_have_back', 'will always have your back', 2),
  pi('p_keep_safe', 'will keep this country safe', 3, { topics: ['security'] }),
];

// Every insult also counts for the Name-Calling ('jackass') topic — slinging any
// mud answers "how much does your opponent suck?". (Tag appended below.)
export const COMMON_INSULTS: Card[] = [
  pc('p_kick_pup', 'kick', 'puppies', -2),
  pc('p_eat_babies', 'eat', 'babies', -2, { pre: 'secretly' }),
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
].map((c) => ({ ...c, topics: [...(c.topics ?? []), 'jackass'] }));

// SIGNATURE predicates — punchy, characterful zingers found ONLY in private decks
// (never in the shared pool), grouped by archetype. These are the cards worth
// building a deck around, and they define the opponents' personalities.
export const SIG_BRAG: Card[] = [
  pi('p_fight_bear', 'will personally fight a bear for your freedom', 3),
  pc('p_lift_boats', 'bench-press', 'small fishing boats before breakfast', 3),
  pi('p_phonecall', 'could fix the whole economy with a single phone call', 3, { topics: ['economy'] }),
  pc('p_neverwrong', 'be', 'never wrong about anything, ever', 3),
  pc('p_treasure', 'be', 'frankly a national treasure', 3),
];

export const SIG_ATTACK: Card[] = [
  pc('p_microchip', 'want', 'to put a microchip in your flu shot', -3),
  pc('p_llama', 'run', 'a secret llama-grooming cartel', -3, { pre: 'secretly' }),
  pc('p_moon', 'think', 'the moon landing was filmed in a Denny’s', -3),
  pc('p_crayons', 'eat', 'crayons at cabinet meetings', -3),
  pc('p_handshake', 'have', 'a secret handshake with the deep state', -3),
  pi('p_timeshare', 'will sell this country to a Florida timeshare scheme', -3),
].map((c) => ({ ...c, topics: [...(c.topics ?? []), 'jackass'] })); // smears answer Name-Calling

export const SIG_PANDER: Card[] = [
  pi('p_free_icecream', 'will deliver free ice cream every Friday', 3),
  pc('p_tuck_vets', 'tuck', 'in every veteran at night', 3, { topics: ['security'] }),
  pi('p_golden', 'will give every family a golden retriever', 3),
  pc('p_highfive', 'high-five', 'every single voter personally', 2),
];

// SIGNATURE noun phrases — flavorful openers/objects, private decks only.
export const SIG_SUBJ_BRAG: Card[] = [
  NP('s_position', 'My position, which is the best position believe me,', 'self', 1, { intensity: 1.3 }),
  NP('s_genius', 'A stable genius such as myself', 'self', 1, { intensity: 1.3 }),
];
export const SIG_SUBJ_ATTACK: Card[] = [
  NP('s_idiot_opp', 'My idiot freedom-hating opponent', 'opponent', -2, { topics: ['opponent'], intensity: 1.3 }),
  NP('s_crook_opp', 'My crooked, do-nothing opponent', 'opponent', -2, { topics: ['opponent'], intensity: 1.3 }),
];
export const SIG_SUBJ_PANDER: Card[] = [
  NP('s_proud_nation', 'This great and proud nation', 'audience', 2, { intensity: 1.3 }),
  NP('s_wonderful_people', 'The wonderful, beautiful people of this country', 'audience', 2, { number: 'plural', intensity: 1.3 }),
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
];

export const PREDICATES: Card[] = [
  ...COMMON_PRAISE,
  ...COMMON_INSULTS,
  ...SIG_BRAG,
  ...SIG_ATTACK,
  ...SIG_PANDER,
  ...OPEN_PREDS,
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

// --- intensifiers (finishers) -----------------------------------------------

// One-shot action cards (not part of the sentence). Played from the hand.
export const POWERUPS: Card[] = [
  { id: 'pw_search', role: 'powerup', effect: 'search', text: '📋 Search Notes (draw 5)' },
  { id: 'pw_typo', role: 'powerup', effect: 'typo', text: "🎤 Teleprompter Typo (jam the opponent's line)" },
  { id: 'pw_forgot', role: 'powerup', effect: 'forgot', text: "🧠 Forgot My Line (knock the opponent's last word off)" },
  { id: 'pw_soundbite', role: 'powerup', effect: 'soundbite', text: '👏 Soundbite (next statement ×1.5)' },
  { id: 'pw_plant', role: 'powerup', effect: 'plant', text: '🕵️ Plant in the Audience (reveal the crowd)' },
  { id: 'pw_hotmic', role: 'powerup', effect: 'hotmic', text: '🎙️ Hot Mic (see their hand, steal a card)' },
  { id: 'pw_filibuster', role: 'powerup', effect: 'filibuster', text: '🗣️ Filibuster (stock up on connectors)' },
];

export const INTENSIFIERS: Card[] = [
  { id: 'x_guarantee', role: 'intensifier', text: 'and I personally guarantee it', factor: 1.5 },
  { id: 'x_everyone', role: 'intensifier', text: 'and everyone knows it', factor: 1.5 },
  { id: 'x_believe', role: 'intensifier', text: 'believe me', factor: 1.4 },
  { id: 'x_record', role: 'intensifier', text: 'and that is on the record', factor: 1.4 },
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
  { id: 'jackass', label: 'Name-Calling', card: tPred('jackass', -3, { lead: 'be', post: 'an unscrupulous jackass' }), questions: [
    'Just how much does your opponent suck?',
    'Insult your opponent. We’ll wait.',
    'How big a jerk is your opponent, exactly?',
    "Don't be polite — roast your opponent.",
    'Gloves off: what do you REALLY think of your opponent?',
  ] },
];

// Named opponents, each with a fixed debating style (and a style-tuned deck).
export const OPPONENTS: Opponent[] = [
  { id: 'pander', name: 'Gov. Patty Pander', style: 'pander' },
  { id: 'blowhard', name: 'Senator Blowhard', style: 'brag' },
  { id: 'passer', name: 'Mayor Buck Passer', style: 'pander' },
  { id: 'smearwell', name: 'Rep. Dirk Smearwell', style: 'attack' },
  { id: 'slander', name: 'Justice Vera Slander', style: 'attack' },
  { id: 'grandstand', name: 'Maximilian Q. Grandstand III', style: 'brag' },
];

/**
 * The campaign ladder: a sequence of opponents of rising difficulty. Beat one to
 * earn a reward card and climb to the next; lose and the run ends. `maxExtend`
 * tunes how long/combo-heavy each opponent's statements get.
 */
export const LADDER: { opponentId: string; maxExtend: number }[] = [
  { opponentId: 'pander', maxExtend: 3 },
  { opponentId: 'blowhard', maxExtend: 3 },
  { opponentId: 'passer', maxExtend: 4 },
  { opponentId: 'smearwell', maxExtend: 4 },
  { opponentId: 'slander', maxExtend: 5 },
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
  pc('r_traitor', 'be', 'a traitor to this very nation', -4),
  pc('r_lizard', 'be', 'secretly a lizard person', -4),
  pi('r_christmas', 'wants to cancel Christmas forever', -4),
  pc('r_eatpup', 'eat', 'live puppies on national television', -4),
  pc('r_greatest', 'be', 'the greatest leader in human history', 4),
  pi('r_cured', 'personally cured a deadly disease last Tuesday', 4),
  pi('r_pony', 'will give every citizen a pony and a tax cut', 4),
  pc('r_oncegen', 'be', 'a once-in-a-generation genius', 4),
  NP('r_treason_opp', 'My crooked, treasonous opponent', 'opponent', -2, { topics: ['opponent'], intensity: 1.6 }),
  NP('r_blessed_nation', 'This blessed and chosen nation', 'audience', 2, { intensity: 1.6 }),
];

export const ALL: Card[] = [
  ...SUBJECTS,
  ...OBJECTS,
  ...SIG_NPS,
  ...PREDICATES,
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
