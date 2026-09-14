/**
 * copy-crm.mjs — the hosted preview's data (WO-124): Vega Vista's CRM rows, copied from THEIR
 * Supabase project into Erik's dev project. Nothing is ever written to theirs.
 *
 *   . ./scripts/preview/supabase-token.ps1          once per PowerShell: the CLI's token, in memory
 *   node scripts/preview/copy-crm.mjs counts        row counts, production and dev
 *   node scripts/preview/copy-crm.mjs plan          tables, columns and sizes compared; writes nothing
 *   node scripts/preview/copy-crm.mjs copy --login <email>[=<Display Name>] ...
 *                                                   read production once, replace dev's CRM rows
 *
 * Production (llpribdacnlejtefnvtm) is reached ONLY through prodSelect(): one SELECT per call,
 * no ";" in it, sent to the Management API's /database/query/read-only endpoint, which runs it as
 * supabase_read_only_user inside a read-only transaction. Every statement is printed as it is
 * sent. devQuery() can reach the dev project (fcxmtlbrwfbbjudjmloh) and nothing else.
 *
 * The data read is ONE statement (one snapshot, so an order and its customer come from the same
 * instant). Their rows live in this process's memory only: no file, no log of the data.
 *
 * Users: auth.users is not copied (no password, identity or session leaves their project). The
 * copied rows point at production user ids through ~20 foreign keys, so every such id gets a
 * placeholder in dev's auth.users: no password, banned, a made-up address. The --login users
 * (Filip, Wilmer) keep their production id when they have one — so the orders and customers they
 * own stay theirs with nothing re-pointed — get their real address, no ban, and the admin role;
 * their password is set afterwards by set-passwords.ps1 on Erik's terminal.
 */

const PROD = "llpribdacnlejtefnvtm"; // Vega Vista's own project: read-only endpoint only
const DEV = "fcxmtlbrwfbbjudjmloh"; // Erik's vega-vista-dev: the only write target
const API = "https://api.supabase.com/v1/projects";

// WO-124 §1: the CRM's own tables, parents before children.
const LISTED = [
  "profiles",
  "user_roles",
  "seller_compensation",
  "customers",
  "products",
  "product_packages",
  "campaigns",
  "materials",
  "deals",
  "leads",
  "activities",
  "orders",
  "order_items",
  "order_materials",
  "customer_lists",
  "customer_list_rows",
  "customer_comments",
];
// Not on the §1 list but the same CRM's own rows, no credential in them: without
// package_products the packages list no screens, without order_splits an order loses how its
// sale is split between sellers, and without the two budget tables the dashboard and Budget
// page measure their real sales against the seed's budget.
const EXTRA = ["package_products", "order_splits", "company_settings", "seller_monthly_budgets"];
const COPY = [...LISTED, ...EXTRA];
// Never copied (WO-124 §1 and §4): logins, credentials, tokens, portal users. Storage objects
// are not rows here at all; auth.users is represented by placeholders (see above).
const NEVER = ["seller_credentials", "fortnox_tokens", "screen_owners"];
// The seed's demo sellers: their logins are removed with the seed rows. The demo admin stays.
const SEED_SELLERS = ["anna@vegavista.test", "bjorn@vegavista.test", "cecilia@vegavista.test"];
const DEMO_ADMIN = "admin@vegavista.test";

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("SUPABASE_ACCESS_TOKEN is not set. First: . ./scripts/preview/supabase-token.ps1");
  process.exit(2);
}

async function post(url, query) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  return JSON.parse(text);
}

/** The only door to production: one SELECT, read-only endpoint, printed as sent. */
async function prodSelect(sql) {
  const s = sql.trim();
  if (!/^select\s/i.test(s) || s.includes(";")) {
    throw new Error(`prodSelect refuses anything but a single SELECT: ${s.slice(0, 120)}`);
  }
  console.log(`\nPROD ${PROD} · read-only endpoint · ${new Date().toISOString()}\n  ${s}`);
  return post(`${API}/${PROD}/database/query/read-only`, s);
}

