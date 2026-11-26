import { randomInt } from 'node:crypto';

const plantNames = [
  'Alder', 'Aspen', 'Aster', 'Azalea', 'Basil', 'Begonia', 'Birch',
  'Bluebell', 'Camellia', 'Cedar', 'Chrysanthemum', 'Clover', 'Cypress', 'Dahlia',
  'Daisy', 'Elm', 'Fern', 'Fig', 'Fir', 'Gardenia',
  'Ginkgo', 'Hawthorn', 'Hazel', 'Hibiscus', 'Holly', 'Iris', 'Ivy', 'Jasmine',
  'Juniper', 'Lavender', 'Lilac', 'Linden', 'Lotus', 'Magnolia', 'Maple',
  'Marigold', 'Myrtle', 'Oak', 'Olive', 'Orchid', 'Peony', 'Pine', 'Poppy',
  'Redwood', 'Rose', 'Rosemary', 'Sage', 'Sequoia', 'Spruce', 'Sycamore', 'Thyme',
  'Tulip', 'Verbena', 'Violet', 'Willow', 'Wisteria',
];

export function chooseAgentName(used) {
  const available = plantNames.filter((name) => !used.has(name));
  if (available.length) return available[randomInt(available.length)];

  const name = plantNames[randomInt(plantNames.length)];
  let suffix = 2;
  while (used.has(`${name} ${suffix}`)) suffix++;
  return `${name} ${suffix}`;
}
