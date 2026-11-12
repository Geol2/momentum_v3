import { planetPositions } from './planets.mjs'
import { sunDirection, moonState } from './astro.mjs'
const dates = []; for (let y = 2020; y <= 2032; y++) for (const m of [0, 4, 8]) dates.push(new Date(Date.UTC(y, m, 15, 3, 0, 0)))
const out = dates.map((d) => ({ t: d.toISOString(), pl: Object.fromEntries(Object.entries(planetPositions(d)).map(([k, v]) => [k, v.pos])), sun: sunDirection(d), moon: moonState(d).pos, moonKm: moonState(d).distKm }))
console.log(JSON.stringify(out))
