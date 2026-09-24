import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { safeNext, loginHref } from '../../src/lib/auth-redirect.ts';

test('sign-in return paths stay on the site after query decoding', () => {
  for (const raw of ['//evil.example', '/\\evil.example', '/\t/evil.example', '/\r\n/evil.example',
    '/\0/evil.example', 'https://evil.example', '/firm/login', '/firm/security/mfa']) {
    assert.equal(safeNext(raw), null, raw);
  }
  const decoded = new URL('https://docket.example/auth/callback?next=/%09/evil.example').searchParams.get('next');
  assert.equal(safeNext(decoded), null);
  assert.equal(safeNext('/app/matters/123?tab=messages'), '/app/matters/123?tab=messages');
  assert.equal(loginHref('client', decoded), '/app/login');
});
