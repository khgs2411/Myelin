# Product Resolution, Authentication, And Access

ClassKit resolves a tenant product from the browser request boundary, uses Supabase only for global identity, and uses ClassKit-owned policy, access entries, and membership state to decide product access.

## Evidence status

This subject is derived from the supplied authored documentation snapshot. The snapshot contains no `class-kit-api/`, `class-kit-sdk/`, application source, migrations, or regression tests, so the behavior below is a **documented contract awaiting implementation and test verification**, not verified-current runtime behavior. The checkout is available on `master` with origin `https://github.com/khgs2411/class-kit.git` according to `repository-identity.json`; that metadata does not itself verify any access behavior.

## Product resolution

ClassKit Edge Functions accept POST JSON and resolve product context centrally. The documented request boundary in `docs/api/backend-api.md` is:

1. Require the browser `Origin`; reject a request without it.
2. Accept optional `x-class-kit-site-url` from the SDK. It must be an HTTP(S) URL with the same origin as `Origin`; query and fragment are ignored. A root path resolves as the origin, while a non-root path remains part of the site URL.
3. Resolve the product from its allowed origin and, where configured, path-aware site URL.
4. Load its auth policy and active auth redirects for the matched origin.
5. Parse an optional bearer token, then load the identity's active product-user role assignment when present.
6. Enforce provider availability for authenticated users.

Production websites must not choose a product by sending `product_key`. The only documented exception is localhost: the SDK may send `VITE_CLASS_KIT_LOCAL_PRODUCT_KEY`, and the backend accepts it only for localhost origins while still checking that origin against the product's allowed origins. A local Supabase stack can instead use `CLASS_KIT_LOCAL_PRODUCT_KEY` in the Edge Function environment. This prevents an arbitrary browser product-key claim from replacing origin validation.

`@class-kit/react` is the browser boundary. Its Vite constructor requires `authStorageKey`; production resolution is origin/site-URL based, while localhost needs the local product hint to disambiguate a shared origin. `ProductProvider` loads the session, calls `product.getContext()`, refreshes after auth changes, and reloads context after OAuth redirects (see `docs/sdk/client-sdk.md`).

## Identity, provider, and redirect boundaries

Supabase Auth owns the global `auth.users` identity and session. ClassKit owns product-local membership and authorization through `class_kit.users`, roles, permissions, and Edge Function guards. A valid session therefore proves identity only; it never grants product or platform authority by itself.

The documented currently supported product provider controls are:

| Product field | Supported values / meaning | Product-site outcome | Authority to change |
| --- | --- | --- | --- |
| `auth_mode` | `open`, `invite_only` | Controls whether a product can create membership for an eligible identity. | Product level-75 manager or a platform level-75+ admin through the level guard. |
| `email_password_enabled` | boolean | Enables password sign-in; enable sign-up UI only when also `open`. | Platform admin only. |
| `google_oauth_enabled` | boolean | Enables Google sign-in; enable sign-up affordances only when also `open`. | Platform admin only. |
| `product_auth_redirects` | provider (`google` or `apple`), environment (`development` or `production`), optional origin, URL, default flag | Supplies the redirect selected by `ProductProvider`; apps must not configure OAuth redirect URLs in SDK options or frontend env. | Platform/admin product-setup APIs. |

Provider credentials are configured once in the shared Supabase project; the documented examples are email/password and Google, while Apple is a future provider. A product redirect must be configured in both `class_kit.product_auth_redirects` and Supabase Auth's global redirect allow list. Origin-specific redirects win; an environment-scoped redirect is a fallback only when no origin-scoped redirect exists.

`signInWithGoogle()` must first load product context and select a product-managed Google redirect for the matched origin/environment. It returns an error before navigation if none is configured. OAuth can create or resolve a global `auth.users` identity before ClassKit denies product access; that is expected in the shared-auth model and is not authorization.

## Product access and membership states

`product-context` is both anonymous-aware and authentication-aware:

| Caller/resource condition | Documented context outcome |
| --- | --- |
| Signed out | Product policy, redirects, and empty capabilities; no product user or access entry. |
| Signed in with an active product user | Policy, product-user summary, effective product-local capabilities, and any applicable access entry. |
| Signed in to an open product and eligible | Context may create or confirm product membership. |
| Signed in to an invite-only product with active product access | Context may activate membership. |
| Signed in to an invite-only product without active access | No implicit membership; product access is required. |
| Platform admin without explicit product membership | No implicit `class_kit.users` row; product-local `product_user` and capability flags can remain absent/false even where a separate platform-backed level guard permits an administrative action. |

The documented `product_access` state vocabulary is `invited`, `pending`, `active`, `rejected`, and `inactive`; its documented source values are `admin_invite` and `self_request`. It exists independently from `product_user`, so product UI can explain an invitation, pending decision, rejection, or inactive access rather than treating every non-member as signed out. `product_user.status` is documented as `active` or `inactive`.

Password signup goes through `class-kit-product-signup`. It may create the global identity and product membership together only after: product resolution succeeds, `auth_mode` is `open`, `email_password_enabled` is true, and backend persistence can create the identity/profile plus product-role assignment. For invite-only products, sites should show sign-in rather than open sign-up; admin/control-plane APIs can invite, approve, reject, assign, or create users.

## Gate ordering

The documented ordering for a product-scoped request is:

```text
Origin/site URL resolution
  -> product policy and redirect selection
  -> optional Supabase identity
  -> provider availability
  -> product-access lifecycle / membership activation
  -> product or platform authorization guard
  -> operation-specific eligibility, approval, capacity, stock, and state-transition rules
```

This ordering keeps access separate from authorization. For example, a platform admin can satisfy a documented product-scoped numeric level guard without becoming a customer-facing product member, but cannot satisfy a product-scoped permission-key guard merely through platform level. Product membership/access remains necessary for customer-facing product flows.

For user-visible mutations, later resource gates remain backend-owned: registration policy, approval policy, capacity, membership stock, cancellation cutoff, and lifecycle transitions are described in `docs/api/backend-api.md` as backend concerns. The snapshot has no migration/RPC/test evidence establishing the precise precedence among those later gates, so this page does not infer a full rejection-order matrix.

## Documentation conflict needing review

The authored docs describe invite-only access inconsistently. `docs/shared/authentication.md` says `invite_only` means a user must already have product membership, while `docs/api/backend-api.md` says an active `product_access` entry is required before membership can be activated and `docs/product-shape.md` describes invitation records/access state. The latter supports a distinct pre-membership access lifecycle; the former is either simplified wording or stale. Implementation and regression tests must establish the authoritative invite-only transition before this can be documented as verified behavior.

## Known gaps

- No implementation, migration, or regression-test evidence was supplied for product resolution, provider enforcement, redirects, access state transitions, or membership creation.
- The complete eligibility rule for open-mode implicit membership is not specified beyond "eligible"; identity/email/status constraints are not enumerated.
- Exact transition rules for `product_access` statuses, including who can create a `self_request` and whether an active entry is consumed or retained after membership activation, are not documented.
- Invite-only behavior has the conflict described above and needs backend/migration plus regression-test evidence.
- Provider enforcement is described at the contract level, but there is no test evidence for disabled-provider attempts, malformed/mismatched site URLs, localhost hint rejection, redirect fallback, or OAuth post-redirect denial.
- Exact precedence between access/membership gates and registration eligibility, approval, capacity, stock, and class lifecycle gates is unverified.
