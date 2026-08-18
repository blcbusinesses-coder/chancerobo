import { promises as fsp } from 'node:fs';
import { google } from 'googleapis';
import { env } from '../../config/env.js';

/**
 * GOOGLE WORKSPACE / CLOUD APIS (Gmail, Calendar, Drive, Docs, Sheets, YouTube)
 * ----------------------------------------------------------------------------
 * One OAuth2 client → every Google service. This is how Chance acts AS her own
 * Google account: programmatically, using a long-lived refresh token, with no
 * browser and nothing for Google to bot-block.
 *
 * Flow:
 *   1. `npm run google:auth`   — one-time consent, writes GOOGLE_REFRESH_TOKEN.
 *   2. From then on, every method below is authenticated automatically.
 */
export class GoogleServices {
  private oauth2 = new google.auth.OAuth2(
    env.google.clientId,
    env.google.clientSecret,
    env.google.redirectUri,
  );

  /** Pass a refresh token to act as a specific account; omit for the primary (.env) account. */
  constructor(refreshToken?: string) {
    const rt = refreshToken || env.google.refreshToken;
    if (rt) this.oauth2.setCredentials({ refresh_token: rt });
  }

  /** Client ID/secret present (can start the consent flow). */
  get configured(): boolean {
    return Boolean(env.google.clientId && env.google.clientSecret);
  }
  /** Refresh token present (can make authenticated calls). */
  get authorized(): boolean {
    return Boolean(env.google.refreshToken);
  }
  get auth() {
    return this.oauth2;
  }

