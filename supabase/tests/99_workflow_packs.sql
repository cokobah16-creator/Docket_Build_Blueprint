-- A pack is versioned data the platform publishes; a firm installs one and gets stages it lacks,
-- keeps the stages it has exactly as they read, and never has a live matter rewritten. A stage
-- change is one act: the matter moves, the client is told, the stage's work is started once.
-- Run alone or with the others. Rolls back.
begin;

create or replace function t_as(u uuid, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aal', aal)::text, false);
  perform set_config('role', 'authenticated', false);
end $$;
create or replace function t_reset() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;
create or replace function t_check(name text, ok bool) returns void language plpgsql as $$
begin if ok then raise notice 'PASS  %', name; else raise exception 'FAIL  %', name; end if; end $$;
create or replace function t_refused(stmt text, code text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlstate = code; end $$;
create or replace function t_fails(stmt text, fragment text) returns bool language plpgsql as $$
begin execute stmt; return false; exception when others then return sqlerrm like '%' || fragment || '%'; end $$;
create or replace function t_audit(p_action text, p_entity uuid) returns jsonb language sql security definer as $$
  select jsonb_build_object('firm_id', firm_id, 'actor_id', actor_id, 'meta', meta) from audit_log where action = p_action and (p_entity is null or entity_id = p_entity) order by at desc limit 1 $$;

-- ---------------------------------------------------------------- fixture
create temp table fx (k text primary key, v uuid);
grant select on fx to anon, authenticated;
insert into fx select 'firm', id from firms where slug = 'attorneys-klinique';
insert into auth.users (id, email) values (gen_random_uuid(), 'wp-owner@test'), (gen_random_uuid(), 'wp-lawyer@test'), (gen_random_uuid(), 'wp-client@test'), (gen_random_uuid(), 'wp-admin@test');
insert into fx select 'owner', id from auth.users where email = 'wp-owner@test';
insert into fx select 'lawyer', id from auth.users where email = 'wp-lawyer@test';
insert into fx select 'client', id from auth.users where email = 'wp-client@test';
insert into fx select 'padmin', id from auth.users where email = 'wp-admin@test';
insert into firm_members (firm_id, user_id, role) values
  ((select v from fx where k='firm'), (select v from fx where k='owner'), 'owner'),
  ((select v from fx where k='firm'), (select v from fx where k='lawyer'), 'lawyer');
insert into platform_admins (user_id, note) values ((select v from fx where k='padmin'), 'packs suite');
-- The firm's own label on a stage the litigation pack also carries: it must survive an install untouched.
update matter_statuses set label = 'Filed (our wording)' where firm_id = (select v from fx where k='firm') and key = 'filed';

-- ---------------------------------------------------------------- 1. the catalogue is the platform's; a pack version is immutable
do $$
declare pa uuid := (select v from fx where k='padmin'); ow uuid := (select v from fx where k='owner'); v int;
begin
  perform t_check('Docket''s two defaults are published, each once', (select count(*) = 2 from workflow_packs where version = 1 and key in ('litigation', 'conveyancing')));
  perform t_as(ow);
  perform t_check('a firm reads the catalogue', (select count(*) >= 2 from workflow_packs));
  perform t_check('and cannot publish to it', t_refused('select publish_workflow_pack(''x_pack'', ''X'', null, ''{"statuses":[{"key":"stage_a","label":"Stage A"}]}''::jsonb)', '42501')
                                             and t_refused('insert into workflow_packs (key, version, name, definition) values (''y_pack'', 1, ''Y'', ''{}'')', '42501'));
  perform t_reset(); perform t_as(pa, 'aal1');
  perform t_check('nor a platform admin without a second factor', t_refused('select publish_workflow_pack(''x_pack'', ''X'', null, ''{"statuses":[{"key":"stage_a","label":"Stage A"}]}''::jsonb)', '42501'));
  perform t_reset(); perform t_as(pa);
  perform t_check('a pack without stages is refused', t_fails('select publish_workflow_pack(''x_pack'', ''X'', null, ''{"statuses":[]}''::jsonb)', 'at least one stage'));
  perform t_check('a template on a stage the pack lacks is refused', t_fails('select publish_workflow_pack(''x_pack'', ''X'', null, ''{"statuses":[{"key":"stage_a","label":"Stage A"}],"task_templates":[{"key":"task_one","title":"Do it","on_status_key":"zzz"}]}''::jsonb)', 'which the pack does not have'));
  perform t_check('a stage key twice is refused', t_fails('select publish_workflow_pack(''x_pack'', ''X'', null, ''{"statuses":[{"key":"stage_a","label":"Stage A"},{"key":"stage_a","label":"Again"}]}''::jsonb)', 'appears twice'));
  v := publish_workflow_pack('litigation', 'Litigation', null,
        '{"statuses":[{"key":"new_inquiry","label":"New Inquiry","sort":10},{"key":"pre_action","label":"Pre-action Letter","colour":"blue","sort":15,"next_action":"Send the pre-action letter"},{"key":"filed","label":"Filed in Court (v2 wording)","sort":65},{"key":"completed","label":"Completed","is_terminal":true,"sort":90}],
          "task_templates":[{"key":"open_file_note","title":"Open the file (v2)","on_status_key":"new_inquiry","due_offset_days":2,"assignee":"lead"},{"key":"pre_action_letter","title":"Send the pre-action letter","on_status_key":"pre_action","due_offset_days":7,"assignee":"lead"},{"key":"serve_process","title":"Serve the process (v2)","on_status_key":"filed","due_offset_days":7,"assignee":"lead"},{"key":"diarise_return_date","title":"Diarise the return date","on_status_key":"filed","due_offset_days":1}]}'::jsonb, 'suite: version 2');
  perform t_check('publishing again is a new version, the old one untouched', v = 2 and (select count(*) = 2 from workflow_packs where key = 'litigation') and (select name = 'Litigation' from workflow_packs where key = 'litigation' and version = 1));
  perform t_check('publishing is audited, and the platform reads it', exists (select 1 from audit_log where action = 'workflow_pack.published' and (meta ->> 'version')::int = 2));
  perform t_check('a published version cannot be changed', t_refused('update workflow_packs set name = ''x'' where key = ''litigation'' and version = 2', '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 2. installing adds, recognises, never rewrites
do $$
declare ow uuid := (select v from fx where k='owner'); l uuid := (select v from fx where k='lawyer'); f uuid := (select v from fx where k='firm'); r jsonb; n_before int;
begin
  select count(*) into n_before from matter_statuses where firm_id = f;
  perform t_as(l);
  perform t_check('a lawyer does not install a pack', t_refused(format('select install_workflow_pack(%L, ''litigation'')', f), '42501'));
  perform t_reset(); perform t_as(ow);
  r := install_workflow_pack(f, 'litigation', 1);
  perform t_check('installing litigation v1 on a firm already on those stages recognises them and adds none',
    (r ->> 'statuses_added')::int = 0 and (r ->> 'statuses_recognised')::int = 15 and (select count(*) from matter_statuses where firm_id = f) = n_before
    and (select label = 'Filed (our wording)' and pack_key = 'litigation' and pack_version = 1 and matter_types is null from matter_statuses where firm_id = f and key = 'filed'));
  perform t_check('the ledger says so, and the firm reads it', (select installed_version = 1 and installed_by = ow from firm_workflow_packs where firm_id = f and pack_key = 'litigation'));
  perform t_check('and it is audited for the firm', (t_audit('workflow_pack.installed', null) ->> 'firm_id')::uuid = f and (t_audit('workflow_pack.installed', null) -> 'meta' ->> 'statuses_recognised')::int = 15);
  r := install_workflow_pack(f, 'litigation', 2);
  perform t_check('upgrading adds the new stage and leaves the firm''s own wording on the old one',
    (r ->> 'statuses_added')::int = 1 and (select label = 'Filed (our wording)' and pack_version = 2 from matter_statuses where firm_id = f and key = 'filed')
    and (select label = 'Pre-action Letter' and pack_version = 2 and default_next_action = 'Send the pre-action letter' from matter_statuses where firm_id = f and key = 'pre_action')
    and (select installed_version = 2 from firm_workflow_packs where firm_id = f and pack_key = 'litigation'));
  perform t_check('going back is refused', t_fails(format('select install_workflow_pack(%L, ''litigation'', 1)', f), 'already on version 2'));
  perform t_check('installing the same version again changes nothing', (install_workflow_pack(f, 'litigation', 2) ->> 'statuses_added')::int = 0);
  perform t_check('a pack nobody published is refused', t_fails(format('select install_workflow_pack(%L, ''pigeon'')', f), 'no such pack'));
  r := install_workflow_pack(f, 'conveyancing');
  -- "recognised" means stamped by this install. completed and closed are already the litigation
  -- pack's, so conveyancing leaves them exactly as they are and says so under its own name rather
  -- than counting rows it did not touch.
  perform t_check('conveyancing adds its stages for property matters only, sharing completed and closed',
    (r ->> 'version')::int = 1 and (r ->> 'statuses_added')::int = 7
    and (r ->> 'statuses_recognised')::int = 0 and (r ->> 'statuses_of_another_pack')::int = 2
    and (select matter_types = array['property']::matter_type[] from matter_statuses where firm_id = f and key = 'title_search')
    and (select matter_types is null and pack_key = 'litigation' from matter_statuses where firm_id = f and key = 'completed'));
  perform t_check('the stages are audited', exists (select 1 from audit_log where action = 'matter_statuses.insert' and firm_id = f));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 3. a stage change is one act
do $$
declare l uuid := (select v from fx where k='lawyer'); cl uuid := (select v from fx where k='client'); f uuid := (select v from fx where k='firm'); r jsonb; m uuid; mp uuid; n_tasks int;
begin
  perform t_as(l);
  perform t_check('an unknown status key refuses to open the matter', t_fails(format('select open_matter(%L, ''Lost stage'', ''litigation'', null, null, null, null, null, null, null, null, ''nope'')', f), 'unknown status "nope"'));
  perform t_check('a stage for property matters does not open a litigation one', t_fails(format('select open_matter(%L, ''Wrong pack'', ''litigation'', null, null, null, null, null, null, null, null, ''title_search'')', f), 'is for property matters'));
  r := open_matter(f, 'Okafor v Chukwu', 'litigation', cl);
  m := (r ->> 'matter_id')::uuid;
  perform t_check('opening on the entry stage starts its work and suggests its next action',
    (r ->> 'tasks_created')::int = 1 and (select next_action = 'Take instructions and open the file' from matters where id = m)
    and (select count(*) = 1 from tasks where matter_id = m and template_key = 'open_file_note' and assignee_id = l and status = 'open')
    and (t_audit('matter.opened', m) -> 'meta' ->> 'status_key') = 'new_inquiry');
  r := open_matter(f, 'Sale of Plot 12', 'property', null, null, null, null, null, null, null, null, 'instructions_received');
  mp := (r ->> 'matter_id')::uuid;
  perform t_check('a property matter opens on a conveyancing stage', (r ->> 'tasks_created')::int = 1 and (select template_key = 'collect_title_docs' from tasks where matter_id = mp));
  perform t_check('an unknown stage is refused on a change', t_fails(format('select set_matter_status(%L, ''nope'')', m), 'unknown status "nope"'));
  perform t_check('a conveyancing stage is refused on a litigation matter', t_fails(format('select set_matter_status(%L, ''title_search'')', m), 'is for property matters'));
  update matters set next_action = 'Call the client' where id = m;   -- as the lawyer, a plain update
  r := set_matter_status(m, 'filed', 'We filed the suit today; the court will fix a date.');
  perform t_check('the matter moves, the client is told, and the stage''s tasks are made once — the lead on the one that names them',
    (select status_id = (select id from matter_statuses where firm_id = f and key = 'filed') from matters where id = m)
    and (r ->> 'tasks_created')::int = 2
    and (select count(*) = 2 from tasks where matter_id = m and status_key = 'filed' and pack_key = 'litigation')
    and (select assignee_id = l and due_at is not null from tasks where matter_id = m and template_key = 'serve_process')
    and (select assignee_id is null from tasks where matter_id = m and template_key = 'diarise_return_date')
    and exists (select 1 from updates where matter_id = m and kind = 'status_change' and visibility = 'client' and title = 'Status: Filed (our wording)' and body like 'We filed%' and payload ->> 'from_status_key' = 'new_inquiry'));
  perform t_check('a next action already written is left alone', (select next_action = 'Call the client' from matters where id = m));
  perform t_check('the change is audited', (t_audit('matter.status_changed', m) -> 'meta' ->> 'to') = 'filed' and (t_audit('matter.status_changed', m) -> 'meta' ->> 'tasks_created')::int = 2);
  select count(*) into n_tasks from tasks where matter_id = m;
  r := set_matter_status(m, 'filed');
  perform t_check('setting the same stage again doubles nothing and posts nothing', (r ->> 'tasks_created')::int = 0 and (select count(*) from tasks where matter_id = m) = n_tasks
    and (select count(*) = 1 from updates where matter_id = m and kind = 'status_change'));
  perform t_check('the task template is the v2 wording, because the firm is on v2', exists (select 1 from tasks where matter_id = m and template_key = 'serve_process' and title = 'Serve the process (v2)'));
  r := set_matter_status(m, 'completed');
  perform t_check('a terminal stage closes the file today, in the firm''s calendar', (r ->> 'closed')::bool and (select closed_at = (now() at time zone coalesce((select timezone from firms where id = f), 'Africa/Lagos'))::date from matters where id = m));
  r := set_matter_status(m, 'hearing');
  perform t_check('and leaving it reopens the file', (select closed_at is null from matters where id = m));
  update matter_statuses set label = 'x' where firm_id = f and key = 'filed';   -- the policy is admin_w: the write finds no row
  perform t_check('a lawyer cannot rewrite a stage past the policy', (select label = 'Filed (our wording)' from matter_statuses where firm_id = f and key = 'filed'));
  perform t_reset(); perform t_as(cl, 'aal1');
  perform t_check('the client reads the stage change and the stage''s label, and none of the tasks',
    exists (select 1 from updates where matter_id = m and kind = 'status_change') and exists (select 1 from matter_statuses where firm_id = f and key = 'pre_action')
    and (select count(*) = 0 from tasks) and (select count(*) = 0 from firm_workflow_packs) and t_refused(format('select set_matter_status(%L, ''filed'')', m), '42501'));
  perform t_reset();
end $$;

-- ---------------------------------------------------------------- 4. an owner corrects the firm's own wording; a new firm is untouched by all this
do $$
declare ow uuid := (select v from fx where k='owner'); f uuid := (select v from fx where k='firm'); nf uuid;
begin
  perform t_as(ow);
  update matter_statuses set label = 'Filed at the registry', colour = 'green', sort = 64 where firm_id = f and key = 'filed';
  perform t_check('an owner relabels a stage, and the change is audited', (select label = 'Filed at the registry' from matter_statuses where firm_id = f and key = 'filed')
    and exists (select 1 from audit_log where action = 'matter_statuses.update' and firm_id = f and meta -> 'changed' ? 'label'));
  perform t_reset();
  insert into firms (id, slug, name, reference_prefix) values (gen_random_uuid(), 'wp-new', 'New Chambers', 'NC') returning id into nf;
  perform seed_firm_defaults(nf);
  perform t_check('a new firm still starts with the fifteen stages and no pack on its ledger', (select count(*) = 15 from matter_statuses where firm_id = nf) and (select count(*) = 0 from firm_workflow_packs where firm_id = nf));
end $$;

-- ---------------------------------------------------------------- a firm that installs conveyancing FIRST
-- The stage's reach is the stage's own, not the pack's. A property pack writing {property} onto
-- "completed" and "closed" would leave every litigation matter at that firm impossible to close,
-- for ever, and installing litigation afterwards would not undo it.
do $$
declare ow uuid; f2 uuid; r jsonb; mt uuid;
begin
  perform t_reset();
  insert into firms (slug, name, reference_prefix, status) values ('wp-conv', 'Conveyancing First', 'CF', 'active') returning id into f2;
  insert into auth.users (id, email) values (gen_random_uuid(), 'wp-conv-owner@test') returning id into ow;
  insert into firm_members (firm_id, user_id, role) values (f2, ow, 'owner');
  delete from matter_statuses where firm_id = f2;          -- a firm with no stages of its own yet
  perform t_as(ow);
  r := install_workflow_pack(f2, 'conveyancing');
  perform t_check('the shared terminal stages are not scoped to property',
    (select matter_types is null from matter_statuses where firm_id = f2 and key = 'completed')
    and (select matter_types is null from matter_statuses where firm_id = f2 and key = 'closed')
    and (select matter_types = array['property']::matter_type[] from matter_statuses where firm_id = f2 and key = 'title_search'));
  mt := (open_matter(f2, 'A debt claim', 'litigation') ->> 'matter_id')::uuid;
  -- The call first, then the reading of what it did: `a and b` in SQL does not promise to run a
  -- before b, and a check that reads the row before the function wrote it fails for the wrong reason.
  r := set_matter_status(mt, 'completed');
  perform t_check('so a litigation matter at a conveyancing firm can still be completed and closed',
    (r ->> 'closed')::bool
    and (select status_id = (select id from matter_statuses where firm_id = f2 and key = 'completed')
             and closed_at is not null from matters where id = mt));
  perform t_reset();
end $$;

do $$ begin raise notice 'ALL CHECKS PASSED'; end $$;
rollback;
