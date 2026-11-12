import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Switch } from '@/components/ui';
import { AdminPage, Card, Table, Td, adminApi, useAdminMutation, useAdminQuery } from './common';

interface Category {
  id: number;
  slug: string;
  nameMn: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
  showOnHome: boolean;
  movieCount: number;
}

export default function Categories() {
  const { data, isLoading } = useAdminQuery<Category[]>(['categories'], '/categories');
  const [form, setForm] = useState({ nameMn: '', nameEn: '', slug: '' });

  const create = useAdminMutation(
    (body: typeof form) => adminApi('/categories', { method: 'POST', body: { nameMn: body.nameMn, nameEn: body.nameEn, ...(body.slug ? { slug: body.slug } : {}), sortOrder: (data?.length ?? 0) * 10 } }),
    { success: 'Ангилал нэмэгдлээ', invalidate: [['categories']] },
  );
  const update = useAdminMutation(({ id, ...body }: Partial<Category> & { id: number }) => adminApi(`/categories/${id}`, { method: 'PATCH', body }), {
    invalidate: [['categories']],
  });
  const remove = useAdminMutation((id: number) => adminApi(`/categories/${id}`, { method: 'DELETE' }), { success: 'Устгагдлаа', invalidate: [['categories']] });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(form, { onSuccess: () => setForm({ nameMn: '', nameEn: '', slug: '' }) });
  };

  return (
    <AdminPage title="Ангилал" subtitle="Нүүр хуудсанд харагдах дараалал, идэвхтэй эсэхийг удирдана">
      <Card title="Шинэ ангилал">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input placeholder="Нэр (MN)" required value={form.nameMn} onChange={(e) => setForm((f) => ({ ...f, nameMn: e.target.value }))} maxLength={100} />
          <Input placeholder="Name (EN)" required value={form.nameEn} onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))} maxLength={100} />
          <Input placeholder="slug (заавал биш)" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))} maxLength={80} />
          <Button type="submit" loading={create.isPending} icon={<Plus className="size-4" />}>
            Нэмэх
          </Button>
        </form>
      </Card>

      <Table head={['Дараалал', 'Нэр (MN)', 'Name (EN)', 'Slug', 'Кино', 'Идэвхтэй', 'Нүүрэнд', '']} empty={!isLoading && !data?.length}>
        {data?.map((c) => (
          <tr key={c.id}>
            <Td>
              <Input
                type="number"
                defaultValue={c.sortOrder}
                className="h-9 w-20"
                onBlur={(e) => Number(e.target.value) !== c.sortOrder && update.mutate({ id: c.id, sortOrder: Number(e.target.value) })}
              />
            </Td>
            <Td>
              <Input defaultValue={c.nameMn} className="h-9" onBlur={(e) => e.target.value !== c.nameMn && update.mutate({ id: c.id, nameMn: e.target.value })} />
            </Td>
            <Td>
              <Input defaultValue={c.nameEn} className="h-9" onBlur={(e) => e.target.value !== c.nameEn && update.mutate({ id: c.id, nameEn: e.target.value })} />
            </Td>
            <Td className="font-mono text-xs text-muted">{c.slug}</Td>
            <Td className="tabular-nums">{c.movieCount}</Td>
            <Td>
              <Switch checked={c.isActive} onChange={(v) => update.mutate({ id: c.id, isActive: v })} />
            </Td>
            <Td>
              <Switch checked={c.showOnHome} onChange={(v) => update.mutate({ id: c.id, showOnHome: v })} />
            </Td>
            <Td>
              <Button size="sm" variant="ghost" aria-label="Устгах" onClick={() => window.confirm(`"${c.nameMn}" ангиллыг устгах уу?`) && remove.mutate(c.id)}>
                <Trash2 className="size-4 text-red-500" />
              </Button>
            </Td>
          </tr>
        ))}
      </Table>
    </AdminPage>
  );
}
