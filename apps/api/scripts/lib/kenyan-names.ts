// =============================================================================
// Reference data for the sample-school seed script — constants + tiny pure
// helpers only, no I/O, no Supabase calls. Deliberately kept out of the main
// orchestrator so it's trivially reusable by a future second seed variant.
// =============================================================================
//
// DETERMINISM: every "random" helper here takes an `rng: () => number`
// (range [0,1), same contract as Math.random) rather than calling
// Math.random() itself. The seed script's demo-patterns doc
// (docs/sample-school-demo-patterns.md) names specific students/dates/
// amounts by exact identity — that only stays true across a teardown +
// re-seed cycle (including the 3-cycle live verification this PR itself
// requires) if name/detail generation is 100% reproducible run-to-run.
// createSeededRng() below is a small mulberry32 PRNG seeded with a fixed
// constant — not cryptographically random, not meant to be; the point is
// reproducibility, not unpredictability.

export const SEED_RNG_SEED = 0x53414d504c45; // 'SAMPLE' as hex, arbitrary but fixed

/** mulberry32 — tiny, fast, deterministic PRNG. Same seed -> same sequence, always. */
export function createSeededRng(seed: number = SEED_RNG_SEED): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// -----------------------------------------------------------------------------
// Names — 30 male, 30 female, 40 surnames, spanning Kikuyu, Luo, Luhya,
// Kamba, Kalenjin, Meru, Kisii, Somali, and Coastal/Mijikenda naming
// traditions. Common, well-known Kenyan given/surnames — not sourced from
// or attributed to any specific real individual.
// -----------------------------------------------------------------------------

export const FIRST_NAMES_MALE: readonly string[] = [
  // Kikuyu
  'Njoroge', 'Kamau', 'Mwangi', 'Kariuki', 'Wachira',
  // Luo
  'Otieno', 'Owino', 'Odhiambo', 'Onyango', 'Omondi',
  // Luhya
  'Wafula', 'Simiyu', 'Wanyonyi', 'Barasa', 'Wekesa',
  // Kamba
  'Musyoka', 'Mutua', 'Kioko', 'Mwangangi', 'Ndolo',
  // Kalenjin
  'Kiprotich', 'Kiplagat', 'Kipchoge', 'Kipruto', 'Cheruiyot',
  // Meru
  'Mutuma', 'Kirimi',
  // Kisii
  'Ondieki',
  // Somali
  'Abdi',
  // Coastal / Mijikenda
  'Baraka',
];

export const FIRST_NAMES_FEMALE: readonly string[] = [
  // Kikuyu
  'Wanjiku', 'Njeri', 'Wambui', 'Nyokabi', 'Muthoni',
  // Luo
  'Achieng', 'Adhiambo', 'Awuor', 'Atieno', 'Akinyi',
  // Luhya
  'Nekesa', 'Nafula', 'Naliaka', 'Khaemba', 'Nanjala',
  // Kamba
  'Mwikali', 'Ndinda', 'Mueni', 'Wayua', 'Kanini',
  // Kalenjin
  'Chebet', 'Jepkosgei', 'Cherotich', 'Jepchirchir', 'Chepkoech',
  // Meru
  'Kanana', 'Karimi',
  // Kisii
  'Kemunto',
  // Somali
  'Halima',
  // Coastal / Mijikenda
  'Zawadi',
];

export const SURNAMES: readonly string[] = [
  // Kikuyu
  'Kamau', 'Mwangi', 'Njoroge', 'Kariuki', 'Maina', 'Karanja', 'Gitau', 'Kimani',
  // Luo
  'Odhiambo', 'Otieno', 'Ochieng', 'Owino', 'Onyango', 'Okoth',
  // Luhya
  'Wanyama', 'Wafula', 'Simiyu', 'Barasa', 'Khisa', 'Wanjala',
  // Kamba
  'Kilonzo', 'Mutua', 'Musyoka', 'Mwangangi',
  // Kalenjin
  'Rotich', 'Kiplagat', 'Cheruiyot', 'Kipkoech', 'Too',
  // Meru
  'Mutwiri', 'Kanake',
  // Kisii
  'Ondieki', 'Nyakundi', 'Mogaka',
  // Somali
  'Hassan', 'Mohamed', 'Abdullahi',
  // Coastal / Mijikenda
  'Mwakio', 'Kombe', 'Salim',
];

export type Gender = 'MALE' | 'FEMALE';

