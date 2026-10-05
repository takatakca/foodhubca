import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/foodhub/viewer';
import { MenuEditor } from './menu-editor';

export default async function MenuPage() {
  const v = await getViewer();
  if (v && !v.permissions.includes('menu:edit')) redirect('/menu/86');
  return <MenuEditor />;
}
