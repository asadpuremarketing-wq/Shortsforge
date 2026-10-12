import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROJECTS_DIR } from './config.js';

const cache = new Map();

export const newId = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x');
export const projectDir = (id) => path.join(PROJECTS_DIR, id);
const projectFile = (id) => path.join(projectDir(id), 'project.json');

export function loadProject(id) {
  if (!/^[A-Za-z0-9]+$/.test(id)) return null;
  if (cache.has(id)) return cache.get(id);
  const file = projectFile(id);
  if (!fs.existsSync(file)) return null;
  const project = JSON.parse(fs.readFileSync(file, 'utf8'));
  cache.set(id, project);
  return project;
}

export function saveProject(project) {
  project.updatedAt = Date.now();
  cache.set(project.id, project);
  const file = projectFile(project.id);
  fs.writeFileSync(file + '.tmp', JSON.stringify(project));
  fs.renameSync(file + '.tmp', file);
  return project;
}

/** Load, mutate and save in one step. */
export function updateProject(id, fn) {
  const project = loadProject(id);
  if (!project) return null;
  fn(project);
  return saveProject(project);
}

export function listProjects() {
  return fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        return loadProject(d.name);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteProject(id) {
  cache.delete(id);
  fs.rmSync(projectDir(id), { recursive: true, force: true });
}

/** Strip the heavy transcript word list for polling responses. */
export function summarize(project) {
  const { transcript, ...rest } = project;
  return { ...rest, transcript: transcript ? { provider: transcript.provider, wordCount: transcript.words.length } : null };
}
