-- The client update, in a shape a client can act on.
--
-- An update to a client was a heading and a free-text note. What it meant, what happens next,
-- whether the client has to do anything and when they will hear again were left to the note —
-- and to the reader. Silence was ambiguous between "nothing needed from you" and "nobody said".
-- The assessment's #12 asks for the standard shape; the consultation-notes screen already keeps
-- one (client_summary / advice_given / follow_up) and this is the same discipline on the timeline.
--
-- Five columns on updates, each a fact the client reads by name:
--   meaning          what it means for them
--   next_step        what happens next
--   client_action    what THEY must do
--   action_required  three states, deliberately: null = not stated; false = "nothing is needed
--                    from you", said out loud; true = client_action says what. The two checks keep
--                    false and true honest — a stated "nothing" with an action, or an action with
--                    nothing stated, cannot be written.
--   next_update_by   when to expect the next update — a calendar DAY, never an instant.
--
-- post_court_update() takes them as five trailing parameters that default to null. The previous
-- signature is dropped and this one created in its place: every existing caller passes fewer
-- arguments and resolves to this function through the defaults, so main's front end and main's own
-- suite keep working unchanged, and there is one function of that name for PostgREST to choose.
alter table public.updates
  add column meaning         text,
  add column next_step       text,
  add column client_action   text,
  add column action_required boolean,
  add column next_update_by  date,
  add constraint updates_action_required_says_what
    check (action_required is distinct from true or client_action is not null),
  add constraint updates_no_action_says_nothing
    check (action_required is distinct from false or client_action is null);

comment on column public.updates.action_required is
  'null: not stated. false: "nothing is needed from you", stated. true: client_action says what. The checks keep the last two honest.';
comment on column public.updates.next_update_by is 'When the client should expect the next update. A calendar day, never an instant.';

drop function public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text,uuid,text,bool,text,text,text);

