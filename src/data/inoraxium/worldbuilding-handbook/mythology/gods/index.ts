import { God } from '../../../../../types/mythology';

const humanParent = { id: 'mortal-human', label: 'A Human' };

export const khaos: God = {
  id: 'khaos',
  name: 'Khaos',
  mainTitle: 'One Above All',
  titles: ['Creator of the Cosmos'],
  aliases: [],
  alignment: 'Neutral',
  symbol: '⚡',
  domains: ['All'],
  worshipers: '',
  manifestation: {
    animal: '??',
    monster: '??',
    colors: ['Black'],
  },
  parents: [],
  children: [
    //{ id: 'aphrodite', label: 'Aphrodite' },
  ],
  descriptionFile: 'src/data/inoraxium/worldbuilding-handbook/mythology/khaos.md',
  customFields: [
    //{ key: 'seat', label: 'Seat', value: 'Mount Olympus' },
  ],
};

export const chronos: God = {
  id: 'chronos',
  name: 'Chronos',
  mainTitle: 'The Eternal Architect of Time',
  titles: ['Primordial Deity', 'Creator of Time', 'The First Tick', 'Lord of the Endless Flow'],
  aliases: [],
  alignment: 'Neutral',
  symbol: '⚡',
  domains: ['Time', 'Fate'],
  worshipers: 'Chronomancers',
  manifestation: {
    animal: 'Albino Raven',
    monster: 'Ouroboros Leviathan',
    colors: ['Dust Blue'],
  },
  parents: [],
  children: [
    //{ id: 'aphrodite', label: 'Aphrodite' },
  ],
  descriptionFile: 'src/data/inoraxium/worldbuilding-handbook/mythology/khaos.md',
  customFields: [
    //{ key: 'seat', label: 'Seat', value: 'Mount Olympus' },
  ],
};

export const nyx: God = {
  id: 'nyx',
  name: 'Nyx',
  mainTitle: 'The Infinite Void Mother',
  titles: ['Primordial Deity', 'Creator of Space', 'Mother of the Endless Expanse', 'The Silent Between Stars'],
  aliases: [],
  alignment: 'Neutral',
  symbol: '⚡',
  domains: ['Space', 'Void', 'Darkness', 'Infinity'],
  worshipers: '',
  manifestation: {
    animal: '??',
    monster: '??',
    colors: ['Black'],
  },
  parents: [],
  children: [
    //{ id: 'aphrodite', label: 'Aphrodite' },
  ],
  descriptionFile: 'src/data/inoraxium/worldbuilding-handbook/mythology/khaos.md',
  customFields: [
    //{ key: 'seat', label: 'Seat', value: 'Mount Olympus' },
  ],
};








export const zeus: God = {
  id: 'zeus',
  name: 'Zeus',
  mainTitle: 'King of the Gods',
  titles: ['Lord of the Sky', 'Thunder-Bearer', 'Father of Gods and Men'],
  aliases: ['Olympian King'],
  alignment: 'Chaotic Neutral',
  symbol: '⚡',
  domains: ['Sky', 'Thunder', 'Kingship', 'Law'],
  worshipers: 'Kings, judges, oath-takers, and storm-priests',
  manifestation: {
    animal: 'Eagle',
    monster: 'Thunder Serpent',
    colors: ['Gold', 'White', 'Electric Blue'],
  },
  parents: [],
  children: [
    { id: 'aphrodite', label: 'Aphrodite' },
    { id: 'athena', label: 'Athena' },
    { id: 'artemis', label: 'Artemis' },
    { id: 'apollo', label: 'Apollo' },
    { id: 'ares', label: 'Ares' },
    { id: 'hephaestus', label: 'Hephaestus' },
    { id: 'hermes', label: 'Hermes' },
    { id: 'persephone', label: 'Persephone' },
  ],
  descriptionFile: 'src/data/mythology/zeus.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'Mount Olympus' },
    { key: 'sacredTree', label: 'Sacred Tree', value: 'Oak' },
  ],
};

export const poseidon: God = {
  id: 'poseidon',
  name: 'Poseidon',
  mainTitle: 'Earth-Shaker',
  titles: ['Lord of the Sea', 'Tamer of Horses', 'Breaker of Shores'],
  aliases: ['The Deep King'],
  alignment: 'Chaotic Neutral',
  symbol: '🌊',
  domains: ['Sea', 'Storms', 'Earthquakes', 'Horses'],
  worshipers: 'Sailors, fishermen, riders, and coastal cities',
  manifestation: {
    animal: 'Horse',
    monster: 'Kraken',
    colors: ['Sea Green', 'Blue', 'Bronze'],
  },
  parents: [],
  children: [],
  descriptionFile: 'src/data/mythology/poseidon.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Azure Palace' },
    { key: 'sacredCreature', label: 'Sacred Creature', value: 'Seahorse' },
  ],
};

