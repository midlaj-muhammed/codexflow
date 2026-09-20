'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LocalFolderPicker } from './local-folder-picker';
export function LandingActions() {
  const router = useRouter();
  return <div className="actions"><Link className="button" href="/auth/github">Continue with GitHub</Link><LocalFolderPicker onImported={() => { router.push('/app'); }} /></div>;
}