export function randomName(gender: Gender, rng: Rng): string {
  return pick(gender === 'MALE' ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE, rng);
}

export function randomSurname(rng: Rng): string {
  return pick(SURNAMES, rng);
}

/** First+surname picked independently — cross-ethnic-group combinations are
 * expected and realistic (intermarriage/name choice diversity), not a bug. */
export function randomFullName(gender: Gender, rng: Rng): { firstName: string; surname: string; fullName: string } {
  const firstName = randomName(gender, rng);
  const surname = randomSurname(rng);
  return { firstName, surname, fullName: `${firstName} ${surname}` };
}

// -----------------------------------------------------------------------------
// Addresses
// -----------------------------------------------------------------------------

export const NAIROBI_NEIGHBORHOODS: readonly string[] = [
  'Kilimani', 'Lavington', 'Karen', 'Runda', 'Westlands', 'Kileleshwa',
  'South B', 'South C', 'Buruburu', 'Umoja', 'Kasarani', 'Ruaraka',
  'Dagoretti', 'Ruiru', 'Kikuyu',
];

export function randomNeighborhood(rng: Rng): string {
  return pick(NAIROBI_NEIGHBORHOODS, rng);
}

// -----------------------------------------------------------------------------
// School name templates — always "TEST — " prefixed so no export/screenshot/
// dashboard listing can ever be mistaken for a real school.
// -----------------------------------------------------------------------------

export const SCHOOL_NAME_TEMPLATES: readonly string[] = [
  'TEST — Kilimani Primary School',
  'TEST — Nyayo Academy Primary',
  'TEST — Riruta Primary School',
  'TEST — Uhuru Gardens Primary School',
  'TEST — Jamhuri Primary School',
  'TEST — Mchanganyiko Primary School',
  'TEST — Tumaini Primary School',
  'TEST — Bright Future Academy Primary',
];

export const DEFAULT_SCHOOL_NAME = SCHOOL_NAME_TEMPLATES[0]!; // "TEST — Kilimani Primary School"

// -----------------------------------------------------------------------------
// Phone numbers
// -----------------------------------------------------------------------------
//
// Phase 1's audit proposed `+254799` as a "reserved for testing" prefix, but
// that claim turned out to be the audit's own hedged guess — no authoritative
// source confirms 0799 is genuinely unallocated (see docs/audits/
// sample-school-seed-plan.md's own "etc. vary" hedge). Phase 2 review flagged
// this and asked for verification; none was found. Switched to this
// codebase's own already-established "obviously fake" range instead —
// +254700000000 through +254700000999 — already used identically by
// packages/db/prisma/seed-data/README.md ("+254700000001, clearly fake") and
// several e2e fixtures.
//
// IMPORTANT: the phone range is defense-in-depth, NOT the primary safety
// mechanism against accidentally sending a real SMS to a seeded number. The
// primary mechanism is that the seed script inserts every `notifications` row
// with `sms_status: 'ABANDONED'` (see lib/seed-content.ts) — the *only* code
// path anywhere in this repo that reads `notifications.sms_status`
// (`NotificationsService.dispatch()`) strictly filters `sms_status='PENDING'`
// at three independent points (fetch filter, app-code re-check, and the
// atomic claim UPDATE), so an `ABANDONED` row is structurally guaranteed
// never to be picked up, regardless of phone number or whether Africa's
// Talking credentials are ever configured in the live deployment.

export const PHONE_PREFIX = '+254700000';

/** Sequential, not RNG-based — guarantees uniqueness across up to 1000 users
 * with zero collision risk, which matters here (users_school_id_phone_key is
 * a real per-school UNIQUE constraint) in a way "realistic-looking random"
 * doesn't need to be. `index` should be a monotonically increasing counter
 * across the whole seed run (0-999). */
export function randomPhone(index: number): string {
  if (index < 0 || index > 999) throw new Error(`randomPhone: index ${index} out of range 0-999`);
  return `${PHONE_PREFIX}${String(index).padStart(3, '0')}`;
}

// -----------------------------------------------------------------------------
// Auth credentials
// -----------------------------------------------------------------------------

export const TEST_EMAIL_DOMAIN = 'example.com';
export const TEST_PASSWORD = 'TestPass2026!';

/** Deterministic, collision-free email — role+index is unique within the run
 * by construction (each role's index counter is never reused). */
export function testEmail(rolePrefix: string, index: number): string {
  return `${rolePrefix}${index}@${TEST_EMAIL_DOMAIN}`;
}