export const hades: God = {
  id: 'hades',
  name: 'Hades',
  mainTitle: 'Lord of the Underworld',
  titles: ['Keeper of the Dead', 'The Hidden King', 'The Unseen'],
  aliases: ['Plouton'],
  alignment: 'Lawful Neutral',
  symbol: '🝆',
  domains: ['Death', 'Riches', 'Underworld', 'Secrets'],
  worshipers: 'Funeral priests, miners, oath-keepers, grave tenders',
  manifestation: {
    animal: 'Black Dog',
    monster: 'Cerberus',
    colors: ['Obsidian', 'Bone White', 'Deep Violet'],
  },
  parents: [],
  children: [{ id: 'zagreus', label: 'Zagreus' }],
  descriptionFile: 'src/data/mythology/hades.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Black Throne' },
    { key: 'sacredMetal', label: 'Sacred Metal', value: 'Iron' },
  ],
};

export const hera: God = {
  id: 'hera',
  name: 'Hera',
  mainTitle: 'Queen of the Gods',
  titles: ['Lady of Marriage', 'Protector of the Household', 'The Crowned'],
  aliases: ['Juno'],
  alignment: 'Lawful Neutral',
  symbol: '👑',
  domains: ['Marriage', 'Queenship', 'Family', 'Duty'],
  worshipers: 'Queens, brides, matrons, and guardians of the home',
  manifestation: {
    animal: 'Peacock',
    monster: 'Royal Serpent',
    colors: ['Ivory', 'Gold', 'Crimson'],
  },
  parents: [],
  children: [
    { id: 'ares', label: 'Ares' },
    { id: 'hephaestus', label: 'Hephaestus' },
  ],
  descriptionFile: 'src/data/mythology/hera.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Crown Hall' },
    { key: 'sacredBird', label: 'Sacred Bird', value: 'Peacock' },
  ],
};

export const demeter: God = {
  id: 'demeter',
  name: 'Demeter',
  mainTitle: 'Giver of Grain',
  titles: ['Harvest Mother', 'Lady of the Fields', 'The Kindly Earth'],
  aliases: ['Ceres'],
  alignment: 'Neutral Good',
  symbol: '🌾',
  domains: ['Harvest', 'Fertility', 'Agriculture', 'Cycles'],
  worshipers: 'Farmers, bakers, midwives, and rural communities',
  manifestation: {
    animal: 'Hare',
    monster: 'Golden Bull',
    colors: ['Wheat', 'Green', 'Amber'],
  },
  parents: [],
  children: [{ id: 'persephone', label: 'Persephone' }],
  descriptionFile: 'src/data/mythology/demeter.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Golden Reaping Fields' },
    { key: 'sacredPlant', label: 'Sacred Plant', value: 'Barley' },
  ],
};

export const leto: God = {
  id: 'leto',
  name: 'Leto',
  mainTitle: 'Mother of Light',
  titles: ['The Gentle', 'Keeper of Births', 'Hidden Blossom'],
  aliases: ['Latona'],
  alignment: 'Neutral Good',
  symbol: '🌼',
  domains: ['Motherhood', 'Healing', 'Grace', 'Night Travels'],
  worshipers: 'Midwives, travelers, mothers, and healers',
  manifestation: {
    animal: 'Doe',
    monster: 'Moon Doe',
    colors: ['Ivory', 'Moonlight Silver', 'Soft Blue'],
  },
  parents: [],
  children: [
    { id: 'artemis', label: 'Artemis' },
    { id: 'apollo', label: 'Apollo' },
  ],
  descriptionFile: 'src/data/mythology/leto.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Hidden Isle' },
    { key: 'sacredFlower', label: 'Sacred Flower', value: 'White Lily' },
  ],
};

export const aphrodite: God = {
  id: 'aphrodite',
  name: 'Aphrodite',
  mainTitle: 'Lady of Love and Beauty',
  titles: ['Golden Born', 'Mistress of Desire', 'The Fair'],
  aliases: ['Cypris'],
  alignment: 'Chaotic Good',
  symbol: '🩷',
  domains: ['Love', 'Beauty', 'Desire', 'Passion'],
  worshipers: 'Artists, lovers, poets, courtesans, and diplomats',
  manifestation: {
    animal: 'Dove',
    monster: 'Sea-foam Siren',
    colors: ['Rose', 'Pearl', 'Gold'],
  },
  parents: [
    { id: 'zeus', label: 'Zeus' },
    humanParent,
  ],
  children: [{ id: 'eros', label: 'Eros' }],
  descriptionFile: 'src/data/mythology/aphrodite.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Pearl Court' },
    { key: 'sacredPlant', label: 'Sacred Plant', value: 'Myrtle' },
  ],
};

