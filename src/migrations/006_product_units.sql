ALTER TABLE products
ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'piece',
ADD COLUMN IF NOT EXISTS base_unit text NOT NULL DEFAULT 'pcs',
ADD COLUMN IF NOT EXISTS unit_multiplier int NOT NULL DEFAULT 1;

UPDATE products
SET unit_type = 'weight', base_unit = 'g', unit_multiplier = 1000, unit = 'kg'
WHERE lower(trim(coalesce(unit, ''))) IN ('kg', 'kilo', 'kilogram')
  AND unit_type = 'piece'
  AND base_unit = 'pcs'
  AND unit_multiplier = 1;

UPDATE products
SET unit_type = 'weight', base_unit = 'g', unit_multiplier = 1, unit = 'g'
WHERE lower(trim(coalesce(unit, ''))) IN ('g', 'gram')
  AND unit_type = 'piece'
  AND base_unit = 'pcs'
  AND unit_multiplier = 1;

UPDATE products
SET unit_type = 'volume', base_unit = 'ml', unit_multiplier = 1000, unit = 'l'
WHERE lower(trim(coalesce(unit, ''))) IN ('l', 'liter', 'litre')
  AND unit_type = 'piece'
  AND base_unit = 'pcs'
  AND unit_multiplier = 1;

UPDATE products
SET unit_type = 'volume', base_unit = 'ml', unit_multiplier = 1, unit = 'ml'
WHERE lower(trim(coalesce(unit, ''))) IN ('ml')
  AND unit_type = 'piece'
  AND base_unit = 'pcs'
  AND unit_multiplier = 1;

UPDATE products
SET unit_type = 'piece', base_unit = 'pcs', unit_multiplier = 1, unit = 'pcs'
WHERE lower(trim(coalesce(unit, ''))) IN ('pcs', 'pc', 'piece', 'buah')
  AND (unit_type IS NULL OR base_unit IS NULL OR unit_multiplier IS NULL OR unit_type <> 'piece' OR base_unit <> 'pcs' OR unit_multiplier <> 1);