create or replace function public.post_court_update(p_matter uuid, p_outcome text, p_occurred_at timestamp with time zone DEFAULT now(), p_court_name text DEFAULT NULL::text, p_adjourned_at_instance_of text DEFAULT NULL::text, p_next_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_next_purpose text DEFAULT NULL::text, p_note_to_client text DEFAULT NULL::text, p_internal_note text DEFAULT NULL::text, p_court_id uuid DEFAULT NULL::uuid, p_judicial_division text DEFAULT NULL::text, p_allow_non_sitting boolean DEFAULT false, p_judge text DEFAULT NULL::text, p_courtroom text DEFAULT NULL::text, p_purpose_kind text DEFAULT NULL::text, p_meaning text DEFAULT NULL::text, p_next_step text DEFAULT NULL::text, p_client_action text DEFAULT NULL::text, p_action_required boolean DEFAULT NULL::boolean, p_next_update_by date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_m matters%rowtype; v_tz text := 'Africa/Lagos'; v_title text; v_update uuid; v_next_txt text; v_court courts%rowtype; v_court_name text;
begin
  select * into v_m from matters where id = p_matter and deleted_at is null;
  if not found then raise exception 'matter not found'; end if;
  if not staff_w(v_m.firm_id) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_outcome not in ('hearing_held','adjourned','ruling_delivered','judgment_delivered','struck_out','stood_down','mention',
                       'court_did_not_sit','hearing_notice','adjourned_sine_die') then
    raise exception 'unknown outcome %', p_outcome;
  end if;
  if p_outcome = 'hearing_notice' and p_next_date is null then raise exception 'a hearing notice fixes a date'; end if;
  -- The structured client update: a stated "nothing needed" and a stated action are different
  -- facts, and neither may contradict the other. Unstated (null) is allowed and is shown as such.
  if p_action_required is true and nullif(trim(p_client_action), '') is null then
    raise exception 'say what the client must do, or mark that nothing is needed from them';
  end if;
  if p_action_required is false and nullif(trim(p_client_action), '') is not null then
    raise exception 'nothing is needed from the client, so leave what they must do empty';
  end if;

  if p_court_id is not null then
    select * into v_court from courts where id = p_court_id and (firm_id is null or firm_id = v_m.firm_id);
    if not found then raise exception 'court % is not available to this firm', p_court_id; end if;
  elsif v_m.court_id is not null then
    select * into v_court from courts where id = v_m.court_id;
  end if;
  v_court_name := coalesce(p_court_name,
                           case when v_court.id is not null then v_court.name || coalesce(', ' || coalesce(p_judicial_division, v_m.judicial_division), '') end,
                           v_m.court_name);

  if p_next_date is not null and not p_allow_non_sitting
     and is_non_sitting_day((p_next_date at time zone v_tz)::date, v_court.level, v_court.state_code) then
    raise exception 'next date % is a weekend, public holiday or court vacation — confirm the vacation judge will sit (p_allow_non_sitting)',
      to_char(p_next_date at time zone v_tz, 'FMDD Mon YYYY');
  end if;

  v_next_txt := case when p_next_date is not null
                     then to_char(p_next_date at time zone v_tz, 'FMDD Mon YYYY')
                          || coalesce(' for ' || p_next_purpose, '') end;

  v_title := case p_outcome
    when 'hearing_held'       then 'Hearing held'
    when 'adjourned'          then 'Adjourned' || coalesce(' at the instance of ' || p_adjourned_at_instance_of, '')
                                   || coalesce(' to ' || v_next_txt, '')
    when 'adjourned_sine_die' then 'Adjourned sine die — a new date will be communicated by the court'
    when 'hearing_notice'     then 'Hearing notice: matter fixed for ' || v_next_txt
    when 'ruling_delivered'   then 'Ruling delivered'
    when 'judgment_delivered' then 'Judgment delivered'
    when 'struck_out'         then 'Matter struck out'
    when 'stood_down'         then 'Matter stood down'
    when 'mention'            then 'Matter came up for mention'
    when 'court_did_not_sit'  then 'Court did not sit'
  end;
  if p_outcome not in ('adjourned','hearing_notice','adjourned_sine_die') and v_next_txt is not null then
    v_title := v_title || ' — next date ' || v_next_txt;
  end if;

  insert into updates (matter_id, firm_id, kind, visibility, title, body, payload, occurred_at, posted_by,
                       meaning, next_step, client_action, action_required, next_update_by)
  values (p_matter, v_m.firm_id, 'court_sitting', 'client', v_title, p_note_to_client,
          jsonb_build_object('outcome', p_outcome, 'court_name', v_court_name, 'court_id', v_court.id,
                             'adjourned_at_instance_of', p_adjourned_at_instance_of,
                             'next_date', p_next_date, 'next_purpose', p_next_purpose, 'judge', p_judge, 'courtroom', p_courtroom),
          p_occurred_at, auth.uid(),
          nullif(trim(p_meaning), ''), nullif(trim(p_next_step), ''), nullif(trim(p_client_action), ''), p_action_required, p_next_update_by)
  returning id into v_update;

  if p_internal_note is not null and length(trim(p_internal_note)) > 0 then
    insert into updates (matter_id, firm_id, kind, visibility, title, body, occurred_at, posted_by)
    values (p_matter, v_m.firm_id, 'note', 'internal', 'Internal note — ' || v_title, p_internal_note, p_occurred_at, auth.uid());
  end if;

  -- a sitting closes the event fixed for that court day; a hearing notice does not (no sitting happened)
  if p_outcome <> 'hearing_notice' then
    update court_events set outcome_update_id = v_update
     where matter_id = p_matter and outcome_update_id is null and vacated_at is null
       and (scheduled_at at time zone v_tz)::date = (p_occurred_at at time zone v_tz)::date;
  end if;

  if p_next_date is not null then
    insert into court_events (matter_id, firm_id, scheduled_at, court_name, court_id, purpose, purpose_kind, judge, courtroom, source)
    values (p_matter, v_m.firm_id, p_next_date, v_court_name, v_court.id, p_next_purpose, p_purpose_kind, p_judge, p_courtroom,
            case when p_outcome = 'hearing_notice' then 'hearing_notice' else 'firm' end);
    update matters set next_event_at = p_next_date, next_event_note = p_next_purpose, awaiting_date = false,
                       court_name = coalesce(v_court_name, court_name),
                       court_id = coalesce(v_court.id, court_id),
                       judicial_division = coalesce(p_judicial_division, judicial_division),
                       judge = coalesce(p_judge, judge)
     where id = p_matter;
  else
    update matters set next_event_at = null, next_event_note = null, awaiting_date = (p_outcome = 'adjourned_sine_die'),
                       court_id = coalesce(v_court.id, court_id),
                       judicial_division = coalesce(p_judicial_division, judicial_division),
                       judge = coalesce(p_judge, judge)
     where id = p_matter;
  end if;

  return v_update;
end $function$;

revoke execute on function public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text,uuid,text,bool,text,text,text,text,text,text,boolean,date) from public, anon;
grant  execute on function public.post_court_update(uuid,text,timestamptz,text,text,timestamptz,text,text,text,uuid,text,bool,text,text,text,text,text,text,boolean,date) to authenticated;