export const athena: God = {
  id: 'athena',
  name: 'Athena',
  mainTitle: 'Goddess of Wisdom and War',
  titles: ['Grey-Eyed', 'Strategos', 'Shield-Bearer'],
  aliases: ['Pallas Athena'],
  alignment: 'Lawful Good',
  symbol: '🦉',
  domains: ['Wisdom', 'War', 'Craft', 'Strategy'],
  worshipers: 'Scholars, generals, artisans, city guardians',
  manifestation: {
    animal: 'Owl',
    monster: 'Armored Gorgon',
    colors: ['Steel', 'Silver', 'Blue'],
  },
  parents: [
    { id: 'zeus', label: 'Zeus' },
    humanParent,
  ],
  children: [],
  descriptionFile: 'src/data/mythology/athena.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Citadel of Thought' },
    { key: 'sacredTree', label: 'Sacred Tree', value: 'Olive' },
  ],
};

export const artemis: God = {
  id: 'artemis',
  name: 'Artemis',
  mainTitle: 'Lady of the Hunt',
  titles: ['Moon Archer', 'Protector of the Wild', 'Swift-footed'],
  aliases: ['Phoebe of the Woods'],
  alignment: 'Chaotic Good',
  symbol: '🏹',
  domains: ['Hunt', 'Moon', 'Wild Places', 'Protection'],
  worshipers: 'Hunters, rangers, children, and those who roam the wilds',
  manifestation: {
    animal: 'Stag',
    monster: 'Moon Hound',
    colors: ['Silver', 'Forest Green', 'Black'],
  },
  parents: [
    { id: 'zeus', label: 'Zeus' },
    { id: 'leto', label: 'Leto' },
  ],
  children: [],
  descriptionFile: 'src/data/mythology/artemis.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Silver Grove' },
    { key: 'sacredAnimal', label: 'Sacred Animal', value: 'Doe' },
  ],
};

export const apollo: God = {
  id: 'apollo',
  name: 'Apollo',
  mainTitle: 'Bringer of Light and Prophecy',
  titles: ['The Far-Shooting God', 'Oracle King', 'Patron of Muses'],
  aliases: ['Phoebus'],
  alignment: 'Lawful Good',
  symbol: '🎼',
  domains: ['Sun', 'Music', 'Prophecy', 'Healing'],
  worshipers: 'Seers, musicians, healers, and temple priests',
  manifestation: {
    animal: 'Swan',
    monster: 'Solar Lion',
    colors: ['Gold', 'White', 'Crimson'],
  },
  parents: [
    { id: 'zeus', label: 'Zeus' },
    { id: 'leto', label: 'Leto' },
  ],
  children: [],
  descriptionFile: 'src/data/mythology/apollo.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Lyre Hall' },
    { key: 'sacredTree', label: 'Sacred Tree', value: 'Laurel' },
  ],
};

export const ares: God = {
  id: 'ares',
  name: 'Ares',
  mainTitle: 'God of War',
  titles: ['Battle Roar', 'The Blooded Spear', 'Lord of Strife'],
  aliases: ['Mars'],
  alignment: 'Chaotic Evil',
  symbol: '🛡️',
  domains: ['War', 'Courage', 'Bloodshed', 'Conflict'],
  worshipers: 'Warriors, mercenaries, gladiators, and raiders',
  manifestation: {
    animal: 'Vulture',
    monster: 'War Hound',
    colors: ['Crimson', 'Iron', 'Black'],
  },
  parents: [
    { id: 'zeus', label: 'Zeus' },
    { id: 'hera', label: 'Hera' },
  ],
  children: [{ id: 'eros', label: 'Eros' }],
  descriptionFile: 'src/data/mythology/ares.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Red Arena' },
    { key: 'sacredAnimal', label: 'Sacred Animal', value: 'Vulture' },
  ],
};

export const hephaestus: God = {
  id: 'hephaestus',
  name: 'Hephaestus',
  mainTitle: 'God of the Forge',
  titles: ['Master Smith', 'The Limping Maker', 'Anvil Lord'],
  aliases: ['Vulcan'],
  alignment: 'Lawful Neutral',
  symbol: '🔨',
  domains: ['Forge', 'Craft', 'Fire', 'Invention'],
  worshipers: 'Blacksmiths, artisans, engineers, and inventors',
  manifestation: {
    animal: 'Ox',
    monster: 'Magma Giant',
    colors: ['Orange', 'Charcoal', 'Copper'],
  },
  parents: [
    { id: 'zeus', label: 'Zeus' },
    { id: 'hera', label: 'Hera' },
  ],
  children: [],
  descriptionFile: 'src/data/mythology/hephaestus.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Great Forge' },
    { key: 'sacredMetal', label: 'Sacred Metal', value: 'Bronze' },
  ],
};

