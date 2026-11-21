// Original placeholder prose for the EPUB fixtures, assembled from hand-written sentence templates.
// Each book gets its own cast, places and chapter titles; the result is readable, not literature.

export interface Voice {
  person: 'third' | 'first';
  hero: string; friend: string; elder: string;
  places: string[]; objects: string[]; sounds: string[]; weathers: string[]; chapters: string[];
  plate: string;
}
export const voices: Record<string, Voice> = {
  Fantasy: { person: 'third', hero: 'Teodora', friend: 'Brannoc', elder: 'Mistress Aldane',
    places: ['the glass quay', 'the Lantern Stair', 'the drowned quarter', 'the cartographers’ hall', 'the old bell tower', 'the salt market'],
    objects: ['a brass compass', 'an unfinished map', 'a lantern of green glass', 'a ring of iron keys', 'a sea-worn ledger', 'a stick of red chalk'],
    sounds: ['the harbour bells', 'gulls over the water', 'the creak of the tide gates', 'the hiss of cooling glass'],
    weathers: ['a thin rain', 'a sea mist', 'a hard, bright wind', 'a low silver fog'],
    chapters: ['The Gate at Low Water', 'Ink and Salt', 'A Street That Was Not There', 'The Cartographers’ Hall', 'Bells in the Fog', 'What the Tide Left', 'The Glass Beneath', 'A New Map'],
    plate: 'A chart of the harbour, drawn in the margins of a ledger' },
  Mystery: { person: 'third', hero: 'Inspector Wren', friend: 'Constable Pardoe', elder: 'Mrs Halloran',
    places: ['the harbour office', 'the Anchor public house', 'the mudflats', 'the clock shop on Quay Street', 'the vicarage garden', 'the railway halt'],
    objects: ['a pocket watch', 'a torn railway ticket', 'a muddy boot print', 'a letter with no signature', 'a jar of seeds', 'a borrowed umbrella'],
    sounds: ['the church clock', 'a dog barking somewhere inland', 'the slap of water on the slipway', 'the last train leaving'],
    weathers: ['a cold drizzle', 'a grey, patient overcast', 'a sharp east wind', 'an unseasonable warmth'],
    chapters: ['A Body on the Flats', 'Questions at the Anchor', 'The Stopped Clocks', 'A Letter Without a Name', 'Bramble Finds Something', 'The Vicar’s Alibi', 'Low Tide Again', 'The Quiet Truth'],
    plate: 'The inspector’s sketch of the harbour, with the tide line marked' },
  'Literary Fiction': { person: 'third', hero: 'Maren', friend: 'her brother Tomas', elder: 'old Ruth',
    places: ['the orchard', 'the packing shed', 'the farmhouse kitchen', 'the lane to the village', 'the long field', 'the cider barn'],
    objects: ['a basket of windfalls', 'her mother’s cardigan', 'a ledger of harvests', 'a cracked teapot', 'a pruning knife', 'a box of letters'],
    sounds: ['wasps in the fallen fruit', 'the kettle starting to sing', 'the gate banging in the wind', 'rooks in the elms'],
    weathers: ['a soft autumn light', 'a heavy dew', 'a sudden shower', 'the first frost'],
    chapters: ['Windfalls', 'The Packing Shed', 'What Ruth Remembered', 'A Letter from the Bank', 'Cider', 'The Long Field', 'First Frost', 'World’s End'],
    plate: 'A plan of the orchard, row by row, in a child’s hand' },
  'Science Fiction': { person: 'third', hero: 'Navigator Kade', friend: 'the ship’s mind, Orrery', elder: 'Captain Imbert',
    places: ['the observation deck', 'the hydroponics bay', 'the long ring corridor', 'the navigation cradle', 'the forward airlock', 'the crew mess'],
    objects: ['a handwritten letter', 'a cracked tablet', 'a cup of reconstituted tea', 'the star charts', 'a sealed crew locker', 'a paper photograph'],
    sounds: ['the hum of the drive', 'the recyclers sighing', 'a soft chime from the comms panel', 'the hull ticking as it cooled'],
    weathers: ['the dim red light of the star', 'a slow solar flare', 'the long night of the far side', 'the glare of a passing moon'],
    chapters: ['Survey Orbit', 'The First Letter', 'Orrery Does Not Know', 'The Locker', 'Red Light', 'A Second Hand', 'The Far Side', 'Small Stars'],
    plate: 'The survey ship’s orbit around the red dwarf' },
  Essays: { person: 'first', hero: 'I', friend: 'a deckhand called Rui', elder: 'the purser',
    places: ['the upper deck', 'a cabin below the waterline', 'the cafeteria', 'the car deck', 'the harbour at dawn', 'the timetable board'],
    objects: ['a paper timetable', 'a thermos of coffee', 'a borrowed blanket', 'a notebook', 'a ticket stub', 'a postcard I never sent'],
    sounds: ['the engines', 'a child laughing two cabins away', 'the tannoy announcing the crossing', 'rope against the bollards'],
    weathers: ['a calm, black sea', 'a swell from the west', 'a crossing in fog', 'a clear night full of stars'],
    chapters: ['On Departures', 'The Cabin', 'Three in the Morning', 'Timetables', 'Strangers', 'The Car Deck', 'Arrivals', 'Going Back'],
    plate: 'The route of the night ferry, with its hours marked' },
  Nature: { person: 'first', hero: 'I', friend: 'my neighbour Ifeoma', elder: 'the old gardener, Mr Pike',
    places: ['the walled garden', 'the potting shed', 'the south border', 'the glasshouse', 'the compost heaps', 'the gate in the wall'],
    objects: ['a trowel with a split handle', 'a packet of seeds', 'a wheelbarrow', 'a notebook of sowing dates', 'a pair of gloves', 'a cutting in a jam jar'],
    sounds: ['a blackbird on the wall', 'rain on the glasshouse roof', 'bees in the lavender', 'the spade ringing on a stone'],
    weathers: ['a late frost', 'a warm, still afternoon', 'a week of rain', 'a sharp blue morning'],
    chapters: ['The Gate in the Wall', 'Clearing', 'Seeds', 'Waiting', 'The Glasshouse', 'Midsummer', 'What Failed', 'The Patient Garden'],
    plate: 'A plan of the walled garden in its first spring' },
};

