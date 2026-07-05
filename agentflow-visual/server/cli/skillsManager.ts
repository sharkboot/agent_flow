 import fs from 'node:fs/promises';
 import path from 'node:path';
 import { fileURLToPath } from 'node:url';
 
 const __filename = fileURLToPath(import.meta.url);
 const __dirname = path.dirname(__filename);
 
 const CONFIG_DIR = path.resolve(__dirname, '../../config');
 const SKILLS_DIR = path.resolve(CONFIG_DIR, 'skills');
 
 /**
  * Get the codex skills directory.
  * On Windows: C:\Users\{user}\.codex\skills
  */
 export function getCodexSkillsDir(): string {
   const home = process.env.USERPROFILE || process.env.HOME || '';
   return path.join(home, '.codex', 'skills');
 }
 
 /**
  * Get the agent's skills directory.
  * Format: {CONFIG_DIR}/skills/{agentId}
  */
 export function getAgentSkillsDir(agentId: string): string {
   return path.join(SKILLS_DIR, agentId);
 }
 
 /**
  * Ensure the agent's skills directory exists.
  */
 export async function ensureAgentSkillsDir(agentId: string): Promise<void> {
   const dir = getAgentSkillsDir(agentId);
   await fs.mkdir(dir, { recursive: true });
 }
 
 /**
  * Link a skill to an agent by creating a symbolic link.
  * The skill source is resolved from the global codex skills directory.
  */
 export async function linkSkillToAgent(agentId: string, skillName: string): Promise<boolean> {
   const codexSkillsDir = getCodexSkillsDir();
   const sourcePath = path.join(codexSkillsDir, skillName);
   const targetDir = getAgentSkillsDir(agentId);
   const targetPath = path.join(targetDir, skillName);
 
   try {
     const stats = await fs.stat(sourcePath);
     if (!stats.isDirectory()) {
       console.warn(`Skill source is not a directory: ${sourcePath}`);
       return false;
     }
 
     await fs.mkdir(targetDir, { recursive: true });
 
     try {
       await fs.unlink(targetPath);
     } catch {
       // Ignore if doesn't exist
     }
 
     if (process.platform === 'win32') {
       try {
         await fs.symlink(sourcePath, targetPath, 'junction');
       } catch {
         await fs.symlink(sourcePath, targetPath, 'dir');
       }
     } else {
       await fs.symlink(sourcePath, targetPath, 'dir');
     }
 
     console.log(`Linked skill '${skillName}' to agent '${agentId}'`);
     return true;
   } catch (err) {
     console.error(`Failed to link skill '${skillName}' to agent '${agentId}':`, err);
     return false;
   }
 }
 
 /**
  * Unlink a skill from an agent by removing the symbolic link.
  */
 export async function unlinkSkillFromAgent(agentId: string, skillName: string): Promise<boolean> {
   const targetPath = path.join(getAgentSkillsDir(agentId), skillName);
 
   try {
     const stats = await fs.lstat(targetPath);
     if (stats.isSymbolicLink()) {
       await fs.unlink(targetPath);
       console.log(`Unlinked skill '${skillName}' from agent '${agentId}'`);
       return true;
     }
     return false;
   } catch (err: unknown) {
     if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
       return false;
     }
     console.error(`Failed to unlink skill '${skillName}' from agent '${agentId}':`, err);
     return false;
   }
 }
 
 /**
  * Sync an agent's skills by comparing current and desired skills.
  */
 export async function syncAgentSkills(agentId: string, desiredSkills: string[] = []): Promise<void> {
   const targetDir = getAgentSkillsDir(agentId);
 
   await ensureAgentSkillsDir(agentId);
 
   let currentSkills: string[] = [];
   try {
     const entries = await fs.readdir(targetDir, { withFileTypes: true });
     currentSkills = entries
       .filter((e) => e.isSymbolicLink() || e.isDirectory())
       .map((e) => e.name);
   } catch {
     // Directory doesn't exist yet, that's ok
   }
 
   const toAdd = desiredSkills.filter((s) => !currentSkills.includes(s));
   const toRemove = currentSkills.filter((s) => !desiredSkills.includes(s));
 
   for (const skill of toRemove) {
     await unlinkSkillFromAgent(agentId, skill);
   }
 
   for (const skill of toAdd) {
     await linkSkillToAgent(agentId, skill);
   }
 
   try {
     const entries = await fs.readdir(targetDir);
     if (entries.length === 0) {
       await fs.rmdir(targetDir);
     }
   } catch {
     // Ignore
   }
 }
 
 /**
  * Clean up an agent's skills directory when the agent is deleted.
  */
 export async function cleanupAgentSkills(agentId: string): Promise<void> {
   const targetDir = getAgentSkillsDir(agentId);
 
   try {
     const entries = await fs.readdir(targetDir, { withFileTypes: true });
     for (const entry of entries) {
       const entryPath = path.join(targetDir, entry.name);
       if (entry.isSymbolicLink()) {
         await fs.unlink(entryPath);
       }
     }
     await fs.rmdir(targetDir);
     console.log(`Cleaned up skills directory for agent '${agentId}'`);
   } catch (err: unknown) {
     if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
       console.error(`Failed to cleanup skills for agent '${agentId}':`, err);
     }
   }
 }
 
 /**
  * List all available skills from the global codex skills directory.
  */
 export async function listAvailableSkills(): Promise<string[]> {
   const codexSkillsDir = getCodexSkillsDir();
 
   try {
     const entries = await fs.readdir(codexSkillsDir, { withFileTypes: true });
     return entries
       .filter((e) => e.isDirectory() || e.isSymbolicLink())
       .map((e) => e.name)
       .filter((name) => !name.startsWith('.'))
       .sort();
   } catch (err: unknown) {
     if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
       return [];
     }
     console.error('Failed to list available skills:', err);
     return [];
   }
 }
 
 /**
  * Get the skills linked to a specific agent.
  */
 export async function getAgentSkills(agentId: string): Promise<string[]> {
   const targetDir = getAgentSkillsDir(agentId);
 
   try {
     const entries = await fs.readdir(targetDir, { withFileTypes: true });
     return entries
       .filter((e) => e.isSymbolicLink() || e.isDirectory())
       .map((e) => e.name)
       .sort();
   } catch {
     return [];
   }
 }
 
 /**
  * Get skills directory path for configuration.
  */
 export function getSkillsDir(): string {
   return SKILLS_DIR;
 }