  /** The consent URL. `offline` + `consent` guarantees a refresh_token comes back. */
  authUrl(): string {
    return this.oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: env.google.scopes,
    });
  }

  /** Exchange the ?code= from the callback for tokens (incl. refresh_token). */
  async exchangeCode(code: string) {
    const { tokens } = await this.oauth2.getToken(code);
    this.oauth2.setCredentials(tokens);
    return tokens;
  }

  // ── Service clients ─────────────────────────────────────────────────────
  gmail() { return google.gmail({ version: 'v1', auth: this.oauth2 }); }
  calendar() { return google.calendar({ version: 'v3', auth: this.oauth2 }); }
  drive() { return google.drive({ version: 'v3', auth: this.oauth2 }); }
  docs() { return google.docs({ version: 'v1', auth: this.oauth2 }); }
  sheets() { return google.sheets({ version: 'v4', auth: this.oauth2 }); }
  slides() { return google.slides({ version: 'v1', auth: this.oauth2 }); }
  youtube() { return google.youtube({ version: 'v3', auth: this.oauth2 }); }
  tasks() { return google.tasks({ version: 'v1', auth: this.oauth2 }); }
  people() { return google.people({ version: 'v1', auth: this.oauth2 }); }
  vision() { return google.vision({ version: 'v1', auth: this.oauth2 }); }
  script() { return google.script({ version: 'v1', auth: this.oauth2 }); }

  // ── Cloud Vision (image understanding) ─────────────────────────────────
  async analyzeImage(source: string, features: string[] = ['labels', 'text']) {
    let content: string;
    if (/^https?:\/\//i.test(source)) {
      const res = await fetch(source);
      content = Buffer.from(await res.arrayBuffer()).toString('base64');
    } else {
      content = (await fsp.readFile(source)).toString('base64');
    }
    const FMAP: Record<string, string> = {
      text: 'TEXT_DETECTION', document: 'DOCUMENT_TEXT_DETECTION', labels: 'LABEL_DETECTION',
      objects: 'OBJECT_LOCALIZATION', faces: 'FACE_DETECTION', landmarks: 'LANDMARK_DETECTION',
      logos: 'LOGO_DETECTION', safe: 'SAFE_SEARCH_DETECTION',
    };
    const feats = (features.length ? features : ['labels', 'text']).map((f) => ({ type: FMAP[f] || 'LABEL_DETECTION' }));
    const res = await this.vision().images.annotate({ requestBody: { requests: [{ image: { content }, features: feats }] } });
    const r = res.data.responses?.[0] ?? {};
    return {
      text: (r.fullTextAnnotation?.text || r.textAnnotations?.[0]?.description || '').slice(0, 4000),
      labels: (r.labelAnnotations ?? []).map((l) => ({ label: l.description, score: l.score })),
      objects: (r.localizedObjectAnnotations ?? []).map((o) => ({ object: o.name, score: o.score })),
      faces: (r.faceAnnotations ?? []).length,
      landmarks: (r.landmarkAnnotations ?? []).map((l) => l.description),
      logos: (r.logoAnnotations ?? []).map((l) => l.description),
      safeSearch: r.safeSearchAnnotation ?? undefined,
    };
  }

  // ── Apps Script (write automations into the account) ──────────────────
  async appsScriptCreate(title: string, code: string) {
    const proj = await this.script().projects.create({ requestBody: { title } });
    const scriptId = proj.data.scriptId!;
    const manifest = JSON.stringify({ timeZone: 'America/New_York', exceptionLogging: 'STACKDRIVER', runtimeVersion: 'V8' });
    await this.script().projects.updateContent({
      scriptId,
      requestBody: {
        files: [
          { name: 'Code', type: 'SERVER_JS', source: code },
          { name: 'appsscript', type: 'JSON', source: manifest },
        ],
      },
    });
    return { scriptId, link: `https://script.google.com/d/${scriptId}/edit` };
  }
  async appsScriptGet(scriptId: string) {
    const res = await this.script().projects.getContent({ scriptId });
    return (res.data.files ?? []).map((f) => ({ name: f.name, type: f.type, source: (f.source ?? '').slice(0, 4000) }));
  }

  // ── Drive ────────────────────────────────────────────────────────────────
  async driveSearch(query: string, max = 10) {
    const res = await this.drive().files.list({
      q: `name contains '${query.replace(/'/g, '')}' and trashed=false`,
      pageSize: max,
      fields: 'files(id,name,mimeType,webViewLink,modifiedTime)',
      orderBy: 'modifiedTime desc',
    });
    return res.data.files ?? [];
  }
  async driveRead(fileId: string) {
    const meta = await this.drive().files.get({ fileId, fields: 'name,mimeType' });
    const mt = meta.data.mimeType || '';
    if (mt.startsWith('application/vnd.google-apps.document')) {
      const res = await this.drive().files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' });
      return { name: meta.data.name, text: String(res.data).slice(0, 8000) };
    }
    if (mt.startsWith('text/')) {
      const res = await this.drive().files.get({ fileId, alt: 'media' } as never, { responseType: 'text' });
      return { name: meta.data.name, text: String(res.data).slice(0, 8000) };
    }
    return { name: meta.data.name, mimeType: mt, note: 'Binary/Google file — open via its link.' };
  }

  /** Who can currently access a Drive/Docs/Sheets/Slides file. */
  async driveGetPermissions(fileId: string) {
    const res = await this.drive().permissions.list({
      fileId,
      fields: 'permissions(id,type,role,emailAddress,displayName)',
    });
    return res.data.permissions ?? [];
  }

  /**
   * Change who can view/comment/edit a Drive file (Doc/Sheet/Slide/anything).
   * type: 'user' (needs email), 'anyone' (link sharing), 'domain'.
   * role: 'reader' | 'commenter' | 'writer' | 'owner'.
   */
  async driveShare(
    fileId: string,
    role: 'reader' | 'commenter' | 'writer' | 'owner',
    type: 'user' | 'anyone' | 'domain' = 'user',
    emailAddress?: string,
  ) {
    if (type === 'user' && !emailAddress) throw new Error('emailAddress is required when type is "user".');
    const res = await this.drive().permissions.create({
      fileId,
      sendNotificationEmail: type === 'user',
      requestBody: { role, type, ...(emailAddress ? { emailAddress } : {}) },
      fields: 'id,type,role,emailAddress',
    });
    const file = await this.drive().files.get({ fileId, fields: 'webViewLink' });
    return { permission: res.data, link: file.data.webViewLink };
  }

  /** Revoke a specific person's/link's access. */
  async driveRevokeAccess(fileId: string, permissionId: string) {
    await this.drive().permissions.delete({ fileId, permissionId });
    return { revoked: permissionId };
  }

  // ── Docs ─────────────────────────────────────────────────────────────────
  async docsCreate(title: string, text = '') {
    const doc = await this.docs().documents.create({ requestBody: { title } });
    const id = doc.data.documentId!;
    if (text) {
      await this.docs().documents.batchUpdate({
        documentId: id,
        requestBody: { requests: [{ insertText: { location: { index: 1 }, text } }] },
      });
    }
    return { id, link: `https://docs.google.com/document/d/${id}/edit` };
  }
  async docsRead(documentId: string) {
    const doc = await this.docs().documents.get({ documentId });
    let text = '';
    for (const el of doc.data.body?.content ?? [])
      for (const pe of el.paragraph?.elements ?? []) text += pe.textRun?.content ?? '';
    return { title: doc.data.title, text: text.slice(0, 8000) };
  }

  // ── Sheets ─────────────────────────────────────────────────────────────
  async sheetsCreate(title: string) {
    const res = await this.sheets().spreadsheets.create({ requestBody: { properties: { title } } });
    return { id: res.data.spreadsheetId, link: res.data.spreadsheetUrl };
  }
  async sheetsRead(spreadsheetId: string, range = 'A1:Z50') {
    const res = await this.sheets().spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values ?? [];
  }
  async sheetsAppend(spreadsheetId: string, range: string, values: unknown[][]) {
    await this.sheets().spreadsheets.values.append({
      spreadsheetId, range, valueInputOption: 'USER_ENTERED', requestBody: { values },
    });
    return { appended: values.length };
  }

  // ── Tasks ─────────────────────────────────────────────────────────────
  private async firstTaskList(): Promise<string> {
    const lists = await this.tasks().tasklists.list();
    const id = lists.data.items?.[0]?.id;
    if (!id) throw new Error('No task list found.');
    return id;
  }
  async tasksList(max = 20) {
    const res = await this.tasks().tasks.list({ tasklist: await this.firstTaskList(), maxResults: max, showCompleted: false });
    return (res.data.items ?? []).map((t) => ({ title: t.title, status: t.status, due: t.due }));
  }
  async taskAdd(title: string, notes?: string) {
    await this.tasks().tasks.insert({ tasklist: await this.firstTaskList(), requestBody: { title, notes } });
    return { added: title };
  }

  // ── Contacts (People) ─────────────────────────────────────────────────
  async contactsSearch(query: string) {
    const res = await this.people().people.searchContacts({ query, readMask: 'names,emailAddresses,phoneNumbers' });
    return (res.data.results ?? []).map((r) => ({
      name: r.person?.names?.[0]?.displayName,
      email: r.person?.emailAddresses?.[0]?.value,
      phone: r.person?.phoneNumbers?.[0]?.value,
    }));
  }

  // ── YouTube stats for ANY channel (by name) ───────────────────────────
  async youtubeChannelStats(name: string) {
    const s = await this.youtube().search.list({ part: ['snippet'], q: name, type: ['channel'], maxResults: 1 });
    const id = s.data.items?.[0]?.id?.channelId;
    if (!id) return { error: `No channel found for "${name}"` };
    const res = await this.youtube().channels.list({ part: ['snippet', 'statistics'], id: [id] });
    const c = res.data.items?.[0];
    return {
      title: c?.snippet?.title,
      subscribers: c?.statistics?.subscriberCount,
      videos: c?.statistics?.videoCount,
      totalViews: c?.statistics?.viewCount,
    };
  }

  // ── YouTube search ────────────────────────────────────────────────────
  async youtubeSearch(query: string, max = 5) {
    const res = await this.youtube().search.list({ part: ['snippet'], q: query, maxResults: max, type: ['video'] });
    return (res.data.items ?? []).map((i) => ({
      title: i.snippet?.title,
      channel: i.snippet?.channelTitle,
      url: `https://www.youtube.com/watch?v=${i.id?.videoId}`,
    }));
  }

  // ── Convenience helpers ─────────────────────────────────────────────────

  /** Which Google account are we? Confirms the connection is live. */
  async whoami(): Promise<string> {
    const profile = await this.gmail().users.getProfile({ userId: 'me' });
    return profile.data.emailAddress ?? '(unknown)';
  }

  /** Send an email as the connected account. */
  async sendEmail(to: string, subject: string, body: string) {
    const raw = Buffer.from(
      [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\r\n'),
    ).toString('base64url');
    return this.gmail().users.messages.send({ userId: 'me', requestBody: { raw } });
  }

  /** The connected account's YouTube channel(s). Confirms YouTube access. */
  async myChannel() {
    const res = await this.youtube().channels.list({ part: ['snippet', 'statistics'], mine: true });
    return res.data.items ?? [];
  }

  /** Next N upcoming calendar events. */
  async upcomingEvents(max = 5) {
    const res = await this.calendar().events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: max,
      singleEvents: true,
      orderBy: 'startTime',
    });
    return res.data.items ?? [];
  }

  /** Create a calendar event. Times are ISO 8601 strings. */
  async createEvent(summary: string, startISO: string, endISO: string, description = '') {
    const res = await this.calendar().events.insert({
      calendarId: 'primary',
      requestBody: {
        summary,
        description,
        start: { dateTime: startISO },
        end: { dateTime: endISO },
      },
    });
    return { id: res.data.id, link: res.data.htmlLink, status: res.data.status };
  }

  /** Most recent inbox emails (from / subject / snippet). */
  async listRecentEmails(max = 5) {
    const list = await this.gmail().users.messages.list({ userId: 'me', maxResults: max, q: 'in:inbox' });
    const out: { from: string; subject: string; date: string; snippet: string }[] = [];
    for (const m of list.data.messages ?? []) {
      const full = await this.gmail().users.messages.get({
        userId: 'me',
        id: m.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const headers = full.data.payload?.headers ?? [];
      const h = (n: string) => headers.find((x) => x.name === n)?.value ?? '';
      out.push({ from: h('From'), subject: h('Subject'), date: h('Date'), snippet: full.data.snippet ?? '' });
    }
    return out;
  }
}
