// The community key (spec 024 FR-548): the lowercase hexadecimal SHA-256 of the Discord server id (its decimal text, ASCII). It is computed
// here and only the key leaves the bot: the server never learns the raw id. The same server always gives the same key, in any bot
// version. The key is an identifier, not anonymity: whoever knows the server id can compute it.
import { createHash } from 'node:crypto';

export const communityKey = (guildId: string): string => createHash('sha256').update(guildId, 'ascii').digest('hex');