const thirdPerson = [
  '{hero} crossed {place} as {weather} came in from the sea.',
  'Nobody had told {hero} that {place} would be so quiet at this hour.',
  '{friend} was waiting by the door, holding {object} as if it might break.',
  '“You’re late,” said {friend}, though there was no reproach in it. “I know,” {hero} said. “I wanted to see it once more before the light went.”',
  'Somewhere beyond the rooftops, {sound} marked the hour.',
  'It was {elder} who had first spoken of {place}, years ago, over a supper that went on too long.',
  '{hero} turned {object} over in both hands and found it heavier than it looked.',
  'The light changed, the way it does before {weather}, and the colours of everything grew deeper.',
  'There were questions {hero} had not yet learned how to ask.',
  'For a while neither of them spoke, and the silence felt almost companionable.',
  '{friend} laughed, and the sound carried further than either of them expected.',
  'Later, {hero} would remember this as the moment everything began to move.',
  'A door closed somewhere below, and footsteps went away along {place}.',
  'Under {weather}, the familiar streets looked like a drawing of themselves.',
  'There is a kind of patience that looks, from the outside, exactly like doing nothing.',
  '{hero} made a note of the time, and of {sound}, and of the way the shadows fell.',
  '“Do you trust it?” asked {friend}. “{elder} never did.” “I trust what I can see,” said {hero}, “and I can see more than I could yesterday.”',
  'By the time they reached {place}, {weather} had settled over everything.',
  '{object} lay on the table between them, catching what little light there was.',
  'Small things, {elder} liked to say, are only small until you need them.',
  'The evening went on around them, ordinary and unhurried and full of {sound}.',
  '{hero} slept badly that night and woke with the answer already half-formed.',
  'It was, in the end, a matter of looking at the same thing for long enough.',
  'The tea had gone cold, and neither of them had noticed.',
  '{hero} counted the steps without meaning to: forty-one, the same as always.',
  'From {place} you could see almost the whole of the town, folded around the water.',
  '“We could wait,” {friend} said. “We could always wait.” {hero} only smiled.',
  'The map on the wall had been wrong for years, and everyone had learned to love it anyway.',
  'Rain began, softly, and then all at once.',
  'It is easy to mistake a pause for an ending.',
  '{elder} kept a drawer full of things that might one day be useful, and most of them were.',
  'Outside, {weather} pressed against the windows like something curious.',
  'They walked the long way round, past {place}, because neither of them was ready to arrive.',
  '{friend} had a way of asking questions that made the answers seem obvious afterwards.',
  'Someone had left {object} on the step, and {hero} carried it inside without a word.',
  'The lamps came on one by one along the street.',
  'There was bread, and cheese, and a jar of something sharp and green that nobody could name.',
  '“Tell me again,” said {friend}, “slowly this time.” So {hero} told it again, from the beginning, and this time it sounded almost true.',
  '{hero} had always been better at noticing than at explaining.',
  'By morning the wind had dropped, and the whole world seemed to be holding its breath.',
  'Not everything that is lost wants to be found.',
  'A cart rattled past, loaded with crates that smelled of tar and oranges.',
  'Nobody in {place} remembered who had built it, only that it had always been there.',
  '{hero} wrote three words on the back of an envelope and then crossed out two of them.',
];
const firstPerson = [
  'I went out to {place} early, before {weather} had made up its mind.',
  'There is a particular quiet to {place} at this hour, and I have come to rely on it.',
  '{friend} once told me that nothing worth doing can be rushed, and I am still learning what that means.',
  'I carried {object} with me, mostly out of habit.',
  'Somewhere nearby, {sound} filled the gaps between my thoughts.',
  'I wrote down the date, the weather and the time, and then I simply watched.',
  '{elder} would have laughed at me for standing so long in one place.',
  'It occurs to me that most of what I know, I learned by waiting.',
  'Under {weather}, even the familiar looked newly made.',
  'I have kept notes like these for years, and I rarely read them back.',
  'There is no conclusion here, only a small change in how things look.',
  'People sometimes ask what I am doing out here, and I never have a good answer.',
  'The hours went by more quickly than I expected, the way they do when you stop counting them.',
  'I thought about the people who stood in {place} before me, and the ones who will come after.',
  '{object} has outlasted three of its owners, and will probably outlast me.',
  'I am not sure that patience is a virtue; it may simply be a kind of attention.',
  'By the time I left, {sound} had faded and the light had gone gold.',
  'Some days nothing happens at all, and those are often the days I remember best.',
  'I went back the next morning to see whether anything had changed, and of course it had.',
  'Even now, writing this, I can hear {sound}.',
  'I like the hour before anything is decided.',
  'Someone has carved initials into the rail here; I add nothing, but I read them every time.',
  'I tried to describe this to a friend once and gave up halfway through.',
  'It rained, then stopped, then thought better of stopping.',
  'Nothing here is mine, and that is part of the pleasure.',
  'My notes from that day are mostly lists: colours, sounds, the names of things.',
  'Small certainties are worth keeping, even when the large ones go.',
  'I keep meaning to bring a better coat, and I keep forgetting.',
  '{friend} came by in the afternoon with {object} and a story I had heard before and was glad to hear again.',
  'There is a version of this day that I would have hurried through, and I am glad it was not this one.',
];
function random(seed: number) {
  let state = seed | 0;
  return () => { state = state + 0x6d2b79f5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export interface Chapter { title: string; subheading: string; paragraphs: string[] }
/** Eight chapters of 6–9 paragraphs; the same seed always gives the same text. */
export function writeChapters(voice: Voice, seed: number): Chapter[] {
  const r = random(seed), pick = <T>(items: T[]) => items[Math.floor(r() * items.length)]!;
  const templates = voice.person === 'first' ? firstPerson : thirdPerson;
  const fill = (template: string) => template.replace(/\{(\w+)\}/g, (_, slot: string) => slot === 'hero' ? voice.hero : slot === 'friend' ? voice.friend : slot === 'elder' ? voice.elder
    : slot === 'place' ? pick(voice.places) : slot === 'object' ? pick(voice.objects) : slot === 'sound' ? pick(voice.sounds) : pick(voice.weathers));
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const subheadings = ['Morning', 'Later', 'That Evening', 'The Next Day', 'Afterwards', 'Before Dawn', 'At the Water’s Edge', 'Some Weeks On'];
  return voice.chapters.map((title, index) => {
    // Draw sentences from a shuffled deck so a chapter rarely repeats itself.
    let deck: string[] = [];
    const next = () => { if (!deck.length) deck = [...templates].sort(() => r() - 0.5); return deck.pop()!; };
    const paragraphs = Array.from({ length: 6 + Math.floor(r() * 4) }, () =>
      Array.from({ length: 3 + Math.floor(r() * 3) }, () => capital(fill(next()))).join(' '));
    return { title, subheading: subheadings[(index + Math.floor(r() * 3)) % subheadings.length]!, paragraphs };
  });
}
