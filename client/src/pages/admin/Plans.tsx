import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, Star } from 'lucide-react';
import { Badge, Button, Field, Input, Modal, Switch } from '@/components/ui';
import { formatPrice } from '@/lib/format';
import { AdminPage, Card, Table, Td, adminApi, useAdminMutation, useAdminQuery } from './common';
import type { SettingsResponse } from './Settings';

interface Plan {
  id: number;
  code: string;
  nameMn: string;
  nameEn: string;
  descriptionMn: string | null;
  descriptionEn: string | null;
  price: number;
  durationDays: number;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  subscriptionCount: number;
}
type PlanForm = Omit<Plan, 'id' | 'subscriptionCount'>;
const blank: PlanForm = { code: '', nameMn: '', nameEn: '', descriptionMn: '', descriptionEn: '', price: 15000, durationDays: 30, isActive: true, isDefault: false, sortOrder: 0 };

export default function Plans() {
  const { data, isLoading } = useAdminQuery<Plan[]>(['plans'], '/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const remove = useAdminMutation((id: number) => adminApi(`/plans/${id}`, { method: 'DELETE' }), { success: 'Устгагдлаа (ашиглагдсан бол идэвхгүй болгосон)', invalidate: [['plans']] });

  return (
    <AdminPage
      title="Үнэ & багц"
      subtitle="Сарын багц болон нэг кино түрээсийн үндсэн үнэ"
      actions={
        <Button onClick={() => setEditing('new')} icon={<Plus className="size-4" />}>
          Шинэ багц
        </Button>
      }
    >
      <RentPricing />

      <Table head={['Багц', 'Код', 'Үнэ', 'Хугацаа', 'Худалдан авалт', 'Төлөв', '']} empty={!isLoading && !data?.length}>
        {data?.map((p) => (
          <tr key={p.id}>
            <Td>
              <p className="flex items-center gap-1.5 font-medium">
                {p.nameMn} {p.isDefault && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
              </p>
              <p className="text-xs text-muted">{p.nameEn}</p>
            </Td>
            <Td className="font-mono text-xs">{p.code}</Td>
            <Td className="font-semibold tabular-nums">{formatPrice(p.price)}</Td>
            <Td>{p.durationDays} хоног</Td>
            <Td className="tabular-nums">{p.subscriptionCount}</Td>
            <Td>{p.isActive ? <Badge tone="success">Идэвхтэй</Badge> : <Badge>Идэвхгүй</Badge>}</Td>
            <Td>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label="Засах">
                  <Pencil className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Устгах" onClick={() => window.confirm(`"${p.nameMn}" багцыг устгах уу?`) && remove.mutate(p.id)}>
                  <Trash2 className="size-4 text-red-500" />
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </Table>

      <PlanModal plan={editing} onClose={() => setEditing(null)} />
    </AdminPage>
  );
}

function PlanModal({ plan, onClose }: { plan: Plan | 'new' | null; onClose: () => void }) {
  const [form, setForm] = useState<PlanForm>(blank);
  useEffect(() => {
    if (plan && plan !== 'new') {
      const { id: _i, subscriptionCount: _s, ...rest } = plan;
      setForm({ ...rest, descriptionMn: rest.descriptionMn ?? '', descriptionEn: rest.descriptionEn ?? '' });
    } else setForm(blank);
  }, [plan]);

  const save = useAdminMutation(
    (body: PlanForm) =>
      adminApi(plan === 'new' ? '/plans' : `/plans/${(plan as Plan).id}`, {
        method: plan === 'new' ? 'POST' : 'PATCH',
        body: { ...body, descriptionMn: body.descriptionMn || null, descriptionEn: body.descriptionEn || null },
      }),
    { success: 'Хадгалагдлаа', invalidate: [['plans']] },
  );
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(form, { onSuccess: onClose });
  };

  return (
    <Modal open={plan !== null} onClose={onClose} title={plan === 'new' ? 'Шинэ багц' : 'Багц засах'}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Нэр (MN)">
          <Input required value={form.nameMn} onChange={(e) => set('nameMn', e.target.value)} />
        </Field>
        <Field label="Name (EN)">
          <Input required value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
        </Field>
        <Field label="Код" hint="URL-д ашиглагдана: /checkout/plan/код">
          <Input required value={form.code} onChange={(e) => set('code', e.target.value.toLowerCase())} pattern="[a-z0-9_-]+" />
        </Field>
        <Field label="Дараалал">
          <Input type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />
        </Field>
        <Field label="Үнэ (₮)">
          <Input type="number" min={0} required value={form.price} onChange={(e) => set('price', Number(e.target.value))} />
        </Field>
        <Field label="Хугацаа (хоног)">
          <Input type="number" min={1} required value={form.durationDays} onChange={(e) => set('durationDays', Number(e.target.value))} />
        </Field>
        <Field label="Тайлбар (MN)" className="sm:col-span-2">
          <Input value={form.descriptionMn ?? ''} onChange={(e) => set('descriptionMn', e.target.value)} />
        </Field>
        <Field label="Description (EN)" className="sm:col-span-2">
          <Input value={form.descriptionEn ?? ''} onChange={(e) => set('descriptionEn', e.target.value)} />
        </Field>
        <Switch checked={form.isActive} onChange={(v) => set('isActive', v)} label="Идэвхтэй" />
        <Switch checked={form.isDefault} onChange={(v) => set('isDefault', v)} label="Онцлох (санал болгох)" />
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onClose}>
            Болих
          </Button>
          <Button type="submit" loading={save.isPending}>
            Хадгалах
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Түрээсийн үндсэн үнэ/хугацаа болон FB товчны багц нь тохиргоонд хадгалагдана */
function RentPricing() {
  const { data } = useAdminQuery<SettingsResponse>(['settings'], '/settings');
  const fields = data?.groups.find((g) => g.group === 'pricing')?.fields ?? [];
  const get = (k: string) => fields.find((f) => f.key === k)?.value;
  const [price, setPrice] = useState('');
  const [hours, setHours] = useState('');
  const [planCode, setPlanCode] = useState('');

  useEffect(() => {
    if (!fields.length) return;
    setPrice(String(get('pricing.defaultRentPrice') ?? ''));
    setHours(String(get('pricing.defaultRentHours') ?? ''));
    setPlanCode(String(get('pricing.monthlyPlanCode') ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const save = useAdminMutation(
    () =>
      adminApi('/settings', {
        method: 'PUT',
        body: { values: { 'pricing.defaultRentPrice': Number(price), 'pricing.defaultRentHours': Number(hours), 'pricing.monthlyPlanCode': planCode } },
      }),
    { success: 'Үнэ шинэчлэгдлээ', invalidate: [['settings']] },
  );

  return (
    <Card title="Нэг кино түрээс — үндсэн тохиргоо">
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <Field label="Үндсэн үнэ (₮)" hint="Кино бүр дээр тусад нь өөрчилж болно">
          <Input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label="Хугацаа (цаг)">
          <Input type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field label="Сарын багцын код" hint='"Сарын багц авах" товч энэ рүү'>
          <Input value={planCode} onChange={(e) => setPlanCode(e.target.value)} />
        </Field>
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>
          Хадгалах
        </Button>
      </div>
    </Card>
  );
}
