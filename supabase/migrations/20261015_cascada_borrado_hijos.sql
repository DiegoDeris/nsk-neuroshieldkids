-- Derecho de supresión (RGPD Art. 17) y lo que promete nuestra política:
-- "eliminar tu cuenta borra irreversiblemente todos tus datos".
--
-- No era cierto. usage_events, predictions, quests y rules no tenían clave
-- ajena a children: al borrar un hijo, sus datos de conducta se quedaban en
-- la base para siempre. Había 51 registros huérfanos de niños ya borrados,
-- 37 de ellos eventos de uso.
delete from usage_events e where not exists (select 1 from children c where c.id = e.child_id);
delete from predictions p where not exists (select 1 from children c where c.id = p.child_id);
delete from quests q      where not exists (select 1 from children c where c.id = q.child_id);
delete from rules r       where not exists (select 1 from children c where c.id = r.child_id);

alter table public.usage_events add constraint usage_events_child_id_fkey
  foreign key (child_id) references public.children(id) on delete cascade;
alter table public.predictions  add constraint predictions_child_id_fkey
  foreign key (child_id) references public.children(id) on delete cascade;
alter table public.quests       add constraint quests_child_id_fkey
  foreign key (child_id) references public.children(id) on delete cascade;
alter table public.rules        add constraint rules_child_id_fkey
  foreign key (child_id) references public.children(id) on delete cascade;
