-- The one key under `colours` that is not a colour: a firm's opt-in to dark on its own site.
--
-- src/lib/brand.ts has held this product decision since the theme layer landed. Docket's own
-- surfaces — the client portal, the staff console — follow a visitor into the dark theme always.
-- A firm's OWN public site follows only if the firm asked for it, because in dark a firm's colour
-- is re-toned by liftForDark() so it stays legible on a dark ground — navy comes back a lighter
-- navy — and re-toning a page the firm considers theirs, unasked, is how "our green is wrong"
-- arrives in support. So the public site passes tenantAllowsDark(firm.brand) to brandStyle(), and
-- tenantAllowsDark() reads brand.colours.dark_mode.
--
-- IT COULD NEVER BE TRUE. validate_brand() (migration 13) rebuilds firms.brand from a whitelist,
-- and under `colours` it keeps a key only where the value matches '^#[0-9a-fA-F]{6}$'. A boolean
-- matches no hex regex, so dark_mode was dropped on every write that ever carried it — and since
-- the whitelist runs from a BEFORE trigger rather than a constraint, it was dropped in silence,
-- with no error for the firm or the developer to see. Every firm that will ever exist answered
-- "no" to a question that nothing in the product could ask.
--
-- THE WHITELIST IS STILL THE POINT. This function's output is rendered into a style attribute on
-- every public page of every firm, so it stays a rebuild from a list of known keys rather than a
-- filter over a supplied object: anything not named below is still dropped. Exactly one key is
-- added, and it is tested against what it actually is rather than against a regex for something
-- else. Every other key, length, character rule and lowercasing is unchanged.
--
-- ONLY A GENUINE JSON true SURVIVES. The string "true", the number 1, "yes" and every other
-- near-miss are dropped, because tenantAllowsDark() tests `=== true`: a value the database kept
-- but the site reads as false is worse than one the database never kept, since the firm would be
-- told it was saved. An absent key is the answer for every firm that has never been asked, so
-- turning the option off stores nothing rather than storing false.
--
-- The trigger is untouched: firms_brand still calls firms_validate_brand(), which still calls
-- this function by name. Replacing the body is the whole change.
--
-- The `set search_path = public` below is migration 21's, restated rather than inherited. CREATE
-- OR REPLACE FUNCTION takes every attribute from the new definition and defaults the ones it
-- leaves out, so omitting the clause here would quietly unpin the search path that migration 21
-- fixed on this exact function.

create or replace function public.validate_brand(p jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare v jsonb := '{}'; c jsonb; f jsonb; k text; x text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return '{}'; end if;
  foreach k in array array['tagline','cta','logo_path'] loop
    x := p ->> k;
    if x is not null and length(x) <= 200 and x !~ '[<>]' then v := v || jsonb_build_object(k, x); end if;
  end loop;
  c := '{}';
  foreach k in array array['primary','accent','surface'] loop
    x := p -> 'colours' ->> k;
    if x ~ '^#[0-9a-fA-F]{6}$' then c := c || jsonb_build_object(k, lower(x)); end if;
  end loop;
  -- dark_mode is a boolean sitting among the colours, so it cannot go through the loop above: that
  -- loop reads every key as text and keeps it only if it is six hex digits, which is how a true
  -- written here was dropped before this migration. The comparison is against the jsonb value
  -- `true` itself, so a quoted "true" — what an un-cast form field posts — is not taken for an
  -- opt-in, and false, null and any object or array store nothing at all.
  if p -> 'colours' -> 'dark_mode' = 'true'::jsonb then c := c || jsonb_build_object('dark_mode', true); end if;
  if c <> '{}' then v := v || jsonb_build_object('colours', c); end if;
  f := '{}';
  foreach k in array array['heading','body'] loop
    x := p -> 'fonts' ->> k;
    if x ~ '^[A-Za-z0-9 ]{1,40}$' then f := f || jsonb_build_object(k, x); end if;
  end loop;
  if f <> '{}' then v := v || jsonb_build_object('fonts', f); end if;
  c := '{}';
  foreach k in array array['email','phone','address','whatsapp'] loop
    x := p -> 'contact' ->> k;
    if x is not null and length(x) <= 200 and x !~ '[<>]' then c := c || jsonb_build_object(k, x); end if;
  end loop;
  if c <> '{}' then v := v || jsonb_build_object('contact', c); end if;
  return v;
end $$;

comment on function public.validate_brand(jsonb) is
  'Rebuilds firms.brand from a whitelist and drops everything else with no error, because it runs from a BEFORE trigger: tagline, cta and logo_path as text up to 200 characters with no angle brackets; colours.primary/accent/surface as six-digit hex, stored lowercase; colours.dark_mode only where it is the JSON boolean true; fonts.heading/body as letters, digits and spaces up to 40; contact.email/phone/address/whatsapp as text up to 200. A caller that cares what survived must re-read the row.';
