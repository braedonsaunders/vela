/**
 * App Store Connect for TestFlight (tools/testflight.sh calls this; it can also run alone):
 *
 *   bun tools/release/asc.ts setup                      bundle ID, app record check, beta groups, test information
 *   bun tools/release/asc.ts next-build <version>       the next build number for <version> (both platforms)
 *   bun tools/release/asc.ts distribute <version> <build> [--platform IOS|TV_OS]... [--whats-new <file>] [--internal-only]
 *                                                        wait for processing, then internal + public testing
 *   bun tools/release/asc.ts status [<version>]         builds, review states and the public link
 *   bun tools/release/asc.ts key-file                   write the .p8 for xcodebuild; print its path, key ID, issuer
 *
 * Credentials come from the environment (tools/testflight.sh loads ~/.config/vela-release/asc.env):
 * ASC_ISSUER_ID, ASC_KEY_ID and ASC_PRIVATE_KEY (the .p8 text) or ASC_KEY_PATH. Test information that
 * is personal (review contact, reviewer sign-in, internal testers) comes from
 * ~/.config/vela-release/testflight.env; tools/testflight/beta.json holds the public text.
 * Nothing here prints a credential.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const app = JSON.parse(readFileSync(join(root, 'apps/vela/app.json'), 'utf8')).expo;
const bundleId: string = app.ios.bundleIdentifier;
const beta = JSON.parse(readFileSync(join(root, 'tools/testflight/beta.json'), 'utf8'));
const INTERNAL_GROUP = 'Vela team', PUBLIC_GROUP = 'Public';

/** A dotenv file: KEY=value, KEY="value" (which may span lines, or use \\n) or KEY='value'. */
function readEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  const text = readFileSync(file, 'utf8');
  const pattern = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\n]*))/gm;
  for (const m of text.matchAll(pattern)) {
    out[m[1]] = m[2] !== undefined ? m[2].replace(/\\n/g, '\n').replace(/\\(["\\$`])/g, '$1') : m[3] ?? m[4].trim();
  }
  return out;
}
const releaseDir = join(homedir(), '.config/vela-release');
// The API key: the environment wins over asc.env.
for (const [name, value] of Object.entries(readEnv(join(releaseDir, 'asc.env')))) {
  if (name.startsWith('ASC_') && !process.env[name]) process.env[name] = value;
}

/** Writes the .p8 for xcodebuild (mode 0600, beside asc.env) and prints its path, the key ID and the issuer. */
function keyFile() {
  const keyId = process.env.ASC_KEY_ID, issuer = process.env.ASC_ISSUER_ID;
  if (!keyId || !issuer || !(process.env.ASC_PRIVATE_KEY || process.env.ASC_KEY_PATH)) {
    throw new Error(`asc: no App Store Connect API key; put ASC_ISSUER_ID, ASC_KEY_ID and ASC_PRIVATE_KEY in ${join(releaseDir, 'asc.env')}`);
  }
  let path = process.env.ASC_KEY_PATH;
  if (!path) {
    path = join(releaseDir, `AuthKey_${keyId}.p8`);
    const pem = normalizePem(process.env.ASC_PRIVATE_KEY!);
    mkdirSync(releaseDir, { recursive: true, mode: 0o700 });
    writeFileSync(path, pem, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  createPrivateKey(readFileSync(path, 'utf8')); // a key that does not parse fails here, not in xcodebuild
  console.log(`${path}\n${keyId}\n${issuer}`);
}
/** The .p8 as pasted into a single-line field may have lost its line breaks; PEM needs them. */
function normalizePem(text: string): string {
  const body = text.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

const local = readEnv(join(releaseDir, 'testflight.env'));
const setting = (name: string) => process.env[name] ?? local[name] ?? '';

let token = { value: '', expires: 0 };
function bearer(): string {
  const now = Math.floor(Date.now() / 1000);
  if (token.value && token.expires - 60 > now) return token.value;
  const issuer = process.env.ASC_ISSUER_ID, keyId = process.env.ASC_KEY_ID;
  const pem = process.env.ASC_KEY_PATH ? readFileSync(process.env.ASC_KEY_PATH, 'utf8') : process.env.ASC_PRIVATE_KEY ? normalizePem(process.env.ASC_PRIVATE_KEY) : '';
  if (!issuer || !keyId || !pem) throw new Error('asc: ASC_ISSUER_ID, ASC_KEY_ID and ASC_PRIVATE_KEY (or ASC_KEY_PATH) are required');
  const b64 = (v: object | Buffer) => Buffer.from(Buffer.isBuffer(v) ? v : JSON.stringify(v)).toString('base64url');
  const body = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuer, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`;
  const signature = sign('sha256', Buffer.from(body), { key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' });
  token = { value: `${body}.${b64(signature)}`, expires: now + 1200 };
  return token.value;
}

type Resource = { id: string; type: string; attributes: Record<string, any>; relationships?: Record<string, any> };
type Document = { data: Resource | Resource[]; included?: Resource[]; links?: { next?: string } };

async function api(method: string, path: string, body?: object): Promise<Document | null> {
  const url = path.startsWith('https://') ? path : `https://api.appstoreconnect.apple.com${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${bearer()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await Bun.sleep(5000 * (attempt + 1)); continue; }
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try { detail = JSON.parse(text).errors.map((e: any) => `${e.title}: ${e.detail}`).join('; '); } catch {}
      throw new ApiError(res.status, `${method} ${url.replace(/^https:\/\/[^/]+/, '')}: ${res.status} ${detail}`);
    }
    return text ? JSON.parse(text) : null;
  }
}
class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const list = async (path: string): Promise<Resource[]> => {
  const out: Resource[] = [];
  for (let next: string | undefined = path; next;) {
    const doc = await api('GET', next);
    out.push(...(doc?.data as Resource[]));
    next = doc?.links?.next;
  }
  return out;
};
const one = async (path: string) => ((await api('GET', path))?.data as Resource | null) ?? null;
const ref = (type: string, id: string) => ({ data: { type, id } });

async function findApp(): Promise<Resource | null> {
  return (await list(`/v1/apps?filter[bundleId]=${bundleId}`)).find(a => a.attributes.bundleId === bundleId) ?? null;
}
async function requireApp(): Promise<Resource> {
  const found = await findApp();
  if (found) return found;
  throw new Error(`asc: no App Store Connect app for ${bundleId}. Create it (App Store Connect > Apps > + > New App, ` +
    `platforms iOS and tvOS, bundle ID ${bundleId}); the API cannot. See docs/distribution.md.`);
}

async function ensureBundleId() {
  const ids = await list(`/v1/bundleIds?filter[identifier]=${bundleId}`);
  if (ids.some(b => b.attributes.identifier === bundleId)) return;
  await api('POST', '/v1/bundleIds', { data: { type: 'bundleIds', attributes: { identifier: bundleId, name: 'Vela', platform: 'IOS' } } });
  console.log(`asc: registered bundle ID ${bundleId}`);
}

async function group(appId: string, name: string, internal: boolean): Promise<Resource> {
  const groups = await list(`/v1/apps/${appId}/betaGroups`);
  const found = groups.find(g => g.attributes.name === name && g.attributes.isInternalGroup === internal);
  if (found) return found;
  const attributes = internal
    ? { name, isInternalGroup: true, hasAccessToAllBuilds: true }
    : { name, isInternalGroup: false, feedbackEnabled: true };
  const doc = await api('POST', '/v1/betaGroups', { data: { type: 'betaGroups', attributes, relationships: { app: ref('apps', appId) } } });
  console.log(`asc: created ${internal ? 'internal' : 'external'} group "${name}"`);
  return doc!.data as Resource;
}

async function addTesters(groupId: string, emails: string[]) {
  const present = new Set((await list(`/v1/betaGroups/${groupId}/betaTesters`)).map(t => String(t.attributes.email).toLowerCase()));
  for (const email of emails.filter(e => !present.has(e.toLowerCase()))) {
    try {
      await api('POST', '/v1/betaTesters', { data: { type: 'betaTesters', attributes: { email },
        relationships: { betaGroups: { data: [{ type: 'betaGroups', id: groupId }] } } } });
      console.log(`asc: invited ${email} to "${INTERNAL_GROUP}"`);
    } catch (error) {
      // Internal testers must already be App Store Connect users of the team.
      console.warn(`asc: could not add ${email}: ${(error as Error).message}`);
    }
  }
}

async function testInformation(appId: string) {
  const locale = beta.locale ?? 'en-US';
  const attributes: Record<string, string> = { description: beta.description, feedbackEmail: setting('VELA_TESTFLIGHT_FEEDBACK_EMAIL') };
  if (beta.privacyPolicyUrl) attributes.privacyPolicyUrl = beta.privacyPolicyUrl;
  if (beta.marketingUrl) attributes.marketingUrl = beta.marketingUrl;
  if (!attributes.feedbackEmail) delete attributes.feedbackEmail;
  const existing = (await list(`/v1/apps/${appId}/betaAppLocalizations`)).find(l => l.attributes.locale === locale);
  if (existing) await api('PATCH', `/v1/betaAppLocalizations/${existing.id}`, { data: { type: 'betaAppLocalizations', id: existing.id, attributes } });
  else await api('POST', '/v1/betaAppLocalizations', { data: { type: 'betaAppLocalizations', attributes: { locale, ...attributes }, relationships: { app: ref('apps', appId) } } });

  const detail = await one(`/v1/apps/${appId}/betaAppReviewDetail`);
  if (detail) {
    const review: Record<string, string | boolean> = {
      contactFirstName: setting('VELA_REVIEW_CONTACT_FIRST_NAME'),
      contactLastName: setting('VELA_REVIEW_CONTACT_LAST_NAME'),
      contactPhone: setting('VELA_REVIEW_CONTACT_PHONE'),
      contactEmail: setting('VELA_REVIEW_CONTACT_EMAIL'),
      demoAccountName: setting('VELA_REVIEW_DEMO_USER'),
      demoAccountPassword: setting('VELA_REVIEW_DEMO_PASSWORD'),
      notes: reviewNotes(),
    };
    for (const key of Object.keys(review)) if (review[key] === '' && key !== 'demoAccountPassword') delete review[key];
    review.demoAccountRequired = Boolean(setting('VELA_REVIEW_DEMO_USER'));
    if (!review.demoAccountRequired) delete review.demoAccountPassword;
    await api('PATCH', `/v1/betaAppReviewDetails/${detail.id}`, { data: { type: 'betaAppReviewDetails', id: detail.id, attributes: review } });
  }
  const missing = ['VELA_REVIEW_CONTACT_FIRST_NAME', 'VELA_REVIEW_CONTACT_LAST_NAME', 'VELA_REVIEW_CONTACT_PHONE', 'VELA_REVIEW_CONTACT_EMAIL', 'VELA_TESTFLIGHT_FEEDBACK_EMAIL'].filter(n => !setting(n));
  if (missing.length) console.warn(`asc: external testing needs ${missing.join(', ')} in ~/.config/vela-release/testflight.env`);
  return missing.length === 0;
}

function reviewNotes(): string {
  const server = setting('VELA_REVIEW_DEMO_SERVER');
  return [beta.reviewNotes, server ? `Server address to add: ${server}${setting('VELA_REVIEW_DEMO_KIND') ? ` (${setting('VELA_REVIEW_DEMO_KIND')})` : ''}.` : '']
    .filter(Boolean).join('\n\n').slice(0, 4000);
}

async function setup() {
  await ensureBundleId();
  const found = await requireApp();
  const internal = await group(found.id, INTERNAL_GROUP, true);
  let testers = setting('VELA_TESTFLIGHT_INTERNAL_TESTERS').split(/[\s,]+/).filter(Boolean);
  // Without a list, the team's account holder tests internally.
  if (!testers.length) testers = (await list('/v1/users?filter[roles]=ACCOUNT_HOLDER')).map(u => String(u.attributes.username)).filter(Boolean);
  if (testers.length) await addTesters(internal.id, testers);
  await group(found.id, PUBLIC_GROUP, false);
  const complete = await testInformation(found.id);
  console.log(`asc: ${found.attributes.name} (${found.id}) is ready for TestFlight${complete ? '' : ' (internal testing only until the missing settings are added)'}`);
  return { app: found, complete };
}

async function buildsFor(appId: string, version: string): Promise<Resource[]> {
  const doc = await api('GET', `/v1/builds?filter[app]=${appId}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&include=preReleaseVersion&limit=200`);
  const versions = new Map((doc?.included ?? []).map(v => [v.id, v.attributes.platform]));
  return (doc?.data as Resource[]).map(b => ({ ...b, attributes: { ...b.attributes, platform: versions.get(b.relationships?.preReleaseVersion?.data?.id) } }));
}

/** Android's versionCode for this version, then <code>.1, <code>.2 ... for each further upload of it. */
export function nextBuildNumber(base: number, existing: string[]): string {
  const ours = existing.filter(v => v === String(base) || v.startsWith(`${base}.`));
  if (!ours.length) return String(base);
  return `${base}.${Math.max(...ours.map(v => Number(v.split('.')[1] ?? 0))) + 1}`;
}

async function nextBuild(version: string) {
  if (version !== app.version) throw new Error(`asc: app.json is at ${app.version}, not ${version}`);
  const found = await findApp();
  const existing = found ? (await buildsFor(found.id, version)).map(b => String(b.attributes.version)) : [];
  console.log(nextBuildNumber(Number(app.android.versionCode), existing));
}

async function waitForBuild(appId: string, version: string, build: string, platform: string): Promise<Resource> {
  const deadline = Date.now() + 90 * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const found = (await buildsFor(appId, version)).find(b => String(b.attributes.version) === build && b.attributes.platform === platform);
    const state = found?.attributes.processingState ?? 'not yet visible';
    if (state !== last) console.log(`asc: ${platform} ${version} (${build}): ${state}`);
    last = state;
    if (found && state === 'VALID') return found;
    if (found && (state === 'FAILED' || state === 'INVALID')) throw new Error(`asc: ${platform} build ${build} is ${state}; Apple's email to the account holder says why`);
    await Bun.sleep(30_000);
  }
  throw new Error(`asc: ${platform} build ${build} was not processed within 90 minutes`);
}

async function distribute(version: string, build: string, platforms: string[], whatsNew: string, internalOnly: boolean) {
  const { app: found, complete } = await setup();
  const internal = await group(found.id, INTERNAL_GROUP, true);
  const external = await group(found.id, PUBLIC_GROUP, false);
  for (const platform of platforms) {
    const b = await waitForBuild(found.id, version, build, platform);
    if (b.attributes.usesNonExemptEncryption == null) {
      // Info.plist's ITSAppUsesNonExemptEncryption normally answers this; set it when it did not.
      await api('PATCH', `/v1/builds/${b.id}`, { data: { type: 'builds', id: b.id, attributes: { usesNonExemptEncryption: false } } });
    }
    const locale = beta.locale ?? 'en-US';
    const localizations = await list(`/v1/builds/${b.id}/betaBuildLocalizations`);
    const existing = localizations.find(l => l.attributes.locale === locale);
    if (existing) await api('PATCH', `/v1/betaBuildLocalizations/${existing.id}`, { data: { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatsNew } } });
    else await api('POST', '/v1/betaBuildLocalizations', { data: { type: 'betaBuildLocalizations', attributes: { locale, whatsNew }, relationships: { build: ref('builds', b.id) } } });
    // The internal group has every build already (hasAccessToAllBuilds); adding is harmless when it does not.
    if (!internal.attributes.hasAccessToAllBuilds) await api('POST', `/v1/betaGroups/${internal.id}/relationships/builds`, { data: [{ type: 'builds', id: b.id }] });
    console.log(`asc: ${platform} ${version} (${build}) is in "${INTERNAL_GROUP}"`);
    if (internalOnly || !complete) continue;
    await api('POST', `/v1/betaGroups/${external.id}/relationships/builds`, { data: [{ type: 'builds', id: b.id }] });
    const submitted = await one(`/v1/builds/${b.id}/betaAppReviewSubmission`).catch(() => null);
    if (!submitted) {
      try {
        await api('POST', '/v1/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: ref('builds', b.id) } } });
        console.log(`asc: ${platform} ${version} (${build}) submitted for Beta App Review`);
      } catch (error) {
        // A later build of an approved version is usually reviewed automatically; Apple says so here.
        console.warn(`asc: Beta App Review submission for ${platform} ${build}: ${(error as Error).message}`);
      }
    }
  }
  if (!internalOnly && complete) console.log(`asc: public link: ${await publicLink(external.id)}`);
}

async function publicLink(groupId: string): Promise<string> {
  let g = await one(`/v1/betaGroups/${groupId}`);
  if (!g!.attributes.publicLinkEnabled) {
    try {
      const doc = await api('PATCH', `/v1/betaGroups/${groupId}`, { data: { type: 'betaGroups', id: groupId,
        attributes: { publicLinkEnabled: true, publicLinkLimitEnabled: false, feedbackEnabled: true } } });
      g = doc!.data as Resource;
    } catch (error) {
      return `not enabled yet (${(error as Error).message}); it can be enabled once a build is approved`;
    }
  }
  return g!.attributes.publicLink ?? 'enabled; the URL appears after Beta App Review approves a build';
}

async function status(version?: string) {
  const found = await requireApp();
  const v = version ?? app.version;
  for (const b of await buildsFor(found.id, v)) {
    const review = await one(`/v1/builds/${b.id}/betaAppReviewSubmission`).catch(() => null);
    console.log(`${b.attributes.platform} ${v} (${b.attributes.version}): ${b.attributes.processingState}, external ${review?.attributes.betaReviewState ?? 'not submitted'}, expires ${String(b.attributes.expirationDate).slice(0, 10)}`);
  }
  const external = (await list(`/v1/apps/${found.id}/betaGroups`)).find(g => g.attributes.name === PUBLIC_GROUP && !g.attributes.isInternalGroup);
  if (external) console.log(`public link: ${external.attributes.publicLink ?? (external.attributes.publicLinkEnabled ? 'enabled, pending' : 'not enabled')}`);
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  const flag = (name: string) => args.flatMap((a, i) => a === name ? [args[i + 1]] : []);
  try {
    if (command === 'key-file') keyFile();
    else if (command === 'setup') await setup();
    else if (command === 'next-build' && args[0]) await nextBuild(args[0]);
    else if (command === 'distribute' && args[0] && args[1]) {
      const platforms = flag('--platform').length ? flag('--platform') : ['IOS', 'TV_OS'];
      const notes = flag('--whats-new')[0];
      await distribute(args[0], args[1], platforms, notes ? readFileSync(notes, 'utf8').trim() : beta.whatToTest, args.includes('--internal-only'));
    } else if (command === 'status') await status(args[0]);
    else { console.error('usage: asc.ts setup | next-build <version> | distribute <version> <build> [--platform IOS|TV_OS]... [--whats-new <file>] [--internal-only] | status [<version>]'); process.exit(2); }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