export const hermes: God = {
  id: 'hermes',
  name: 'Hermes',
  mainTitle: 'Messenger of the Gods',
  titles: ['Winged Guide', 'Lord of Roads', 'Clever Tongue'],
  aliases: ['Mercury'],
  alignment: 'Chaotic Good',
  symbol: '🪽',
  domains: ['Travel', 'Messages', 'Thieves', 'Commerce'],
  worshipers: 'Travelers, merchants, heralds, and tricksters',
  manifestation: {
    animal: 'Ram',
    monster: 'Winged Jackal',
    colors: ['Silver', 'Gold', 'White'],
  },
  parents: [
    { id: 'zeus', label: 'Zeus' },
    humanParent,
  ],
  children: [],
  descriptionFile: 'src/data/mythology/hermes.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Road Between Worlds' },
    { key: 'sacredStone', label: 'Sacred Stone', value: 'Boundary Cairn' },
  ],
};

export const eros: God = {
  id: 'eros',
  name: 'Eros',
  mainTitle: 'Spirits of Desire',
  titles: ['Golden Arrow', 'The Stirring Heart', 'Binder of Fates'],
  aliases: ['Cupid'],
  alignment: 'Chaotic Neutral',
  symbol: '🏹💘',
  domains: ['Love', 'Desire', 'Bond', 'Longing'],
  worshipers: 'Lovers, poets, matchmakers, and jealous fools',
  manifestation: {
    animal: 'Sparrow',
    monster: 'Heart-Eater',
    colors: ['Rose', 'Red', 'Pearl'],
  },
  parents: [
    { id: 'aphrodite', label: 'Aphrodite' },
    { id: 'ares', label: 'Ares' },
  ],
  children: [],
  descriptionFile: 'src/data/mythology/eros.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Gallery of First Glances' },
    { key: 'sacredFlower', label: 'Sacred Flower', value: 'Red Rose' },
  ],
};

export const persephone: God = {
  id: 'persephone',
  name: 'Persephone',
  mainTitle: 'Queen of the Underworld',
  titles: ['Spring Maiden', 'The Reborn Bloom', 'Lady of the Dead'],
  aliases: ['Kore'],
  alignment: 'Neutral Good',
  symbol: '🌸',
  domains: ['Spring', 'Fertility', 'Underworld', 'Rebirth'],
  worshipers: 'Mystics, gardeners, initiates, and funerary cults',
  manifestation: {
    animal: 'Pomegranate Dove',
    monster: 'Underworld Queen',
    colors: ['Blossom Pink', 'Pomegranate Red', 'Black'],
  },
  parents: [
    { id: 'zeus', label: 'Zeus' },
    { id: 'demeter', label: 'Demeter' },
  ],
  children: [{ id: 'zagreus', label: 'Zagreus' }],
  descriptionFile: 'src/data/mythology/persephone.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Pomegranate Throne' },
    { key: 'sacredFruit', label: 'Sacred Fruit', value: 'Pomegranate' },
  ],
};

export const zagreus: God = {
  id: 'zagreus',
  name: 'Zagreus',
  mainTitle: 'The Restless Prince',
  titles: ['Child of the Deep Crown', 'The Broken Flame', 'Heir of Two Realms'],
  aliases: ['The Horned One'],
  alignment: 'Chaotic Neutral',
  symbol: '🦌',
  domains: ['Life', 'Death', 'Mystery', 'Rebirth'],
  worshipers: 'Mystery cults, wanderers, and those between worlds',
  manifestation: {
    animal: 'Stag',
    monster: 'Horned Spirit',
    colors: ['Green', 'Crimson', 'Violet'],
  },
  parents: [
    { id: 'hades', label: 'Hades' },
    { id: 'persephone', label: 'Persephone' },
  ],
  children: [],
  descriptionFile: 'src/data/mythology/zagreus.md',
  customFields: [
    { key: 'seat', label: 'Seat', value: 'The Hidden Vine' },
    { key: 'sacredSymbol', label: 'Sacred Symbol', value: 'Horned Crown' },
  ],
};

export const allGods: God[] = [
  khaos,
  chronos,
  nyx,
  /*
  zeus,
  poseidon,
  hades,
  hera,
  demeter,
  leto,
  aphrodite,
  athena,
  artemis,
  apollo,
  ares,
  hephaestus,
  hermes,
  eros,
  persephone,
  zagreus,
  */
];