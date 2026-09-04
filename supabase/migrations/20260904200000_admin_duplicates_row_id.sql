-- Adminöversiktens dubbletter returnerar nu även rad-id, så att hela radens
-- innehåll kan visas i dialogen.
DROP FUNCTION IF EXISTS public.get_all_list_duplicates();

CREATE FUNCTION public.get_all_list_duplicates()
RETURNS TABLE(list_id uuid, row_id uuid, match_type text, match_value text, other_party text, source text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cols AS (
    SELECT l.id AS list_id, l.owner_id,
           (c->>'id') AS col_id,
           CASE
             WHEN (c->>'name') ~* 'e-?post|mail' THEN 'mail'
             WHEN (c->>'name') ~* 'telefon|phone|tel|nummer|mobil' THEN 'telefon'
             WHEN (c->>'name') ~* 'företag|company|kund|namn' THEN 'företag'
           END AS kind
    FROM customer_lists l
    CROSS JOIN LATERAL jsonb_array_elements(l.columns) AS c
  ),
  list_vals AS (
    SELECT cols.list_id, r.id AS row_id, cols.owner_id, cols.kind,
           CASE cols.kind
             WHEN 'telefon' THEN right(regexp_replace(coalesce(r.data->>cols.col_id, ''), '\D', '', 'g'), 8)
             ELSE lower(btrim(coalesce(r.data->>cols.col_id, '')))
           END AS norm,
           CASE cols.kind
             WHEN 'telefon' THEN length(regexp_replace(coalesce(r.data->>cols.col_id, ''), '\D', '', 'g'))
             ELSE length(btrim(coalesce(r.data->>cols.col_id, '')))
           END AS full_len,
           btrim(coalesce(r.data->>cols.col_id, '')) AS raw
    FROM customer_list_rows r
    JOIN cols ON cols.list_id = r.list_id
    WHERE cols.kind IS NOT NULL
  ),
  valid_lists AS (
    SELECT * FROM list_vals
    WHERE (kind = 'telefon' AND full_len >= 7)
       OR (kind = 'mail' AND norm LIKE '%@%')
       OR (kind = 'företag' AND full_len >= 3)
  ),
  order_vals AS (
    SELECT coalesce(o.owner_id, o.created_by) AS owner_id, v.kind,
           CASE v.kind
             WHEN 'telefon' THEN right(regexp_replace(coalesce(v.val, ''), '\D', '', 'g'), 8)
             ELSE lower(btrim(coalesce(v.val, '')))
           END AS norm,
           CASE v.kind
             WHEN 'telefon' THEN length(regexp_replace(coalesce(v.val, ''), '\D', '', 'g'))
             ELSE length(btrim(coalesce(v.val, '')))
           END AS full_len,
           o.order_type::text AS source
    FROM orders o
    CROSS JOIN LATERAL (VALUES
      ('företag', o.company_name),
      ('telefon', o.contact_phone),
      ('mail', o.contact_email)
    ) AS v(kind, val)
  ),
  others AS (
    SELECT owner_id, kind, norm, 'lista'::text AS source FROM valid_lists
    UNION ALL
    SELECT owner_id, kind, norm, source FROM order_vals
    WHERE (kind = 'telefon' AND full_len >= 7)
       OR (kind = 'mail' AND norm LIKE '%@%')
       OR (kind = 'företag' AND full_len >= 3)
  )
  SELECT DISTINCT mine.list_id, mine.row_id, mine.kind, mine.raw,
         coalesce(p.full_name, p.email, 'Okänd säljare'),
         o.source
  FROM valid_lists mine
  JOIN others o
    ON o.kind = mine.kind
   AND o.norm = mine.norm
   AND o.owner_id IS DISTINCT FROM mine.owner_id
  LEFT JOIN public.profiles p ON p.id = o.owner_id
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.get_all_list_duplicates() FROM public;
GRANT EXECUTE ON FUNCTION public.get_all_list_duplicates() TO authenticated;