/** The dev project, and only the dev project. */
function devQuery(sql) {
  return post(`${API}/${DEV}/database/query`, sql);
}

const countsSql = (tables) =>
  `select ${tables.map((t) => `(select count(*) from public.${t}) as ${t}`).join(", ")}`;

const SCHEMA_SQL =
  "select c.table_name, c.column_name, c.udt_name, c.is_nullable, c.is_generated, c.column_default " +
  "from information_schema.columns c join information_schema.tables t " +
  "on t.table_schema = c.table_schema and t.table_name = c.table_name " +
  "where c.table_schema = 'public' and t.table_type = 'BASE TABLE' " +
  "order by c.table_name, c.ordinal_position";

const ENUM_SQL =
  "select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid " +
  "where t.typnamespace = 'public'::regnamespace order by t.typname, e.enumsortorder";

const SIZE_SQL =
  "select c.relname, pg_total_relation_size(c.oid) as bytes from pg_class c " +
  "where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by c.relname";

function byTable(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.table_name)) m.set(r.table_name, []);
    m.get(r.table_name).push(r);
  }
  return m;
}

function enumMap(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.typname)) m.set(r.typname, new Set());
    m.get(r.typname).add(r.enumlabel);
  }
  return m;
}

/** Columns both sides have, and what differs. Generated columns are never inserted. */
function comparePlan(prodCols, devCols, prodEnums, devEnums) {
  const out = [];
  for (const t of COPY) {
    const p = prodCols.get(t);
    const d = devCols.get(t);
    if (!p) {
      out.push({ table: t, problem: "not in production" });
      continue;
    }
    if (!d) {
      out.push({ table: t, problem: "not in dev" });
      continue;
    }
    const dByName = new Map(d.map((c) => [c.column_name, c]));
    const pNames = new Set(p.map((c) => c.column_name));
    const common = p
      .filter(
        (c) => dByName.has(c.column_name) && dByName.get(c.column_name).is_generated !== "ALWAYS",
      )
      .map((c) => c.column_name);
    const onlyProd = p.filter((c) => !dByName.has(c.column_name)).map((c) => c.column_name);
    const onlyDev = d.filter((c) => !pNames.has(c.column_name));
    const devRequired = onlyDev
      .filter(
        (c) => c.is_nullable === "NO" && c.column_default === null && c.is_generated !== "ALWAYS",
      )
      .map((c) => c.column_name);
    const typeClash = p
      .filter(
        (c) => dByName.has(c.column_name) && dByName.get(c.column_name).udt_name !== c.udt_name,
      )
      .map((c) => `${c.column_name} ${c.udt_name}→${dByName.get(c.column_name).udt_name}`);
    const enumGaps = [];
    for (const c of p) {
      const dc = dByName.get(c.column_name);
      if (!dc) continue;
      const pe = prodEnums.get(c.udt_name.replace(/^_/, ""));
      const de = devEnums.get(dc.udt_name.replace(/^_/, ""));
      if (pe && de) {
        const missing = [...pe].filter((l) => !de.has(l));
        if (missing.length) enumGaps.push(`${c.column_name}: ${missing.join(", ")}`);
      }
    }
    out.push({
      table: t,
      common,
      onlyProd,
      onlyDev: onlyDev.map((c) => c.column_name),
      devRequired,
      typeClash,
      enumGaps,
    });
  }
  return out;
}

async function readSchemas() {
  const [pc, pe, ps] = [
    await prodSelect(SCHEMA_SQL),
    await prodSelect(ENUM_SQL),
    await prodSelect(SIZE_SQL),
  ];
  const [dc, de] = [await devQuery(SCHEMA_SQL), await devQuery(ENUM_SQL)];
  return {
    prodCols: byTable(pc),
    devCols: byTable(dc),
    prodEnums: enumMap(pe),
    devEnums: enumMap(de),
    prodSizes: ps,
  };
}

