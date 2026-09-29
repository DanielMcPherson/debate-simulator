import type { Card } from '../engine/types';

// GAME-NAME COUPLING: the "That's the Name of the Game!" easter-egg award keys off the game's
// title, "My Opponent Kicks Puppies". If the game is ever renamed, delete this module and its
// `fire()` call in main.ts. `p_kick_pup` must stay in the SHARED pool (buildSharedDeck).
const KICK_PUPPIES = 'p_kick_pup';

/** True for any singular opponent subject that is, word-for-word, some flavor of "my opponent":
 *  the plain staple, its upgrade tiers, and loaded variants like "My crooked, do-nothing
 *  opponent" or "…cretin of an opponent". Keyed off TEXT (not id) so upgraded tiers and future
 *  cards qualify automatically; "My opponent's wife" / "…my opponent's campaign" don't. */
function isOpponentSubject(c: Card): boolean {
  return c.role === 'np' && c.side === 'opponent' && c.number !== 'plural' && /\bopponent$/i.test((c.text ?? '').trim());
}

/** Does this statement say the game's name? One clause: an "…opponent" subject, optional
 *  asides ("My opponent, and I'm not making this up, kicks puppies"), "kicks puppies", and an
 *  optional finisher. Anything else (a second clause, an object, a compound subject) dilutes
 *  the title and doesn't count. */
export function isNameOfTheGame(line: Card[], grammatical: boolean): boolean {
  if (!grammatical || line.length < 2) return false;
  let i = 0;
  if (!isOpponentSubject(line[i++])) return false;
  while (i < line.length && line[i].role === 'modifier') i++;
  if (line[i]?.id.split('#')[0] !== KICK_PUPPIES) return false;
  i++;
  if (line[i]?.role === 'intensifier') i++;
  return i === line.length;
}
