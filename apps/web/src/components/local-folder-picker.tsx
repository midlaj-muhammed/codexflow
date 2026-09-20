'use client';

import { useState } from 'react';

type Entry = { kind: string; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<Entry> };
declare global { interface Window { showDirectoryPicker?: () => Promise<Entry> } }
const ignored = /(^|\/)(node_modules|\.git|dist|build|coverage)(\/|$)|(^|\/)\.env(?:\..*)?$|(^|\/)(credentials\.json|secrets\.|.*\.(pem|key))$/i;

async function collect(entry: Entry, prefix = ''): Promise<Array<{ path: string; file: File }>> {
  if (entry.kind === 'file' && entry.getFile) return [{ path: `${prefix}${entry.name}`, file: await entry.getFile() }];
  const output: Array<{ path: string; file: File }> = [];
  if (entry.values) for await (const child of entry.values()) output.push(...await collect(child, `${prefix}${entry.name}/`));
  return output;
}
export function LocalFolderPicker({ onImported }: { onImported: (projectId: string, summary: string) => void }) {
  const [message, setMessage] = useState('');
  async function select() {
    if (!window.showDirectoryPicker) { setMessage('This browser does not support secure folder selection. Use a Chromium browser with the File System Access API.'); return; }
    try {
      setMessage('Reading selected folder…'); const directory = await window.showDirectoryPicker(); const entries = await collect(directory);
      const transferable = entries.filter((entry) => !ignored.test(entry.path));
      const form = new FormData(); form.set('name', directory.name);
      transferable.forEach(({ path, file }) => { form.append('paths', path); form.append('files', file, path); });
      setMessage(`Importing ${transferable.length} files; ${entries.length - transferable.length} excluded by safety policy…`);
      const response = await fetch('/api/projects/import-local', { method: 'POST', body: form }); const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Folder import failed');
      onImported(String(body.project.id), `Imported ${body.import.filesImported} files. ${body.import.ignored.length} files were excluded by safety policy.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Folder import failed'); }
  }
  return <div className="folder-picker"><button className="button" type="button" onClick={() => void select()}>Select folder</button>{message ? <p className="subtle" role="status">{message}</p> : null}</div>;
}
