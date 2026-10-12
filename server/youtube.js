// Direct upload to YouTube with the user's own Google OAuth client (YouTube Data API v3).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, PORT } from './config.js';
import { loadProject, projectDir } from './store.js';

const TOKEN_FILE = path.join(DATA_DIR, 'youtube-token.json');
const REDIRECT = `http://localhost:${PORT}/oauth/youtube`;
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
let pendingState = null;

const configured = () => Boolean(process.env.YOUTUBE_CLIENT_ID?.trim() && process.env.YOUTUBE_CLIENT_SECRET?.trim());
const readToken = () => (fs.existsSync(TOKEN_FILE) ? JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) : null);

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google sign-in failed: ${data.error_description || data.error || res.status}`);
  return data;
}

async function accessToken() {
  const tok = readToken();
  if (!tok?.refresh_token) throw new Error('Connect your YouTube channel in Settings first.');
  if (tok.access_token && tok.expires_at > Date.now() + 60_000) return tok.access_token;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tok.refresh_token });
  const next = { ...tok, access_token: fresh.access_token, expires_at: Date.now() + fresh.expires_in * 1000 };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(next));
  return next.access_token;
}

async function channelName() {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: `Bearer ${await accessToken()}` } });
  const data = await res.json();
  return data.items?.[0]?.snippet?.title || null;
}

/** Resumable upload: create the session with metadata, then send the bytes. */
async function uploadVideo(file, { title, description, tags, privacy }) {
  const size = fs.statSync(file).size;
  const meta = {
    snippet: { title: title.slice(0, 100), description: description.slice(0, 5000), tags: tags.slice(0, 30), categoryId: '24' },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
  };
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4' },
    body: JSON.stringify(meta),
  });
  if (!start.ok) throw new Error(`YouTube rejected the upload: ${(await start.text()).slice(0, 300)}`);
  const put = await fetch(start.headers.get('location'), { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(size) }, body: fs.readFileSync(file) });
  const data = await put.json();
  if (!put.ok) throw new Error(`YouTube upload failed: ${data.error?.message || put.status}`);
  return data.id;
}

export function registerYouTubeRoutes(app, wrap) {
  app.get('/api/youtube/status', wrap(async (req, res) => {
    const connected = configured() && Boolean(readToken()?.refresh_token);
    let channel = null;
    if (connected) channel = await channelName().catch(() => null);
    res.json({ configured: configured(), connected, channel, redirect: REDIRECT });
  }));

  app.get('/api/youtube/connect', (req, res) => {
    if (!configured()) return res.status(400).send('Add your Google OAuth client ID and secret in Settings first.');
    pendingState = crypto.randomBytes(16).toString('hex');
    const q = new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state: pendingState });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  });

  app.get('/oauth/youtube', wrap(async (req, res) => {
    if (!pendingState || req.query.state !== pendingState) return res.status(400).send('Sign-in expired. Go back to Settings and click Connect again.');
    pendingState = null;
    if (req.query.error) return res.redirect('/#/settings');
    const tok = await tokenRequest({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: REDIRECT });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + tok.expires_in * 1000 }));
    res.redirect('/#/settings');
  }));

  app.delete('/api/youtube', (req, res) => {
    fs.rmSync(TOKEN_FILE, { force: true });
    res.json({ ok: true });
  });

  app.post('/api/youtube/upload', wrap(async (req, res) => {
    const { projectId, file, title, description = '', tags = [], privacy = 'private' } = req.body || {};
    const p = loadProject(projectId);
    const f = p && path.join(projectDir(p.id), path.basename(String(file || '')));
    if (!f || !fs.existsSync(f) || !f.endsWith('.mp4')) return res.status(404).json({ error: 'Video not found.' });
    if (!String(title || '').trim()) return res.status(400).json({ error: 'Give the video a title.' });
    // "#Shorts" in the title or description helps YouTube classify vertical videos under 3 minutes as Shorts.
    const desc = /#shorts/i.test(`${title} ${description}`) ? description : `${description}\n\n#Shorts`.trim();
    const id = await uploadVideo(f, { title: String(title).trim(), description: desc, tags: Array.isArray(tags) ? tags.map(String) : [], privacy: ['private', 'unlisted', 'public'].includes(privacy) ? privacy : 'private' });
    res.json({ id, url: `https://youtube.com/shorts/${id}` });
  }));
}