async function cmdCounts() {
  const verbatim = await prodSelect(
    "select (select count(*) from customers) c, (select count(*) from orders) o",
  );
  console.log(JSON.stringify(verbatim));
  const prod = (await prodSelect(countsSql(COPY)))[0];
  const dev = (await devQuery(countsSql(COPY)))[0];
  console.log("\ntable                    production   dev");
  for (const t of COPY) {
    console.log(`${t.padEnd(24)} ${String(prod[t]).padStart(10)} ${String(dev[t]).padStart(6)}`);
  }
}

async function cmdPlan() {
  const s = await readSchemas();
  const prodTables = [...s.prodCols.keys()];
  const devTables = new Set(s.devCols.keys());
  const sizes = new Map(s.prodSizes.map((r) => [r.relname, Number(r.bytes)]));
  console.log("\nProduction public tables:");
  for (const t of prodTables) {
    const verdict = COPY.includes(t)
      ? "COPY"
      : NEVER.includes(t)
        ? "never"
        : devTables.has(t)
          ? "not copied (dev keeps its own rows)"
          : "not copied (not in dev)";
    console.log(`  ${t.padEnd(26)} ${String(sizes.get(t) ?? "?").padStart(10)} B  ${verdict}`);
  }
  for (const p of comparePlan(s.prodCols, s.devCols, s.prodEnums, s.devEnums)) {
    if (p.problem) {
      console.log(`\n${p.table}: ${p.problem}`);
      continue;
    }
    const notes = [];
    if (p.onlyProd.length)
      notes.push(`production-only columns (not copied): ${p.onlyProd.join(", ")}`);
    if (p.onlyDev.length) notes.push(`dev-only columns: ${p.onlyDev.join(", ")}`);
    if (p.devRequired.length)
      notes.push(`!! dev-only NOT NULL without default: ${p.devRequired.join(", ")}`);
    if (p.typeClash.length) notes.push(`!! type differs: ${p.typeClash.join(", ")}`);
    if (p.enumGaps.length) notes.push(`!! enum values dev lacks: ${p.enumGaps.join("; ")}`);
    console.log(
      `\n${p.table}: ${p.common.length} columns copied${notes.length ? "\n  " + notes.join("\n  ") : ""}`,
    );
  }
}

function parseLogins(argv) {
  const logins = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--login") continue;
    const [email, name] = String(argv[++i] ?? "").split("=");
    if (!/^[^@\s]+@[^@\s]+$/.test(email ?? ""))
      throw new Error(`--login needs an email, got "${email}"`);
    logins.push({ email: email.toLowerCase(), name: name ?? null });
  }
  return logins;
}

