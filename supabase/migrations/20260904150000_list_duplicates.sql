-- Hittar rader i den inloggade säljarens listor där en annan säljare har
-- samma företag, telefonnummer eller mejladress i sina listor.
-- SECURITY DEFINER krävs eftersom RLS annars döljer andra säljares rader;
-- funktionen läcker bara vilken säljare som har samma uppgift, inget mer.
CREATE OR REPLACE FUNCTION public.get_list_duplicates()
RETURNS TABLE(row_id uuid, match_type text, match_value text, other_seller text)
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
  vals AS (
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
  valid AS (
    SELECT * FROM vals
    WHERE (kind = 'telefon' AND length(norm) >= 7)
       OR (kind = 'mail' AND norm LIKE '%@%')
       OR (kind = 'företag' AND length(norm) >= 3)
  )
  SELECT DISTINCT mine.row_id, mine.kind, mine.raw,
         coalesce(p.full_name, p.email, 'Okänd säljare')
  FROM valid mine
  JOIN valid other
    ON other.kind = mine.kind
   AND other.norm = mine.norm
   AND other.owner_id <> mine.owner_id
  LEFT JOIN public.profiles p ON p.id = other.owner_id
  WHERE mine.owner_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_list_duplicates() FROM public;
GRANT EXECUTE ON FUNCTION public.get_list_duplicates() TO authenticated;
