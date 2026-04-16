UPDATE "template_vlans"
SET "base_octeto" = CASE "vlan_id"
  WHEN 1 THEN 0
  WHEN 2 THEN 1
  WHEN 3 THEN 2
  WHEN 4 THEN 3
  WHEN 5 THEN 4
  ELSE "base_octeto"
END
WHERE "dblabel" = 'PADRAO'
  AND (
    ("vlan_id" = 1 AND "base_octeto" = 160) OR
    ("vlan_id" = 2 AND "base_octeto" = 161) OR
    ("vlan_id" = 3 AND "base_octeto" = 162) OR
    ("vlan_id" = 4 AND "base_octeto" = 163) OR
    ("vlan_id" = 5 AND "base_octeto" = 164)
  );