const sqlText = (s) =>
  s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`;

async function cmdCopy(argv) {
  const logins = parseLogins(argv);
  if (!logins.length) throw new Error("copy needs at least one --login <email>[=<Display Name>]");

  const s = await readSchemas();
  const plan = comparePlan(s.prodCols, s.devCols, s.prodEnums, s.devEnums);
  const blockers = plan.filter(
    (p) => p.problem || p.devRequired.length || p.typeClash.length || p.enumGaps.length,
  );
  if (blockers.length) {
    throw new Error(`Refusing to copy; run "plan" and resolve: ${JSON.stringify(blockers)}`);
  }

  // Dev's foreign keys into auth.users from the copied tables: every id they hold needs a row.
  const fks = await devQuery(
    "select c.conrelid::regclass::text as child, a.attname as col from pg_constraint c " +
      "join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) " +
      "where c.contype = 'f' and c.confrelid = 'auth.users'::regclass " +
      "and c.connamespace = 'public'::regnamespace",
  );
  const devAdmin = (
    await devQuery(`select id from auth.users where email = ${sqlText(DEMO_ADMIN)}`)
  )[0]?.id;
  if (!devAdmin) throw new Error(`No ${DEMO_ADMIN} in dev's auth.users; the demo admin must stay.`);

  // ---- the one data read: every table in one statement, one snapshot, raw JSON text
  const dataSql =
    "select " +
    COPY.map(
      (t) => `(select coalesce(json_agg(x), '[]'::json) from public.${t} x)::text as ${t}`,
    ).join(", ");
  const snap = (await prodSelect(dataSql))[0];
  const data = new Map(COPY.map((t) => [t, snap[t]]));
  const rows = new Map(COPY.map((t) => [t, JSON.parse(snap[t])]));

  // ---- users: every production id the copied rows point at
  const profiles = rows.get("profiles");
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const userIds = new Set(profiles.map((p) => p.id));
  for (const { child, col } of fks) {
    const t = child.replace(/^public\./, "");
    if (!rows.has(t)) continue;
    for (const r of rows.get(t)) if (r[col]) userIds.add(r[col]);
  }
  const loginByEmail = new Map(logins.map((l) => [l.email, l]));
  const users = [];
  for (const id of userIds) {
    const p = profileById.get(id);
    const email = p?.email ? String(p.email).toLowerCase() : null;
    const login = email && loginByEmail.get(email);
    users.push({
      id,
      email: login ? email : `preview-stub-${id}@vegavista-preview.invalid`,
      full_name: (login?.name && !p?.full_name ? login.name : p?.full_name) ?? null,
      login: Boolean(login),
    });
    if (login) loginByEmail.delete(email);
  }
  // --login addresses with no production profile: a new user with a new id and its own profile.
  const newProfiles = [];
  for (const l of loginByEmail.values()) {
    const id = crypto.randomUUID();
    users.push({ id, email: l.email, full_name: l.name, login: true });
    newProfiles.push({ id, full_name: l.name, email: l.email });
  }
  const loginIds = users.filter((u) => u.login).map((u) => u.id);

  // ---- the load: one transaction on dev
  const tag = `$vv${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}$`;
  for (const [t, text] of data) if (text.includes(tag)) throw new Error(`dollar tag clash in ${t}`);
  const usersJson = JSON.stringify(users);
  const colsOf = new Map(plan.map((p) => [p.table, p.common]));
  const q = (c) => `"${c.replace(/"/g, '""')}"`;

  const parts = [];
  parts.push("begin");
  // 1. The seed goes, with the database's own cascades (fortnox.customer_links and
  //    project_links follow their customers and screens; fortnox.invoices.order_id is nulled).
  parts.push(`delete from auth.users where email in (${SEED_SELLERS.map(sqlText).join(", ")})`);
  for (const t of [...COPY].reverse()) {
    if (t === "profiles" || t === "user_roles") continue;
    parts.push(`delete from public.${t}`);
  }
  parts.push(`delete from public.user_roles where user_id <> '${devAdmin}'`);
  parts.push(`delete from public.profiles where id <> '${devAdmin}'`);
  // 2. Their rows go in exactly as read: no trigger rewrites them (updated_at, won_at,
  //    handle_new_user), so the load runs with triggers — and with them the FK checks — off.
  //    Step 4 re-checks every foreign key by hand before the commit.
  parts.push("set local session_replication_role = replica");
  parts.push(
    "insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, " +
      "raw_app_meta_data, raw_user_meta_data, created_at, updated_at, banned_until, confirmation_token, " +
      "recovery_token, email_change_token_new, email_change, email_change_token_current, phone_change, " +
      "phone_change_token, reauthentication_token, is_sso_user, is_anonymous) " +
      "select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(), " +
      `'{"provider":"email","providers":["email"]}'::jsonb, ` +
      "jsonb_strip_nulls(jsonb_build_object('full_name', case when u.login then u.full_name end, " +
      "'preview_placeholder', not u.login)), now(), now(), " +
      "case when u.login then null else '2999-12-31'::timestamptz end, '', '', '', '', '', '', '', '', false, false " +
      `from json_to_recordset(${tag}${usersJson}${tag}::json) as u(id uuid, email text, full_name text, login boolean) ` +
      "on conflict (id) do nothing",
  );
  parts.push(
    "insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at) " +
      "select gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, " +
      "'email_verified', true, 'phone_verified', false), 'email', now(), now() " +
      `from json_to_recordset(${tag}${usersJson}${tag}::json) as u(id uuid, email text, full_name text, login boolean) ` +
      "where u.login on conflict (provider_id, provider) do nothing",
  );
  for (const t of COPY) {
    const cols = colsOf.get(t).map(q).join(", ");
    parts.push(
      `insert into public.${t} (${cols}) select ${cols} from json_populate_recordset(null::public.${t}, ${tag}${data.get(t)}${tag}::json)`,
    );
  }
  if (newProfiles.length) {
    parts.push(
      "insert into public.profiles (id, full_name, email) select p.id, p.full_name, p.email " +
        `from json_to_recordset(${tag}${JSON.stringify(newProfiles)}${tag}::json) as p(id uuid, full_name text, email text)`,
    );
  }
  // Filip and Wilmer: admin (WO-124 §1 step 2), on top of whatever roles production gives them.
  for (const id of loginIds) {
    parts.push(
      `insert into public.user_roles (user_id, role) values ('${id}', 'admin') on conflict (user_id, role) do nothing`,
    );
  }
  parts.push("set local session_replication_role = origin");
  // 3. Every single-column foreign key in public and fortnox, checked by hand: one orphan
  //    anywhere and the whole transaction rolls back — dev keeps what it had.
  parts.push(`do ${tag}
declare r record; n bigint; bad text := '';
begin
  for r in
    select c.conrelid::regclass as child, a.attname as col, c.confrelid::regclass as parent, pa.attname as pcol
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f' and cardinality(c.conkey) = 1
      and c.connamespace in ('public'::regnamespace, 'fortnox'::regnamespace)
  loop
    execute format('select count(*) from %s x where x.%I is not null and not exists (select 1 from %s p where p.%I = x.%I)',
      r.child, r.col, r.parent, r.pcol, r.col) into n;
    if n > 0 then bad := bad || format('%s.%s -> %s: %s; ', r.child, r.col, r.parent, n); end if;
  end loop;
  if bad <> '' then raise exception 'orphans after the copy, rolled back: %', bad; end if;
end ${tag}`);
  parts.push("commit");
  parts.push(countsSql(COPY));

  const sql = parts.join(";\n");
  console.log(
    `\nDEV ${DEV} · load · ${(sql.length / 1024 / 1024).toFixed(2)} MB of SQL in one transaction`,
  );
  const after = (await devQuery(sql))[0];

  console.log("\ntable                    read   dev after");
  let mismatch = 0;
  for (const t of COPY) {
    const n = rows.get(t).length;
    const extra = t === "profiles" ? 1 + newProfiles.length : 0; // + the demo admin (+ new logins)
    const ok = Number(after[t]) === n + extra || (t === "user_roles" && Number(after[t]) >= n);
    if (!ok) mismatch++;
    console.log(
      `${t.padEnd(24)} ${String(n).padStart(6)} ${String(after[t]).padStart(10)}${ok ? "" : "  !!"}`,
    );
  }
  const placeholders = users.filter((u) => !u.login).length;
  console.log(
    `\nauth.users: ${placeholders} placeholders (no password, banned), ${loginIds.length} logins ` +
      `(${users.filter((u) => u.login && !newProfiles.some((p) => p.id === u.id)).length} with their production id, ${newProfiles.length} new)`,
  );
  console.log(`Production statements sent: ${"all SELECT, read-only endpoint"}`);
  if (mismatch) process.exitCode = 1;
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "counts") await cmdCounts();
  else if (cmd === "plan") await cmdPlan();
  else if (cmd === "copy") await cmdCopy(rest);
  else {
    console.error(
      "usage: node scripts/preview/copy-crm.mjs counts | plan | copy --login <email>[=<name>] ...",
    );
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exitCode = 1;
}
