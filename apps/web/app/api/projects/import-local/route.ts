import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { controlPlane, importLocalRepository } from '@/lib/control-plane';

const ignored = /(^|\/)(node_modules|\.git|dist|build|coverage)(\/|$)|(^|\/)\.env(?:\..*)?$|(^|\/)(credentials\.json|secrets\.|.*\.(pem|key))$/i;
const safe = (path: string) => path && !path.startsWith('/') && !path.split('/').some((part) => part === '..' || !part);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((value): value is File => value instanceof File);
    const paths = form.getAll('paths').map(String);
    const name = String(form.get('name') ?? 'local-project').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100) || 'local-project';
    if (!files.length || files.length !== paths.length) throw new Error('Select a folder containing at least one transferable file');
    if (files.length > 2_000) throw new Error('Folder import exceeds the 2,000-file safety limit');
    const root = resolve(process.cwd(), '.codexflow', 'projects', `${name}-${randomUUID()}`);
    let imported = 0; const ignoredPaths: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const path = paths[index].replaceAll('\\', '/');
      if (!safe(path)) throw new Error('Folder import contains an unsafe file path');
      if (ignored.test(path)) { ignoredPaths.push(path); continue; }
      const target = resolve(root, path);
      if (relative(root, target).startsWith('..')) throw new Error('Folder import attempted to write outside its managed workspace');
      await mkdir(resolve(target, '..'), { recursive: true });
      await writeFile(target, Buffer.from(await files[index].arrayBuffer())); imported += 1;
    }
    if (!imported) throw new Error('All selected files were excluded by the project safety policy');
    await controlPlane().git.initializeSnapshot(root);
    const importedProject = await importLocalRepository({ localPath: root, name });
    return NextResponse.json({ ...importedProject, import: { filesImported: imported, ignored: ignoredPaths.slice(0, 100) } }, { status: 201 });
  } catch (error) { return apiError(error); }
}
