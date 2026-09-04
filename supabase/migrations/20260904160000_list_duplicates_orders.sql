-- Dubblettkollen samkörs nu även mot registrerade ordrar och offerter:
-- en rad i säljarens lista varnar om en annan säljare har samma företag,
-- telefonnummer eller mejl i sina listor ELLER på en order/offert.
DROP FUNCTION IF EXISTS public.get_list_duplicates();

CREATE FUNCTION public.get_list_duplicates()
RETURNS TABLE(row_id uuid, match_type text, match_value text, other_seller text, source text)
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
    SELECT r.id AS row_id, cols.owner_id, cols.kind,
           CASE cols.kind
             WHEN 'telefon' THEN regexp_replace(coalesce(r.data->>cols.col_id, ''), '\D', '', 'g')
             ELSE lower(btrim(coalesce(r.data->>cols.col_id, '')))
           END AS norm,
           btrim(coalesce(r.data->>cols.col_id, '')) AS raw
    FROM customer_list_rows r
    JOIN cols ON cols.list_id = r.list_id
    WHERE cols.kind IS NOT NULL
  ),
  mine AS (
    SELECT * FROM list_vals
    WHERE owner_id = auth.uid()
      AND ((kind = 'telefon' AND length(norm) >= 7)
        OR (kind = 'mail' AND norm LIKE '%@%')
        OR (kind = 'företag' AND length(norm) >= 3))
  ),
  other_lists AS (
    SELECT owner_id, kind, norm, 'lista'::text AS source FROM list_vals
    WHERE (kind = 'telefon' AND length(norm) >= 7)
       OR (kind = 'mail' AND norm LIKE '%@%')
       OR (kind = 'företag' AND length(norm) >= 3)
  ),
  order_vals AS (
    SELECT coalesce(o.owner_id, o.created_by) AS owner_id, v.kind,
           CASE v.kind
             WHEN 'telefon' THEN regexp_replace(coalesce(v.val, ''), '\D', '', 'g')
             ELSE lower(btrim(coalesce(v.val, '')))
           END AS norm,
           o.order_type::text AS source
    FROM orders o
    CROSS JOIN LATERAL (VALUES
      ('företag', o.company_name),
      ('telefon', o.contact_phone),
      ('mail', o.contact_email)
    ) AS v(kind, val)
  ),
  other_orders AS (
    SELECT * FROM order_vals
    WHERE (kind = 'telefon' AND length(norm) >= 7)
       OR (kind = 'mail' AND norm LIKE '%@%')
       OR (kind = 'företag' AND length(norm) >= 3)
  ),
  others AS (
    SELECT * FROM other_lists
    UNION ALL
    SELECT * FROM other_orders
  )
  SELECT DISTINCT mine.row_id, mine.kind, mine.raw,
         coalesce(p.full_name, p.email, 'Okänd säljare'),
         o.source
  FROM mine
  JOIN others o
    ON o.kind = mine.kind
   AND o.norm = mine.norm
   AND o.owner_id IS DISTINCT FROM auth.uid()
  LEFT JOIN public.profiles p ON p.id = o.owner_id;
$$;

REVOKE ALL ON FUNCTION public.get_list_duplicates() FROM public;
GRANT EXECUTE ON FUNCTION public.get_list_duplicates() TO authenticated;
